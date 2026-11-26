import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { validateAllowedExecutable } from '../src/allowlist.js';
import { InvalidTaskSpecError, PolicyRefusalError, validateTaskSpec, type LocalTaskSpecV1 } from '../src/index.js';

const tempDirs: string[] = [];
function makeTmpDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'lsch-contract-'));
  tempDirs.push(dir);
  return dir;
}
afterEach(() => {
  while (tempDirs.length > 0) rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

function baseSpec(overrides: Partial<LocalTaskSpecV1> = {}): LocalTaskSpecV1 {
  return {
    v: 1,
    taskId: 'h2a-session-archive',
    owner: 'h2a',
    description: 'h2a local CLI session archive',
    schedule: { onCalendar: 'daily', persistent: true, randomizedDelaySec: 300, accuracySec: 60 },
    command: { bin: process.execPath, args: ['/opt/app/bin.js', '--scheduled'] },
    timeoutMs: 900_000,
    ...overrides,
  };
}

describe('validateTaskSpec', () => {
  it('accepts valid task specifications including custom OnCalendar', () => {
    expect(validateTaskSpec(baseSpec()).taskId).toBe('h2a-session-archive');
    expect(validateTaskSpec(baseSpec({ schedule: { onCalendar: 'Mon *-*-* 03:00:00', persistent: true } })).schedule.onCalendar).toBe('Mon *-*-* 03:00:00');
  });

  it('rejects invalid taskId, description, OnCalendar, and command.args', () => {
    expect(() => validateTaskSpec(baseSpec({ taskId: 'Bad_Id' }))).toThrow(InvalidTaskSpecError);
    expect(() => validateTaskSpec(baseSpec({ description: 'bad %h desc' }))).toThrow(InvalidTaskSpecError);
    expect(() => validateTaskSpec(baseSpec({ description: 'bad\\desc' }))).toThrow(InvalidTaskSpecError);
    expect(() => validateTaskSpec(baseSpec({ schedule: { onCalendar: '-daily', persistent: true } }))).toThrow(InvalidTaskSpecError);
    expect(() => validateTaskSpec(baseSpec({ schedule: { onCalendar: 'daily\\', persistent: true } }))).toThrow(InvalidTaskSpecError);
    expect(() => validateTaskSpec(baseSpec({ schedule: { onCalendar: 'daily', persistent: true, expectedIntervalMs: 1000 } }))).toThrow(InvalidTaskSpecError);
    expect(() => validateTaskSpec(baseSpec({ command: { bin: process.execPath, args: [';'] } }))).toThrow(InvalidTaskSpecError);
    expect(() => validateTaskSpec(baseSpec({ command: { bin: process.execPath, args: ['trail\\'] } }))).toThrow(InvalidTaskSpecError);
  });

  it('rejects BLOCKED_LOADER_ENV_VARS and secret-shaped names in command.env and envAllowlist', () => {
    for (const v of ['NODE_OPTIONS', 'NODE_PATH', 'LD_PRELOAD', 'LD_LIBRARY_PATH', 'LD_AUDIT', 'ANTHROPIC_API_KEY', 'GITHUB_TOKEN', 'NPM_TOKEN']) {
      expect(() => validateTaskSpec(baseSpec({ command: { bin: process.execPath, args: ['/a.js'], env: { [v]: 'x' } } }))).toThrow(InvalidTaskSpecError);
      expect(() => validateTaskSpec(baseSpec({ command: { bin: process.execPath, args: ['/a.js'], envAllowlist: [v] } }))).toThrow(InvalidTaskSpecError);
    }
  });
});

describe('validateAllowedExecutable', () => {
  it('accepts canonical Node binary + allowed script', () => {
    const dir = makeTmpDir();
    const script = path.join(dir, 'entry.mjs');
    writeFileSync(script, 'console.log("ok");\n', { mode: 0o600 });
    const res = validateAllowedExecutable(process.execPath, [script, '--scheduled'], [process.execPath], [script], 'command');
    expect(res.canonicalScript).toBeDefined();
  });

  it('rejects relative paths, denylisted binaries, node -e, bad shebangs, and writable scripts', () => {
    const dir = makeTmpDir();
    const script = path.join(dir, 'entry.mjs');
    writeFileSync(script, 'console.log("ok");\n', { mode: 0o600 });
    expect(() => validateAllowedExecutable('node', [script], [process.execPath], [script], 'command')).toThrow(PolicyRefusalError);
    expect(() => validateAllowedExecutable('/bin/sh', ['-c', 'true'], ['/bin/sh'], undefined, 'command')).toThrow(PolicyRefusalError);
    expect(() => validateAllowedExecutable(process.execPath, ['-e', '1'], [process.execPath], [script], 'command')).toThrow(PolicyRefusalError);

    const envShebang = path.join(dir, 'env-script.mjs');
    writeFileSync(envShebang, '#!/usr/bin/env node\nconsole.log(1);\n', { mode: 0o700 });
    expect(() => validateAllowedExecutable(envShebang, [], [envShebang], undefined, 'command')).toThrow(PolicyRefusalError);

    const shShebang = path.join(dir, 'sh-wrapper');
    writeFileSync(shShebang, '#!/bin/sh\necho hi\n', { mode: 0o700 });
    expect(() => validateAllowedExecutable(shShebang, [], [shShebang], undefined, 'command')).toThrow(PolicyRefusalError);

    const writableScript = path.join(dir, 'writable.mjs');
    writeFileSync(writableScript, 'console.log(1);\n', { mode: 0o600 });
    chmodSync(writableScript, 0o666);
    expect(() => validateAllowedExecutable(process.execPath, [writableScript], [process.execPath], [writableScript], 'command')).toThrow(PolicyRefusalError);

    const pyFake = path.join(dir, 'python3');
    writeFileSync(pyFake, '#!/usr/bin/python3\n', { mode: 0o700 });
    mkdirSync(path.join(dir, 'sub'), { recursive: true });
    expect(() => validateAllowedExecutable(pyFake, [], [pyFake], undefined, 'command')).toThrow(PolicyRefusalError);
  });
});
