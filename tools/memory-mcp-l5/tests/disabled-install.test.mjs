import { expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { createDisabledTrace } from '../disabled-trace.mjs';
import { assertNoCandidateNativeBuilds, candidateNativeBuilds } from '../native-build.mjs';
it('ignores npm script declarations and an executed unrelated tree-sitter build', () => {
  const root = '/fixture/consumer';
  const row = { kind: 'native-build', detail: { executable: 'node-gyp', argv: ['rebuild'],
    cwd: root + '/node_modules/tree-sitter-lua' } };
  expect(assertNoCandidateNativeBuilds('> node-gyp rebuild\nbetter-sqlite3 node-gyp rebuild', [row], root)).toEqual({ candidateNativeBuildCount: 0 });
  expect(candidateNativeBuilds([{ ...row, detail: { ...row.detail, cwd: '/other/node_modules/better-sqlite3' } }], root)).toEqual([]);
  expect(candidateNativeBuilds([{ ...row, detail: { ...row.detail, cwd: root + '/node_modules/fs-ext' } }], root)).toHaveLength(1);
});
it('still blocks a real node-gyp rebuild invocation in the candidate closure', () => {
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
    expect(candidateNativeBuilds(trace.read(), root).length).toBeGreaterThan(0);
    expect(() => assertNoCandidateNativeBuilds('', trace.read(), root)).toThrow(/candidate native build attempts/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
