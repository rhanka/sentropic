import { expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { createDisabledTrace } from '../disabled-trace.mjs';
import { assertNoCandidateNativeBuilds, candidateNativeBuilds } from '../native-build.mjs';

it('blocks an observed compiler execution that produces a real candidate object file', () => {
  const root = mkdtempSync(join(tmpdir(), 'l5-real-compile-'));
  try {
    for (const binary of ['python', 'python2', 'python3']) {
      expect(spawnSync('sh', ['-c', 'command -v "$1"', 'probe', binary]).status).not.toBe(0);
    }
    const addon = join(root, 'node_modules/fs-ext'); mkdirSync(addon, { recursive: true });
    const build = join(addon, 'build/Release/obj.target'); mkdirSync(build, { recursive: true });
    const source = join(addon, 'control.c'), object = join(build, 'control.o');
    writeFileSync(source, 'int l5_native_control(void) { return 42; }\n');
    const trace = createDisabledTrace(root);
    const code = `const r=require('node:child_process').spawnSync('gcc',${JSON.stringify(['-c', source, '-o', object])},{cwd:${JSON.stringify(addon)},stdio:'inherit'});process.exit(r.status??1);`;
    const run = spawnSync(process.execPath, ['-e', code], { env: { ...process.env, ...trace.env }, encoding: 'utf8' });
    expect(run.status, run.stderr).toBe(0);
    expect(existsSync(object)).toBe(true);
    expect(readFileSync(object).subarray(0, 4).toString('hex')).toBe('7f454c46');
    expect(candidateNativeBuilds(trace.read(), root).some(row => row.detail.executable === 'gcc')).toBe(true);
    expect(candidateNativeBuilds([], root).some(row => row.kind === 'native-build-output')).toBe(true);
    expect(() => assertNoCandidateNativeBuilds('', trace.read(), root)).toThrow(/candidate native build attempts/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
