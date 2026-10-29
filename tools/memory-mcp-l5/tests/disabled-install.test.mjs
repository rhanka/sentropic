import { expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { createDisabledTrace, isNativeBuildProcess } from '../disabled-trace.mjs';
import { assertNoCandidateNativeBuilds, candidateNativeBuilds } from '../native-build.mjs';
it('ignores npm script declarations and an executed unrelated tree-sitter build', () => {
  const root = '/fixture/consumer';
  const row = { kind: 'native-build', detail: { executable: 'gcc', argv: ['-c', 'binding.c'],
    cwd: root + '/node_modules/tree-sitter-lua' } };
  expect(assertNoCandidateNativeBuilds('> node-gyp rebuild\nbetter-sqlite3 node-gyp rebuild', [row], root)).toEqual({ candidateNativeBuildCount: 0 });
  expect(candidateNativeBuilds([{ ...row, detail: { ...row.detail, cwd: '/other/node_modules/better-sqlite3' } }], root)).toEqual([]);
  expect(candidateNativeBuilds([{ ...row, detail: { ...row.detail, cwd: root + '/node_modules/fs-ext' } }], root)).toHaveLength(1);
});
it('does not count an observed build orchestrator without compiler execution or object outputs', () => {
  const root = mkdtempSync(join(tmpdir(), 'l5-native-control-'));
  try {
    const target = join(root, 'node_modules/better-sqlite3'); mkdirSync(target, { recursive: true });
    writeFileSync(join(target, 'binding.gyp'), '{"targets":[]}');
    const nodeGyp = resolve(dirname(process.execPath), '../lib/node_modules/npm/node_modules/node-gyp/bin/node-gyp.js');
    expect(existsSync(nodeGyp)).toBe(true);
    const trace = createDisabledTrace(root);
    const source = `const r = require('node:child_process').spawnSync(process.execPath, ${JSON.stringify([nodeGyp, 'rebuild'])}, {cwd:${JSON.stringify(target)},stdio:'ignore'}); process.stdout.write(String(r.status));`;
    const run = spawnSync(process.execPath, ['-e', source], { env: { ...process.env, ...trace.env }, encoding: 'utf8' });
    expect(run.status).toBe(0);
    expect(run.stdout).toMatch(/^\d+$/);
    expect(trace.read().some(row => row.kind === 'native-build')).toBe(true);
    expect(candidateNativeBuilds(trace.read(), root)).toEqual([]);
    expect(() => assertNoCandidateNativeBuilds('', trace.read(), root)).not.toThrow();
  } finally { rmSync(root, { recursive: true, force: true }); }
});
it('does not treat version/help checks, configuration or cleanup as native compilation', () => {
  for (const [executable, argv] of [['node-gyp', ['--version']], ['gcc', ['--version']],
    ['make', ['--help']], ['node-gyp', ['configure']], ['make', ['clean']]]) {
    expect(isNativeBuildProcess(executable, argv)).toBe(false);
  }
  expect(isNativeBuildProcess('node-gyp', ['rebuild'])).toBe(true);
  expect(isNativeBuildProcess('gcc', ['-c', 'binding.c', '-o', 'binding.o'])).toBe(true);
  expect(isNativeBuildProcess('gcc', ['-v', '-c', 'binding.c'])).toBe(true);
  expect(isNativeBuildProcess('make', ['clean', 'all'])).toBe(true);
});
it('ignores prebuilt native modules and unrelated outputs but catches candidate source-build objects', () => {
  const root = mkdtempSync(join(tmpdir(), 'l5-build-output-'));
  try {
    const addon = join(root, 'node_modules/fs-ext/build/Release');
    const unrelated = join(root, 'node_modules/tree-sitter-lua/build/Release');
    mkdirSync(addon, { recursive: true }); mkdirSync(unrelated, { recursive: true });
    writeFileSync(join(addon, 'prebuilt.node'), 'downloaded prebuilt');
    writeFileSync(join(unrelated, 'parser.o'), 'unrelated object');
    expect(candidateNativeBuilds([], root)).toEqual([]);
    writeFileSync(join(addon, 'binding.o'), 'candidate source-build output');
    expect(candidateNativeBuilds([], root)).toMatchObject([{ kind: 'native-build-output' }]);
    expect(() => assertNoCandidateNativeBuilds('', [], root)).toThrow(/candidate native build attempts/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
