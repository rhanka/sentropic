import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createFakeSchedulerAdapter, readTaskWitness, type LocalTaskManifestV1 } from '../src/index.js';
import { runScheduledTaskByIdInternal, runScheduledTaskInternal } from '../src/runner.js';
import { renderSystemdUnits } from '../src/systemd/unit-generator.js';

const workspaceTmpRoot = path.resolve(process.cwd(), '..', '..', '.tmp');
const createdDirs: string[] = [];
function makeStateDir(): string {
  mkdirSync(workspaceTmpRoot, { recursive: true, mode: 0o700 });
  const d = mkdtempSync(path.join(workspaceTmpRoot, 'local-scheduler-runner-'));
  chmodSync(d, 0o700);
  createdDirs.push(d);
  return d;
}
afterEach(() => {
  while (createdDirs.length > 0) rmSync(createdDirs.pop()!, { recursive: true, force: true });
  try { if (readdirSync(workspaceTmpRoot).length === 0) rmdirSync(workspaceTmpRoot); } catch { /* ignore */ }
});

function makeManifest(stateDir: string, scriptPath: string, extra: Partial<LocalTaskManifestV1['spec']> = {}): LocalTaskManifestV1 {
  const spec: LocalTaskManifestV1['spec'] = {
    v: 1, taskId: 'runner-task', owner: 'h2a', description: 'runner test task',
    schedule: { onCalendar: 'daily', persistent: true },
    command: { bin: process.execPath, args: [scriptPath], env: { CUSTOM_FLAG: 'ok' }, envAllowlist: ['ALLOWED_VAR'] },
    timeoutMs: 5_000, killGraceMs: 1_000, killSwitchEnv: 'RUNNER_TEST_OFF', ...extra,
  };
  const base = {
    v: 1 as const, spec, runner: { bin: process.execPath, args: [scriptPath] },
    enabled: true, installedAt: '2026-11-25T10:00:00.000Z', enabledAt: '2026-11-25T10:00:00.000Z',
    stateDir, envFilePath: path.join(stateDir, 'env'), expectedIntervalMs: 86_400_000,
  };
  const u = renderSystemdUnits(base);
  return { ...base, units: { serviceSha256: u.serviceSha256, timerSha256: u.timerSha256 } };
}
const passHost = () => undefined;

describe('runner integration (m-27, m-30, B-5 #2)', () => {
  it('never rejects on missing/corrupt manifest and rejects stateDir mismatch (m-30)', async () => {
    const stateDir = makeStateDir();
    const missing = await runScheduledTaskByIdInternal('runner-task', { allowedBins: [process.execPath], stateDir }, { hostPidGuard: passHost });
    expect(missing).toMatchObject({ outcome: 'not_run', exitCode: 2, witness: null, error: { code: 'TASK_NOT_FOUND' } });

    const manifest = makeManifest(path.join(stateDir, 'other'), path.join(stateDir, 's.mjs'));
    const mismatch = await runScheduledTaskInternal(manifest, { allowedBins: [process.execPath], stateDir }, { hostPidGuard: passHost });
    expect(mismatch).toMatchObject({ outcome: 'not_run', exitCode: 77, witness: null, error: { code: 'POLICY_REFUSED_STATE_DIR' } });
  });

  it('refuses sandboxed runner at step 2 without touching locks or last-run.json (B-5 #2)', async () => {
    const stateDir = makeStateDir();
    const script = path.join(stateDir, 'ok.mjs');
    writeFileSync(script, 'process.exit(0);\n', { mode: 0o600 });
    const adapter = createFakeSchedulerAdapter({ stateDir });
    const m = makeManifest(stateDir, script);
    await adapter.enable(m.spec, { runner: m.runner, allowedBins: [process.execPath], allowedScripts: [script], stateDir });
    adapter.setWitness('runner-task', {
      v: 1, taskId: 'runner-task', owner: 'h2a', runId: 'prev-1', trigger: 'manual', host: 'ws', pid: 1,
      startedAt: '2026-11-25T09:00:00.000Z', finishedAt: '2026-11-25T09:01:00.000Z', durationMs: 1000,
      outcome: 'succeeded', exitCode: 0, signal: null, consecutiveFailures: 0, lastSuccessAt: '2026-11-25T09:01:00.000Z', lastSuccessRunId: 'prev-1',
    });
    const lastRunPath = path.join(stateDir, 'tasks', 'runner-task', 'last-run.json');
    const beforeBytes = readFileSync(lastRunPath, 'utf8');
    const res = await runScheduledTaskByIdInternal('runner-task', { allowedBins: [process.execPath], allowedScripts: [script], stateDir });
    expect(res).toMatchObject({ outcome: 'refused_policy', exitCode: 77, witness: null, error: { code: 'POLICY_REFUSED_SANDBOX' } });
    expect(existsSync(path.join(stateDir, 'locks', 'runner-task.lock'))).toBe(false);
    expect(readFileSync(lastRunPath, 'utf8')).toBe(beforeBytes);
    expect(readFileSync(path.join(stateDir, 'tasks', 'runner-task', 'skips.jsonl'), 'utf8')).toContain('"refusal":"sandbox"');
  });

  it('executes child with constant PATH=/usr/bin:/bin, handles success/failure/timeout/kill-switch, and strips secrets', async () => {
    const stateDir = makeStateDir();
    const script = path.join(stateDir, 'job.mjs');
    writeFileSync(script, [
      'const mode = process.argv[2];',
      'if (process.env.ANTHROPIC_API_KEY || process.env.NODE_OPTIONS) process.exit(99);',
      'if (process.env.PATH !== "/usr/bin:/bin") process.exit(98);',
      'if (mode === "fail") process.exit(4);',
      'if (mode === "hang") setInterval(() => {}, 1000);',
      'console.log("done");',
    ].join('\n'), { mode: 0o600 });

    const env = { PATH: '/evil/bin', ANTHROPIC_API_KEY: 'sk-ant-123', ALLOWED_VAR: 'yes', TRIGGER_UNIT: 'sentropic-task-runner-task.timer' };
    const mOk = makeManifest(stateDir, script);
    const okRes = await runScheduledTaskInternal(mOk, { allowedBins: [process.execPath], allowedScripts: [script], stateDir, env }, { hostPidGuard: passHost });
    expect(okRes.outcome).toBe('succeeded');
    expect(okRes.exitCode).toBe(0);
    expect(okRes.witness?.trigger).toBe('systemd-timer');
    expect(statSync(path.join(stateDir, 'tasks', 'runner-task', 'last-run.json')).mode & 0o777).toBe(0o600);

    const ksRes = await runScheduledTaskInternal(
      makeManifest(stateDir, script, { command: { bin: '/bin/sh', args: ['-c', 'true'] } }),
      { allowedBins: [process.execPath], allowedScripts: [script], stateDir, env: { ...env, RUNNER_TEST_OFF: '1' } },
      { hostPidGuard: passHost },
    );
    expect(ksRes.outcome).toBe('skipped_disabled');
    expect(ksRes.witness?.killSwitch).toEqual({ scope: 'alias', name: 'RUNNER_TEST_OFF' });

    const failRes = await runScheduledTaskInternal(
      makeManifest(stateDir, script, { command: { bin: process.execPath, args: [script, 'fail'] } }),
      { allowedBins: [process.execPath], allowedScripts: [script], stateDir, env },
      { hostPidGuard: passHost },
    );
    expect(failRes.outcome).toBe('failed');
    expect(failRes.exitCode).toBe(1);
    expect(failRes.witness?.consecutiveFailures).toBe(1);

    const toRes = await runScheduledTaskInternal(
      makeManifest(stateDir, script, { timeoutMs: 5_000, killGraceMs: 1_000, command: { bin: process.execPath, args: [script, 'hang'] } }),
      { allowedBins: [process.execPath], allowedScripts: [script], stateDir, env },
      { hostPidGuard: passHost },
    );
    expect(toRes.outcome).toBe('timed_out');
    expect(toRes.exitCode).toBe(124);
    expect(readTaskWitness(stateDir, 'runner-task')?.outcome).toBe('timed_out');
  }, 15_000);

  it('handles ENOSPC injection across all 4 write points (m-27)', async () => {
    const stateDir = makeStateDir();
    const script = path.join(stateDir, 'ok.mjs');
    writeFileSync(script, 'console.log("ok");\n', { mode: 0o600 });
    const m = makeManifest(stateDir, script);
    const enospc = () => { throw Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' }); };
    for (const hook of ['beforeLockDir', 'beforeLockPublish', 'beforePreSpawnRewrite'] as const) {
      const res = await runScheduledTaskInternal(m, { allowedBins: [process.execPath], allowedScripts: [script], stateDir }, {
        hostPidGuard: passHost, hooks: { [hook]: enospc },
      });
      expect(res).toMatchObject({ outcome: 'not_run', exitCode: 70, witness: null, error: { code: 'RUNNER_INTERNAL_ERROR' } });
      expect(existsSync(path.join(stateDir, 'locks', 'runner-task.lock'))).toBe(false);
    }
    const postChild = await runScheduledTaskInternal(m, { allowedBins: [process.execPath], allowedScripts: [script], stateDir }, {
      hostPidGuard: passHost, hooks: { beforeWitnessWrite: enospc },
    });
    expect(postChild).toMatchObject({ outcome: 'succeeded', exitCode: 70, witness: null, error: { code: 'RUNNER_INTERNAL_ERROR' } });
    expect(existsSync(path.join(stateDir, 'locks', 'runner-task.lock'))).toBe(false);
  });
});
