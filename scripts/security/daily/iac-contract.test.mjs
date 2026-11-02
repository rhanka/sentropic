// ACT-L04 L4-C contract tests (make test-security-daily SCOPE=... ENV=test-cyber-L04).
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import test from 'node:test';
import { inventoryIacDocuments, planIacScan, splitYamlDocuments, validateIacReport } from './iac.mjs';

const parseYaml = createRequire(join(process.env.MANIFEST_GUARD_TOOL_DIR, 'package.json'))('yaml').parse;
const FIXTURES = 'scripts/security/daily/fixtures/iac';
const UNSUPPORTED = 'scripts/security/daily/fixtures/iac-unsupported';

// Declared positive controls per required surface. Compose/k8s use the real upstream
// privileged-container check id; the makefile control id is bound at L02 scanner admission.
const CONTROLS = [
  { surface: 'compose', file: 'compose/docker-compose.fixture.yml', id: 'AVD-KSV-011' },
  { surface: 'k8s', file: 'deploy/k8s/manifests.fixture.yaml', id: 'AVD-KSV-011' },
  { surface: 'makefile', file: 'makefile/Makefile', id: 'AVD-MAKE-001' },
];

const result = (target, misconfigurations = []) => ({ Target: target, Class: 'config', Type: 'yaml',
  Misconfigurations: misconfigurations });
const misconfiguration = (id, severity = 'HIGH') => ({ ID: id, Severity: severity, Type: 'Kubernetes Security Check',
  Message: `control ${id}`, Title: 'control' });

function fixtureReport(overrides = {}) {
  const expected = inventoryIacDocuments(FIXTURES, parseYaml);
  const files = [...new Set(expected.documents.map((d) => d.file))].sort();
  const results = files.map((file) => result(file, CONTROLS.filter((c) => c.file === file)
    .map((c) => misconfiguration(c.id))));
  return { SchemaVersion: 2, ArtifactName: '.', Results: overrides.drop ? results.filter((r) => r.Target !== overrides.drop) : results };
}

test('L4-C: fixtures enumerate exact document/resource identities per surface', () => {
  const expected = inventoryIacDocuments(FIXTURES, parseYaml);
  assert.deepEqual(expected.blockers, []);
  assert.deepEqual(expected.documents.map((d) => d.identity).sort(), [
    'compose:compose/docker-compose.fixture.yml#service:cache',
    'compose:compose/docker-compose.fixture.yml#service:db',
    'compose:compose/docker-compose.fixture.yml#service:web',
    'k8s:deploy/k8s/manifests.fixture.yaml#apps/v1/Deployment/fixture-app',
    'k8s:deploy/k8s/manifests.fixture.yaml#v1/Service/fixture-app',
    'make:makefile/Makefile#target:build',
    'make:makefile/Makefile#target:deploy-curl',
    'make:makefile/Makefile#target:test',
  ]);
  assert.deepEqual(expected.surfaces.map((s) => s.surface), ['compose', 'makefile', 'k8s']);
  assert.ok(expected.surfaces.every((s) => s.files.length > 0));
  assert.equal(splitYamlDocuments('a: 1\n---\nb: 2\n').length, 2);
});

test('L4-C: the real repository enumerates compose, Makefile and multi-document k8s surfaces', () => {
  const expected = inventoryIacDocuments('.', parseYaml);
  // Pre-existing malformed documents (e.g. deploy/k8s/base/40-ui.yaml) surface as exact
  // unsupported-construct blockers; they are never silently skipped.
  assert.ok(expected.blockers.every((blocker) => /^unsupported /.test(blocker)), JSON.stringify(expected.blockers));
  assert.deepEqual(expected.surfaces.map((s) => s.surface), ['compose', 'makefile', 'k8s']);
  assert.ok(expected.surfaces.find((s) => s.surface === 'compose').files.some((f) => f.startsWith('docker-compose')));
  assert.ok(expected.surfaces.find((s) => s.surface === 'makefile').files.includes('Makefile'));
  assert.ok(expected.surfaces.find((s) => s.surface === 'k8s').files.some((f) => f.startsWith('deploy/')));
  assert.ok(expected.documents.some((d) => d.surface === 'k8s' && d.identity.split('/').length >= 3));
  assert.ok(expected.documents.filter((d) => d.surface === 'makefile').length > 100);
});

test('L4-C: positive controls are detected in each required surface of a valid report', () => {
  const expected = { ...inventoryIacDocuments(FIXTURES, parseYaml), controls: CONTROLS };
  const parsed = validateIacReport(JSON.stringify(fixtureReport()), expected);
  assert.ok(parsed.Results.length === 3);
  for (const control of CONTROLS) {
    const found = parsed.Results.find((r) => r.Target === control.file)
      ?.Misconfigurations?.some((m) => m.ID === control.id);
    assert.ok(found, control.surface);
  }
});

test('L4-C: dropping one document, zero-config success, missing control or malformed output cannot pass', () => {
  const expected = { ...inventoryIacDocuments(FIXTURES, parseYaml), controls: CONTROLS };
  assert.throws(() => validateIacReport(JSON.stringify(fixtureReport({ drop: 'deploy/k8s/manifests.fixture.yaml' })), expected), /dropped IaC document/);
  assert.throws(() => validateIacReport(JSON.stringify({ SchemaVersion: 2, ArtifactName: '.', Results: [] }), expected), /zero-configuration success/);
  const noControl = fixtureReport();
  noControl.Results = noControl.Results.map((r) => r.Target === 'compose/docker-compose.fixture.yml' ? { ...r, Misconfigurations: [] } : r);
  assert.throws(() => validateIacReport(JSON.stringify(noControl), expected), /positive control not detected: AVD-KSV-011/);
  for (const bad of ['{not-json', '{}', JSON.stringify({ SchemaVersion: 2, ArtifactName: '.', Results: 'x' }),
    JSON.stringify({ SchemaVersion: 2, ArtifactName: '.', Results: [result('makefile/Makefile', [{ ID: 'AVD-MAKE-001' }])] })]) {
    assert.throws(() => validateIacReport(bad, expected));
  }
  const badSeverity = fixtureReport();
  badSeverity.Results[0].Misconfigurations = [{ ID: 'AVD-KSV-011', Severity: 'SUPER', Type: 't', Message: 'm' }];
  assert.throws(() => validateIacReport(JSON.stringify(badSeverity), expected), /report|malformed IaC misconfiguration/);
});

test('L4-C: unsupported constructs emit exact blockers and cannot pass validation', () => {
  const expected = inventoryIacDocuments(UNSUPPORTED, parseYaml);
  assert.ok(expected.blockers.some((b) => /unsupported compose document \(not an object\): compose\/docker-compose\.fixture\.yml#0/.test(b)));
  assert.ok(expected.blockers.some((b) => /unsupported k8s document \(missing apiVersion\/kind\): deploy\/k8s\/bad\.fixture\.yaml#0/.test(b)));
  assert.throws(() => validateIacReport(JSON.stringify(fixtureReport()), { ...expected, controls: [] }), /unsupported IaC constructs/);
  assert.throws(() => validateIacReport(JSON.stringify(fixtureReport()), { documents: [], blockers: [], controls: [] }), /empty expected IaC inventory/);
});

test('L4-C: planIacScan keeps the Trivy config task fenced on scanner admission', () => {
  const task = planIacScan('.');
  assert.equal(task.kind, 'iac');
  assert.equal(task.scanner, 'trivy');
  assert.deepEqual(task.args.slice(0, 2), ['config', '--format']);
  assert.match(task.blocked, /S2b/);
  assert.throws(() => planIacScan('scripts/security/daily/fixtures/iac'), /Makefile/);
});
