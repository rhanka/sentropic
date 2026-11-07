import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildToolbox, depsBase, main, thinArgs } from './api-tool-build.mjs';

const ref = `ghcr.io/rhanka/sentropic-ci-toolbox-deps@sha256:${'d'.repeat(64)}`;
const recorder = results => {
  const calls = [];
  const warnings = [];
  return { calls, warnings, warn: message => warnings.push(message), build: extra => { calls.push(extra); return results.shift(); } };
};

test('should build the full toolbox without a warning in cold mode and warn on a registry miss', () => {
  assert.deepEqual(depsBase(null), { ref: null });
  assert.match(depsBase('\n').warning, /registry miss/);
  assert.deepEqual(depsBase(`${ref}\n`), { ref });
  const run = recorder([true]);
  assert.equal(buildToolbox({ ref: null, build: run.build, warn: run.warn }), 'full');
  assert.deepEqual(run.calls, [[]]);
  assert.deepEqual(run.warnings, []);
});

test('should build only the thin source layer when the pinned base resolves', () => {
  const run = recorder([true]);
  assert.equal(buildToolbox({ ref, build: run.build, warn: run.warn }), 'thin');
  assert.deepEqual(run.calls, [thinArgs(ref)]);
  assert.deepEqual(thinArgs(ref), ['--build-arg', `BASE_FROM=${ref}`, '--build-arg', `TOOL_DEPS_IMAGE=${ref}`]);
  assert.deepEqual(run.warnings, []);
});

test('should fall back to the full toolbox build with a warning when the thin build fails', () => {
  const run = recorder([false, true]);
  assert.equal(buildToolbox({ ref, build: run.build, warn: run.warn }), 'full');
  assert.deepEqual(run.calls, [thinArgs(ref), []]);
  assert.match(run.warnings.join('\n'), /Thin toolbox build .* failed; rebuilding the full toolbox/);
});

test('should surface a real full-build failure after a miss or after a failed thin build', () => {
  for (const [base, attempts] of [[null, 1], [ref, 2]]) {
    const run = recorder(Array(attempts).fill(false));
    assert.throws(() => buildToolbox({ ref: base, build: run.build, warn: run.warn }), /Full toolbox build failed/);
    assert.equal(run.calls.length, attempts);
    assert.deepEqual(run.calls.at(-1), []);
  }
});

test('should run the real build command and fall back when the thin build process fails', t => {
  const dir = mkdtempSync(join(tmpdir(), 'api-tool-build-'));
  const log = join(dir, 'builds.log');
  const file = join(dir, 'deps-ref');
  process.env.FAKE_BUILD_LOG = log;
  t.after(() => { delete process.env.FAKE_BUILD_LOG; });
  // Fake builder: records its arguments, rejects any thin build (BuildKit cannot resolve the base).
  const fake = "const a=process.argv.slice(1);require('fs').appendFileSync(process.env.FAKE_BUILD_LOG,a.join(' ')+'\\n');process.exit(a.some(x=>x.startsWith('BASE_FROM='))?1:0)";
  const command = [process.execPath, '-e', fake, '--', '--target', 'ci-tools', '-t', 'toolbox:tag', '.'];
  const lines = [];
  t.mock.method(console, 'log', line => lines.push(line));
  writeFileSync(file, `${ref}\n`);
  main([file, '--', ...command]);
  assert.deepEqual(readFileSync(log, 'utf8').trim().split('\n'), [
    `--target ci-tools -t toolbox:tag ${thinArgs(ref).join(' ')} .`,
    '--target ci-tools -t toolbox:tag .',
  ]);
  assert.ok(lines.some(line => line.startsWith('::warning::Thin toolbox build')));
  assert.ok(lines.includes('Toolbox build mode: full'));
  writeFileSync(file, '');
  writeFileSync(log, '');
  main([file, '--', ...command]);
  assert.deepEqual(readFileSync(log, 'utf8').trim().split('\n'), ['--target ci-tools -t toolbox:tag .']);
  assert.ok(lines.some(line => line.startsWith('::warning::No verified toolbox dependency base')));
  const failing = [process.execPath, '-e', 'process.exit(1)', '--', '.'];
  assert.throws(() => main([join(dir, 'absent'), '--', ...failing]), /Full toolbox build failed/);
});
