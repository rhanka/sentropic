import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { validateAllowedExecutable } from '../src/allowlist.js';
import { assertHostPidNamespace, type HostPidNamespaceProbes } from '../src/host-pid-guard.js';
import {
  InvalidTaskSpecError, LocalSchedulerError, ManifestCorruptError, PolicyRefusalError,
  SchedulerUnavailableError, SystemctlFailedError, TaskNotFoundError, UnmanagedUnitError,
  validateTaskSpec, type LocalTaskSpecV1,
} from '../src/index.js';

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

    for (const flag of ['--eval', '-p', '--print', '-r', '--require', '--import']) {
      expect(() => validateAllowedExecutable(process.execPath, [flag, 'x'], [process.execPath], [script], 'command')).toThrow(PolicyRefusalError);
    }
    expect(() => validateAllowedExecutable(process.execPath, [], [process.execPath], [script], 'command')).toThrow(PolicyRefusalError);
    expect(() => validateAllowedExecutable(process.execPath, [script], [process.execPath], undefined, 'command')).toThrow(PolicyRefusalError);
    expect(() => validateAllowedExecutable(process.execPath, [script], [process.execPath], ['/other/s.mjs'], 'command')).toThrow(PolicyRefusalError);

    const nonExecBin = path.join(dir, 'nonexec-bin');
    writeFileSync(nonExecBin, Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x00]), { mode: 0o600 });
    expect(() => validateAllowedExecutable(nonExecBin, [], [nonExecBin], undefined, 'command')).toThrow(PolicyRefusalError);

    const elfBin = path.join(dir, 'custom-bin');
    writeFileSync(elfBin, Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02]), { mode: 0o700 });
    expect(validateAllowedExecutable(elfBin, [], [elfBin], undefined, 'command').canonicalBin).toBe(elfBin);
    expect(() => validateAllowedExecutable(elfBin, [], ['/other/bin'], undefined, 'command')).toThrow(PolicyRefusalError);

    const relShebang = path.join(dir, 'rel-shebang');
    writeFileSync(relShebang, '#!python3\n', { mode: 0o700 });
    expect(() => validateAllowedExecutable(relShebang, [], [relShebang], undefined, 'command')).toThrow(PolicyRefusalError);

    const bashLink = path.join(dir, 'safe-name');
    symlinkSync('/bin/bash', bashLink);
    expect(() => validateAllowedExecutable(bashLink, [], [bashLink], undefined, 'command')).toThrow(PolicyRefusalError);
    expect(() => validateAllowedExecutable(path.join(dir, 'sub'), [], [path.join(dir, 'sub')], undefined, 'command')).toThrow(PolicyRefusalError);
  });
});

describe('error hierarchy, spec bounds & assertHostPidNamespace', () => {
  it('enforces error code and exitCode contract across all LocalSchedulerError subclasses', () => {
    expect(new InvalidTaskSpecError('INTERVAL_MISMATCH', 'bad', 'schedule')).toMatchObject({ code: 'INTERVAL_MISMATCH', exitCode: 2, field: 'schedule' });
    expect(new UnmanagedUnitError('/tmp/u.service', 'unmanaged')).toMatchObject({ code: 'UNMANAGED_UNIT', exitCode: 2, unitPath: '/tmp/u.service' });
    expect(new ManifestCorruptError('/tmp/m.json', 'corrupt')).toMatchObject({ code: 'MANIFEST_CORRUPT', exitCode: 2 });
    expect(new TaskNotFoundError('t1', 'missing')).toMatchObject({ code: 'TASK_NOT_FOUND', exitCode: 2, taskId: 't1' });
    expect(new SchedulerUnavailableError('no-user-manager', 'down')).toMatchObject({ code: 'SYSTEMD_USER_UNAVAILABLE', exitCode: 69, reason: 'no-user-manager' });
    expect(new SystemctlFailedError(['systemctl'], 'err', true, 'failed')).toMatchObject({ code: 'SYSTEMCTL_FAILED', exitCode: 70, rolledBack: true });
    expect(new PolicyRefusalError('POLICY_REFUSED_STATE_DIR', 'state-dir', 'mismatch')).toMatchObject({ code: 'POLICY_REFUSED_STATE_DIR', exitCode: 77, refusal: 'state-dir' });
    expect(new InvalidTaskSpecError('INVALID_TASK_SPEC', 'x')).toBeInstanceOf(LocalSchedulerError);
  });

  it('rejects out-of-bounds spec fields (v, owner, description length, schedule, args, cwd, timeout, resources, killSwitchEnv)', () => {
    expect(() => validateTaskSpec({ ...baseSpec(), v: 2 })).toThrow(InvalidTaskSpecError);
    expect(() => validateTaskSpec(baseSpec({ owner: 'BAD OWNER' }))).toThrow(InvalidTaskSpecError);
    expect(() => validateTaskSpec(baseSpec({ description: 'a'.repeat(121) }))).toThrow(InvalidTaskSpecError);
    expect(() => validateTaskSpec(baseSpec({ schedule: { onCalendar: 'daily', persistent: true, randomizedDelaySec: 3601 } }))).toThrow(InvalidTaskSpecError);
    expect(() => validateTaskSpec(baseSpec({ schedule: { onCalendar: 'daily', persistent: true, accuracySec: 0 } }))).toThrow(InvalidTaskSpecError);
    expect(() => validateTaskSpec(baseSpec({ schedule: { onCalendar: 'daily', persistent: true, graceMultiplier: 1.0 } }))).toThrow(InvalidTaskSpecError);
    expect(() => validateTaskSpec(baseSpec({ command: { bin: process.execPath, args: Array(65).fill('a') } }))).toThrow(InvalidTaskSpecError);
    expect(() => validateTaskSpec(baseSpec({ command: { bin: process.execPath, args: ['x'], cwd: 'relative/dir' } }))).toThrow(InvalidTaskSpecError);
    expect(() => validateTaskSpec(baseSpec({ timeoutMs: 4_000 }))).toThrow(InvalidTaskSpecError);
    expect(() => validateTaskSpec(baseSpec({ killGraceMs: 500 }))).toThrow(InvalidTaskSpecError);
    expect(() => validateTaskSpec(baseSpec({ killSwitchEnv: 'OPENAI_API_KEY' }))).toThrow(InvalidTaskSpecError);
    expect(() => validateTaskSpec(baseSpec({ resources: { nice: -1 } }))).toThrow(InvalidTaskSpecError);
    expect(() => validateTaskSpec(baseSpec({ resources: { memoryMax: '32M' } }))).toThrow(InvalidTaskSpecError);
    expect(() => validateTaskSpec(baseSpec({ resources: { cpuQuota: '4%' } }))).toThrow(InvalidTaskSpecError);
    expect(() => validateTaskSpec(baseSpec({ resources: { tasksMax: 7 } }))).toThrow(InvalidTaskSpecError);
  });

  it('enforces 3-part cumulative host PID namespace proof (§3.4)', () => {
    const valid: HostPidNamespaceProbes = {
      platform: 'linux',
      readLink: () => 'pid:[4026531836]',
      statUid: () => 0,
      readText: (p) => (p.endsWith('comm') ? 'systemd\n' : '0::/init.scope\n'),
    };
    expect(() => assertHostPidNamespace(valid)).not.toThrow();
    expect(() => assertHostPidNamespace({ ...valid, readText: (p) => (p.endsWith('comm') ? 'init\n' : '0::/init.scope\n') })).not.toThrow();
    const badCases: HostPidNamespaceProbes[] = [
      { ...valid, platform: 'darwin' },
      { ...valid, readLink: () => { throw new Error('ENOENT'); } },
      { ...valid, readLink: () => 'pid:[4026539999]' },
      { ...valid, statUid: () => 1000 },
      { ...valid, readText: (p) => (p.endsWith('comm') ? 'bwrap\n' : '0::/init.scope\n') },
      { ...valid, readText: (p) => (p.endsWith('comm') ? 'systemd\n' : '0::/user.slice/user-1000.scope\n') },
    ];
    for (const probe of badCases) {
      expect(() => assertHostPidNamespace(probe)).toThrow(PolicyRefusalError);
    }
  });
});
