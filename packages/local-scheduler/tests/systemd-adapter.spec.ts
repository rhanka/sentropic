import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  InvalidTaskSpecError, ManifestCorruptError, PolicyRefusalError,
  SchedulerUnavailableError, TaskNotFoundError, UnmanagedUnitError,
  type LocalTaskSpecV1,
} from '../src/index.js';
import { createSystemdUserAdapterInternal } from '../src/systemd/adapter.js';
import type { ExecFileFn } from '../src/systemd/systemctl.js';
import { writeTaskWitnessAtomic } from '../src/witness.js';

const tmpDirs: string[] = [];
const makeTmp = () => { const d = mkdtempSync(path.join(os.tmpdir(), 'lsch-sd-')); tmpDirs.push(d); return d; };
afterEach(() => { while (tmpDirs.length) rmSync(tmpDirs.pop()!, { recursive: true, force: true }); });

const passHost = () => {};
function makeSpec(script: string, over: Partial<LocalTaskSpecV1> = {}): LocalTaskSpecV1 {
  return {
    v: 1, taskId: 'sd-task', owner: 'h2a', description: 'systemd test task',
    schedule: { onCalendar: 'daily', persistent: true },
    command: { bin: process.execPath, args: [script, 'run'] },
    timeoutMs: 60_000, ...over,
  };
}

describe('SystemdUserAdapter lifecycle, safety, rollback (m-29), and status (m-28)', () => {
  it('preserves 0755 unitDir without chmod, refuses 0775/unmanaged units, and handles enable/restart/disable/uninstall', async () => {
    const root = makeTmp();
    const stateDir = path.join(root, 'state');
    const unitDir = path.join(root, 'units');
    const script = path.join(root, 'task.mjs');
    writeFileSync(script, 'console.log("ok");\n', { mode: 0o600 });
    mkdirSync(unitDir, { mode: 0o755 });
    chmodSync(unitDir, 0o755);

    const calls: string[] = [];
    const execFile: ExecFileFn = async (file, args) => {
      calls.push(`${file} ${args.join(' ')}`);
      if (file === 'systemctl' && args.includes('--property=Version')) return { stdout: '259\n', stderr: '' };
      if (file === 'loginctl') return { stdout: 'no\n', stderr: '' };
      if (file === 'systemctl' && args[1] === 'is-active') return { stdout: 'active\n', stderr: '' };
      if (file === 'systemctl' && args[1] === 'clean') throw Object.assign(new Error('clean'), { stderr: 'Failed to clean unit: No matching resources found.' });
      if (file === 'systemd-analyze') {
        return { stdout: 'Next elapse: Thu 2026-11-26 00:00:00 UTC\nIteration #2: Fri 2026-11-27 00:00:00 UTC\n', stderr: '' };
      }
      return { stdout: '', stderr: '' };
    };
    const adapter = createSystemdUserAdapterInternal({ stateDir, envFilePath: path.join(stateDir, 'env'), hostPidGuard: passHost, execFile, nowIso: () => '2026-11-26T00:00:00.000Z' });
    const policy = { runner: { bin: process.execPath, args: [script] }, allowedBins: [process.execPath], allowedScripts: [script], unitDir, stateDir, runtime: true };

    const res1 = await adapter.enable(makeSpec(script), policy);
    expect(statSync(unitDir).mode & 0o777).toBe(0o755);
    expect(statSync(res1.servicePath).mode & 0o777).toBe(0o600);
    expect(res1.lingerEnabled).toBe(false);
    expect(res1.lingerNotice).toContain('loginctl enable-linger');
    expect(calls.some((c) => c.includes('enable --now --runtime -- sentropic-task-sd-task.timer'))).toBe(true);

    await adapter.enable(makeSpec(script, { schedule: { onCalendar: '*-*-* 03:00:00', persistent: true, expectedIntervalMs: 86_400_000 } }), policy);
    expect(calls.some((c) => c.includes('restart -- sentropic-task-sd-task.timer'))).toBe(true);
    await expect(adapter.enable(makeSpec(script, { schedule: { onCalendar: 'daily', persistent: true, expectedIntervalMs: 120_000 } }), policy)).rejects.toThrow(InvalidTaskSpecError);

    await adapter.disable('sd-task', { unitDir, stateDir, runtime: true });
    expect(calls.some((c) => c.includes('disable --now --runtime -- sentropic-task-sd-task.timer'))).toBe(true);
    expect((await adapter.uninstall('sd-task', { unitDir, stateDir, runtime: true, purgeState: false })).removedUnits).toHaveLength(2);
    expect((await adapter.uninstall('sd-task', { unitDir, stateDir })).removedUnits).toEqual([]);
    await expect(adapter.disable('sd-task', { unitDir, stateDir })).rejects.toThrow(TaskNotFoundError);

    const badDir = path.join(root, 'bad-units');
    mkdirSync(badDir, { mode: 0o775 });
    chmodSync(badDir, 0o775);
    await expect(adapter.enable(makeSpec(script), { ...policy, unitDir: badDir })).rejects.toThrow(PolicyRefusalError);

    writeFileSync(path.join(unitDir, 'sentropic-task-sd-task.service'), '[Unit]\nDescription=foreign\n', { mode: 0o600 });
    await expect(adapter.enable(makeSpec(script), policy)).rejects.toThrow(UnmanagedUnitError);
    await expect(adapter.uninstall('sd-task', { unitDir, stateDir })).rejects.toThrow(UnmanagedUnitError);
  });

  it('rolls back first-install and update on SYSTEMCTL_FAILED (m-29) and reports 203/77 diagnostics (m-28)', async () => {
    const root = makeTmp();
    const stateDir = path.join(root, 'state');
    const unitDir = path.join(root, 'units');
    const script = path.join(root, 'task.mjs');
    writeFileSync(script, 'console.log("ok");\n', { mode: 0o600 });
    const policy = { runner: { bin: process.execPath, args: [script] }, allowedBins: [process.execPath], allowedScripts: [script], unitDir, stateDir, runtime: true };

    let failEnable = true;
    const cmds: string[] = [];
    let showMode: '203' | '77-allow' | '77-prelock' | '77-badts' = '203';
    const showEnvs: Array<NodeJS.ProcessEnv | undefined> = [];
    const execFile: ExecFileFn = async (file, args, opts) => {
      cmds.push(`${file} ${args.join(' ')}`);
      if (file === 'systemctl' && args.includes('--property=Version')) return { stdout: '252\n', stderr: '' };
      if (file === 'loginctl') return { stdout: 'yes\n', stderr: '' };
      if (file === 'systemctl' && args[1] === 'enable' && failEnable) throw Object.assign(new Error('enable failed'), { stderr: 'Unit failed' });
      if (file === 'systemctl' && args[1] === 'show' && args.includes('sentropic-task-sd-task.service')) {
        showEnvs.push(opts.env);
        const exitTs = showMode === '77-badts' ? 'Thu 2026-11-26 01:00:00 CET' : 'Thu 2026-11-26 01:00:00 UTC';
        return { stdout: `ActiveState=failed\nResult=exit-code\nExecMainStatus=${showMode === '203' ? 203 : 77}\nExecMainExitTimestamp=${exitTs}\n`, stderr: '' };
      }
      if (file === 'systemctl' && args[1] === 'show') {
        showEnvs.push(opts.env);
        return { stdout: 'UnitFileState=enabled\nActiveState=active\nNextElapseUSecRealtime=n/a\nLastTriggerUSec=\nLastTriggerUSecMonotonic=0\n', stderr: '' };
      }
      return { stdout: '', stderr: '' };
    };
    const adapter = createSystemdUserAdapterInternal({ stateDir, envFilePath: path.join(stateDir, 'env'), hostPidGuard: passHost, execFile, nowIso: () => '2026-11-26T01:00:01.000Z' });

    await expect(adapter.enable(makeSpec(script), policy)).rejects.toMatchObject({ code: 'SYSTEMCTL_FAILED', rolledBack: true });
    expect(existsSync(path.join(unitDir, 'sentropic-task-sd-task.service'))).toBe(false);
    expect(existsSync(path.join(stateDir, 'tasks', 'sd-task', 'manifest.json'))).toBe(false);
    expect(cmds.findIndex((c) => c.includes('disable --runtime -- sentropic-task-sd-task.timer'))).toBeGreaterThan(-1);

    failEnable = false;
    const orig = await adapter.enable(makeSpec(script), policy);
    const origService = readFileSync(orig.servicePath, 'utf8');
    failEnable = true;
    await expect(adapter.enable(makeSpec(script, { description: 'updated desc' }), policy)).rejects.toMatchObject({ code: 'SYSTEMCTL_FAILED', rolledBack: true });
    expect(readFileSync(orig.servicePath, 'utf8')).toBe(origService);

    expect((await adapter.status('sd-task')).systemd).toMatchObject({ execMainStatus: 203, execDiagnostic: expect.stringContaining('203/EXEC') });
    showMode = '77-prelock';
    expect((await adapter.status('sd-task')).systemd).toMatchObject({ execMainStatus: 77, execDiagnostic: expect.stringContaining('refused before the lock') });
    writeTaskWitnessAtomic(stateDir, 'sd-task', {
      v: 1, taskId: 'sd-task', owner: 'h2a', runId: 'r-77', trigger: 'systemd-timer', host: 'ws', pid: 10,
      startedAt: '2026-11-26T00:59:59.000Z', finishedAt: '2026-11-26T01:00:00.000Z', durationMs: 10,
      outcome: 'refused_policy', exitCode: null, signal: null, refusal: 'allowlist', consecutiveFailures: 1,
      lastSuccessAt: null, lastSuccessRunId: null,
    });
    showMode = '77-allow';
    expect((await adapter.status('sd-task')).systemd).toMatchObject({ execMainStatus: 77, execDiagnostic: expect.stringContaining('command refused by the allow-list (allowlist)') });
    expect(showEnvs.every((e) => e?.TZ === 'UTC' && e?.LC_ALL === 'C')).toBe(true);
    showMode = '77-badts';
    expect((await adapter.status('sd-task')).systemd).toMatchObject({ execMainStatus: 77, execDiagnostic: expect.stringContaining('refused before the lock') });
    writeTaskWitnessAtomic(stateDir, 'sd-task', {
      v: 1, taskId: 'sd-task', owner: 'h2a', runId: 'r-77-stale', trigger: 'systemd-timer', host: 'ws', pid: 10,
      startedAt: '2026-11-26T00:59:49.000Z', finishedAt: '2026-11-26T00:59:50.000Z', durationMs: 10,
      outcome: 'refused_policy', exitCode: null, signal: null, refusal: 'allowlist', consecutiveFailures: 1,
      lastSuccessAt: null, lastSuccessRunId: null,
    });
    showMode = '77-allow';
    expect((await adapter.status('sd-task')).systemd).toMatchObject({ execMainStatus: 77, execDiagnostic: expect.stringContaining('refused before the lock') });

    const downAdapter = createSystemdUserAdapterInternal({
      stateDir, hostPidGuard: passHost, execFile: async () => { throw Object.assign(new Error('no dbus'), { stderr: 'Failed to connect to bus' }); },
    });
    await expect(downAdapter.disable('sd-task')).rejects.toThrow(SchedulerUnavailableError);
    expect((await downAdapter.status('sd-task')).systemd).toBe('unavailable');
    writeFileSync(path.join(stateDir, 'tasks', 'sd-task', 'manifest.json'), '{bad', { mode: 0o600 });
    await expect(adapter.disable('sd-task', { unitDir, stateDir })).rejects.toThrow(ManifestCorruptError);
    const badSymlink = path.join(root, 'sym-units');
    symlinkSync(unitDir, badSymlink);
    await expect(adapter.enable(makeSpec(script), { ...policy, unitDir: badSymlink })).rejects.toThrow(PolicyRefusalError);
  });
});
