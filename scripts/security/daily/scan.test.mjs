import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { npmRunner, planScan, scanRepository } from './scan.mjs';
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

test('should run bounded credential-free audits on isolated metadata, including workspace manifests', (t) => {
  const root = fixture(t);
  mkdirSync(join(root, 'packages/child'), { recursive: true });
  writeFileSync(join(root, 'package.json'), '{"name":"fixture","workspaces":["packages/*"]}');
  writeFileSync(join(root, 'packages/child/package.json'), '{"name":"child","version":"1.0.0"}');
  writeFileSync(join(root, '.npmrc'), '//registry.npmjs.org/:_authToken=do-not-copy');
  const plan = planScan(root, loadContract());
  const calls = [];
  let scratch;
  const run = npmRunner(root, plan.inventory, (binary, args, opts) => {
    scratch = opts.cwd;
    calls.push({ binary, args });
    assert.equal(binary, 'npm');
    assert.equal(opts.shell, false);
    assert.equal(opts.timeout, 120000);
    assert.equal(opts.maxBuffer, 16 * 1024 * 1024);
    assert.notEqual(opts.cwd, root);
    assert.deepEqual(Object.keys(opts.env).sort(), ['HOME', 'PATH', 'TMPDIR', 'npm_config_cache',
      'npm_config_globalconfig', 'npm_config_ignore_scripts', 'npm_config_registry',
      'npm_config_update_notifier', 'npm_config_userconfig'].sort());
    assert.equal(opts.env.npm_config_userconfig, '/dev/null');
    assert.equal(opts.env.npm_config_globalconfig, join(opts.env.HOME, 'global.npmrc'));
    assert.equal(readFileSync(join(opts.cwd, 'packages/child/package.json'), 'utf8'), '{"name":"child","version":"1.0.0"}');
    assert.throws(() => readFileSync(join(opts.cwd, '.npmrc')));
    return { status: 0, stdout: args[0] === '--version' ? '11.19.0\n' : JSON.stringify(clean()) };
  });
  const task = plan.tasks.find((item) => item.target === 'package-lock.json');
  assert.match(run(task).scannerIdentity, /^npm:11.19.0/);
  assert.deepEqual(calls.map((call) => call.args), [['--version'], task.args]);
  assert.throws(() => readFileSync(join(scratch, 'package-lock.json')));
  assert.throws(() => run(plan.tasks.find((item) => item.kind === 'image')), /S2b/);
});

test('should bind input bytes and detect source or register mutation without treating it as a fix', async (t) => {
  const root = fixture(t);
  mkdirSync(join(root, '.security'), { recursive: true });
  const register = join(root, '.security/vulnerability-register.yaml');
  writeFileSync(register, 'unchanged-register');
  const report = await scanRepository(options(root));
  assert.match(report.inputHashes['package-lock.json'], /^sha256:[a-f0-9]{64}$/);
  assert.match(report.inputHashes['.security/vulnerability-register.yaml'], /^sha256:[a-f0-9]{64}$/);
  assert.equal(readFileSync(register, 'utf8'), 'unchanged-register');
  const changed = await scanRepository(options(root, { run: (task) => {
    if (task.target === 'package-lock.json') writeFileSync(register, 'unexpected mutation');
    return runner(task);
  } }));
  assert.equal(changed.status, 'incomplete-scan');
  assert.ok(changed.coverageBlocked.includes('source bytes changed: .security/vulnerability-register.yaml'));
});

test('should reject inconsistent audit exit codes and reports exceeding the byte bound', async (t) => {
  const root = fixture(t);
  for (const [status, stdout] of [[1, JSON.stringify(clean())],
    [0, JSON.stringify(clean()) + ' '.repeat(16 * 1024 * 1024)]]) {
    const report = await scanRepository(options(root, { run: () => ({ status, stdout,
      scannerIdentity: 'npm:fixture', databaseIdentity: 'fixture-db' }) }));
    assert.equal(report.surfaces.find((surface) => surface.target === 'package-lock.json').state, 'error');
  }
});

test('should wire removable pinned Make targets without existing gate, socket or SAST fallback', () => {
  const makefile = readFileSync('Makefile', 'utf8');
  const scan = makefile.match(/^security-daily-scan:[^\n]*\n((?:\t[^\n]*\n?)+)/m)?.[1];
  const tests = makefile.match(/^test-security-daily:[^\n]*\n((?:\t[^\n]*\n?)+)/m)?.[1];
  assert.ok(scan);
  assert.match(scan, /docker run --rm --read-only/);
  assert.match(scan, /\$\(MEMORY_L5_NODE_IMAGE\)/);
  assert.match(scan, /:\/workspace:ro/);
  assert.match(scan, /SECURITY_DAILY_SOURCE_SHA/);
  assert.match(scan, /node scripts\/security\/daily\/scan.mjs/);
  assert.doesNotMatch(scan, /docker.sock|semgrep|aquasec|audit-fix|compliance|--env-file|TOKEN/);
  assert.match(tests, /test-publishable-manifests/);
  assert.match(tests, /scan.test.mjs/);
  assert.match(tests, /ENV=\$\(ENV\)\s*$/);
});

test('should resolve the real npm binary with the isolated scanner configuration', (t) => {
  const root = fixture(t);
  const plan = planScan(root, loadContract());
  const run = npmRunner(root, plan.inventory, (binary, args, opts) => {
    if (args[0] !== '--version') return { status: 0, stdout: JSON.stringify(clean()) };
    const result = spawnSync(binary, args, opts);
    assert.equal(result.status, 0, result.stderr);
    return result;
  });
  assert.match(run(plan.tasks.find((task) => task.target === 'package-lock.json')).scannerIdentity, /^npm:\d/);
});

test('should resolve cyclic npm references to their advisories and retain each advisory severity', async (t) => {
  const root = fixture(t);
  const raw = clean();
  raw.vulnerabilities.demo = { name: 'demo', severity: 'critical', range: '<2', nodes: ['node_modules/demo'],
    via: ['demo', ...['info', 'low', 'moderate', 'high', 'critical'].map((severity, source) => ({
      name: 'demo', severity, range: '<2', source,
    }))] };
  raw.metadata.vulnerabilities.critical = raw.metadata.vulnerabilities.total = 1;
  const report = await scanRepository(options(root, { run: (task) => task.target === 'package-lock.json'
    ? { status: 1, stdout: JSON.stringify(raw), scannerIdentity: 'npm:fixture', databaseIdentity: 'fixture-db' } : runner(task) }));
  assert.deepEqual(report.findings.map((finding) => finding.severity), ['UNKNOWN', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
  raw.vulnerabilities.demo.via = ['demo'];
  const unresolved = await scanRepository(options(root, { run: () => ({ status: 1, stdout: JSON.stringify(raw),
    scannerIdentity: 'npm:fixture', databaseIdentity: 'fixture-db' }) }));
  assert.equal(unresolved.surfaces.find((surface) => surface.target === 'package-lock.json').state, 'error');
});

test('should preserve independent lock layout and local linked package metadata inside scratch', (t) => {
  const root = fixture(t);
  mkdirSync(join(root, 'apps/idp/web'), { recursive: true });
  mkdirSync(join(root, 'packages/child'), { recursive: true });
  writeFileSync(join(root, 'packages/child/package.json'), '{"name":"child","version":"1.0.0"}');
  writeFileSync(join(root, 'apps/idp/web/package.json'), '{"name":"web","dependencies":{"child":"file:../../../packages/child"}}');
  const bytes = JSON.stringify({ lockfileVersion: 3, packages: {
    'node_modules/child': { resolved: '../../../packages/child', link: true },
    '../../../packages/child': { name: 'child', version: '1.0.0' },
  } });
  writeFileSync(join(root, 'apps/idp/web/package-lock.json'), bytes);
  const plan = planScan(root, loadContract());
  const run = npmRunner(root, plan.inventory, (binary, args, opts) => {
    assert.equal(readFileSync(join(opts.cwd, '../../../packages/child/package.json'), 'utf8'), '{"name":"child","version":"1.0.0"}');
    assert.equal(readFileSync(join(opts.cwd, 'package-lock.json'), 'utf8'), bytes);
    return { status: 0, stdout: args[0] === '--version' ? '11.19.0\n' : JSON.stringify(clean()) };
  });
  assert.match(run(plan.tasks.find((task) => task.target === 'apps/idp/web/package-lock.json')).scannerIdentity, /^npm:/);
});
