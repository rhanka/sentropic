import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { measureArtifact, reportTable } from './artifact-budget.mjs';

function fixture(run) {
  const directory = mkdtempSync(join(tmpdir(), 'artifact-budget-'));
  mkdirSync(join(directory, '.vite'));
  const put = (path, value) => writeFileSync(join(directory, path), typeof value === 'object' ? JSON.stringify(value) : value);
  put('index.html', '<script type="module" src="/entry.js"></script>');
  put('entry.js', 'document.title="Ready"');
  put('portable.html', '<script>document.title="Ready"</script>');
  const manifest = { entry: { file: 'entry.js', isEntry: true } };
  const measure = (startupPaths = []) => {
    put('.vite/manifest.json', manifest);
    return measureArtifact({ directory, portablePath: join(directory, 'portable.html'), startupPaths });
  };
  try { run({ put, measure, manifest }); } finally { rmSync(directory, { recursive: true }); }
}
test('should report exact unique closure bytes and non-gating agent read cost', () => fixture(({ measure }) => {
  const report = measure(['entry.js', 'entry.js']);
  assert.deepEqual(report.violations, []);
  assert.equal(report.totals.release, report.files.reduce((n, f) => n + f.raw, 0));
  assert.equal(report.agentReadCost.portable, report.portable.raw);
  assert.match(reportTable(report), /agent read cost/);
  assert(report.files.every(file => file.sha256.length === 64 && file.gzip > 0 && file.brotli > 0));
}));
test('should fail when an entry reimports the governance corpus', () => fixture(({ put, measure }) => {
  put('entry.js', 'const governanceRoutes = ' + 'x'.repeat(3115306));
  assert(measure().violations.some(message => message.startsWith('js:')));
}));
test('should fail when large data is hidden in a startup fetch', () => fixture(({ put, measure }) => {
  put('startup.json', 'x'.repeat(410000));
  const report = measure(['startup.json']);
  assert(report.violations.some(message => message.startsWith('initial:')));
  assert(report.files.find(file => file.path === 'startup.json').initial);
}));
test('should fail when oversized deferred code hides behind a small entry', () => fixture(({ put, measure, manifest }) => {
  put('optional.js', 'x'.repeat(131073));
  manifest.entry.dynamicImports = ['optional'];
  manifest.optional = { file: 'optional.js', isDynamicEntry: true };
  const report = measure();
  assert(report.violations.some(message => message.startsWith('Optional chunk')));
  assert(report.totals.release > report.totals.initial);
}));
test('should sum static imports and reject missing or unreferenced deployed files', () => fixture(({ put, measure, manifest }) => {
  manifest.entry.imports = ['shared'];
  manifest.shared = { file: 'shared.js' };
  assert(measure().violations.some(message => message.includes('Missing deployed asset')));
  put('shared.js', 'x'.repeat(307200));
  put('unused.json', 'payload');
  const report = measure();
  assert(report.violations.some(message => message.startsWith('js:')));
  assert(report.violations.some(message => message.includes('Unreferenced deployed asset')));
}));
