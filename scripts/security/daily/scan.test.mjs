import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { planScan, scanRepository } from './scan.mjs';
import { loadContract } from './schema.mjs';

const sourceSha = 'a'.repeat(40);
const clean = () => ({ auditReportVersion: 2, vulnerabilities: {}, metadata: {
  vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 },
} });
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'daily-scan-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const file of ['package-lock.json', 'ui/package-lock.json', 'docs/governance/kit/package-lock.json']) {
    mkdirSync(join(root, file, '..'), { recursive: true });
    writeFileSync(join(root, file), JSON.stringify({ lockfileVersion: 3, packages: {
      '': { name: 'fixture', version: '1.0.0' }, 'node_modules/demo': { version: '1.0.0' },
    } }));
    writeFileSync(join(root, file.replace('package-lock.json', 'package.json')), '{"name":"fixture","version":"1.0.0"}');
  }
  mkdirSync(join(root, 'api'), { recursive: true });
  writeFileSync(join(root, 'api/Dockerfile'), 'FROM base AS production\nFROM base AS ci-tools\n');
  writeFileSync(join(root, 'ui/Dockerfile'), 'FROM base AS production\n');
  writeFileSync(join(root, 'docker-compose.yml'), 'services: {}\n');
  return root;
}
const runner = (task) => ({ status: 0, stdout: JSON.stringify(task.scanner === 'npm' ? clean() : {
  SchemaVersion: 2, ArtifactName: task.target, Results: [{ Target: task.target, Vulnerabilities: [] }],
}), scannerIdentity: `${task.scanner}:fixture`, databaseIdentity: 'fixture-db' });
const options = (root, extra = {}) => ({ root, sourceSha, repository: 'rhanka/sentropic',
  contract: loadContract(), rows: [], run: runner, today: '2026-10-26', ...extra });

test('should enumerate toolbox, independent dev locks, IaC and blocked SAST without changing inputs', async (t) => {
  const root = fixture(t);
  const before = readFileSync(join(root, 'package-lock.json'));
  const plan = planScan(root, loadContract());
  assert.deepEqual(plan.tasks.filter((task) => task.kind === 'image').map((task) => task.target),
    ['api-production', 'api-toolbox', 'ui-production']);
  for (const target of ['package-lock.json', 'ui/package-lock.json', 'docs/governance/kit/package-lock.json']) {
    const task = plan.tasks.find((item) => item.target === target);
    assert.ok(task.args.includes('--include=dev'));
    assert.ok(task.args.includes('--audit-level=high'));
    assert.ok(!task.args.some((arg) => /fix|omit/.test(arg)));
  }
  assert.ok(plan.tasks.some((task) => task.kind === 'iac'));
  const report = await scanRepository(options(root));
  assert.equal(report.sourceSha, sourceSha);
  assert.equal(report.status, 'incomplete-scan');
  assert.ok(report.coverageBlocked.includes('coverage-blocked: sast'));
  assert.ok(report.coverageBlocked.some((value) => value.includes('S2b')));
  assert.deepEqual(readFileSync(join(root, 'package-lock.json')), before);
});

test('should keep accepted low severity debt queued with its expiry and raw bytes', async (t) => {
  const root = fixture(t);
  const finding = { id: 'GHSA-aaaa-bbbb-cccc', repository: 'rhanka/sentropic', scanner: 'npm',
    component: 'demo', path: 'ui/package-lock.json#node_modules/demo', version: '1.0.0',
    status: 'accepted_temporary', review_due: '2026-10-11' };
  const raw = clean();
  raw.vulnerabilities.demo = { name: 'demo', severity: 'low', range: '<1.0.1', nodes: ['node_modules/demo'],
    via: [{ name: 'demo', severity: 'low', range: '<1.0.1', url: `https://github.com/advisories/${finding.id}` }] };
  raw.metadata.vulnerabilities.low = raw.metadata.vulnerabilities.total = 1;
  const stdout = JSON.stringify(raw);
  const report = await scanRepository(options(root, { rows: [finding], run: (task) => task.target === 'ui/package-lock.json'
    ? { status: 0, stdout, scannerIdentity: 'npm:fixture', databaseIdentity: 'fixture-db' } : runner(task) }));
  assert.equal(report.findings.length, 1);
  assert.equal(report.findings[0].severity, 'LOW');
  assert.equal(report.findings[0].queue, 'queued');
  assert.equal(report.findings[0].register, 'registered-exception');
  assert.equal(report.findings[0].expired, true);
  assert.equal(report.surfaces.find((task) => task.target === 'ui/package-lock.json').raw, stdout);
});

test('should continue all surfaces and reject empty, malformed, partial or errored output', async (t) => {
  const root = fixture(t);
  for (const stdout of ['', '{}', '{bad', '{"error":{"code":"ENOENT"}}',
    JSON.stringify({ ...clean(), metadata: {} }), JSON.stringify({ SchemaVersion: 2, ArtifactName: 'x', Results: [] })]) {
    const seen = [];
    const report = await scanRepository(options(root, { run: (task) => {
      seen.push(task.target);
      return task.target === 'package-lock.json' ? { status: 0, stdout } : runner(task);
    } }));
    assert.equal(report.status, 'incomplete-scan');
    assert.equal(report.surfaces.find((item) => item.target === 'package-lock.json').state, 'error');
    assert.ok(seen.includes('ui/package-lock.json'));
  }
  for (const result of [{ status: 2, stdout: JSON.stringify(clean()) }, { status: null, stdout: JSON.stringify(clean()) }]) {
    const report = await scanRepository(options(root, { run: () => result }));
    assert.ok(report.surfaces.every((item) => item.state === 'error' || item.state === 'blocked'));
  }
});

test('should preserve flags across comparisons and reject scanner absence', async (t) => {
  const root = fixture(t);
  const first = await scanRepository(options(root));
  const next = await scanRepository(options(root, { sourceSha: 'b'.repeat(40) }));
  assert.deepEqual(first.surfaces.map((task) => task.args), next.surfaces.map((task) => task.args));
  const absent = await scanRepository(options(root, { run: () => { throw new Error('scanner unavailable'); } }));
  assert.equal(absent.status, 'incomplete-scan');
  assert.ok(absent.coverageBlocked.some((value) => value.includes('scanner unavailable')));
  await assert.rejects(() => scanRepository(options(root, { sourceSha: 'main' })), /source SHA/);
});
