import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createFakeSchedulerAdapter, type LocalTaskManifestV1 } from '../src/index.js';
import { rotateLogFile, truncateLogExcerpt } from '../src/log-rotator.js';
import { runScheduledTaskInternal } from '../src/runner.js';
import { renderSystemdUnits } from '../src/systemd/unit-generator.js';

const workspaceTmpRoot = path.resolve(process.cwd(), '..', '..', '.tmp');
const createdDirs: string[] = [];
function makeStateDir(): string {
  mkdirSync(workspaceTmpRoot, { recursive: true, mode: 0o700 });
  const d = mkdtempSync(path.join(workspaceTmpRoot, 'local-scheduler-sig-'));
  chmodSync(d, 0o700);
  createdDirs.push(d);
  return d;
}
afterEach(() => {
  while (createdDirs.length > 0) rmSync(createdDirs.pop()!, { recursive: true, force: true });
  try { if (readdirSync(workspaceTmpRoot).length === 0) rmdirSync(workspaceTmpRoot); } catch { /* ignore */ }
});

describe('runner contention, SIGTERM interruption, and log rotation', () => {
  it('handles contender skipped_locked without touching last-run.json and records skips.jsonl', async () => {
    const stateDir = makeStateDir();
    const script = path.join(stateDir, 'job.mjs');
    writeFileSync(script, 'console.log("hi");\n', { mode: 0o600 });
    const adapter = createFakeSchedulerAdapter({ stateDir });
    const spec: LocalTaskManifestV1['spec'] = {
      v: 1, taskId: 'sig-task', owner: 'h2a', description: 'sig test',
      schedule: { onCalendar: 'daily', persistent: true },
      command: { bin: process.execPath, args: [script] }, timeoutMs: 5_000, killGraceMs: 1_000,
    };
    const { manifest } = await adapter.enable(spec, { runner: { bin: process.execPath, args: [script] }, allowedBins: [process.execPath], allowedScripts: [script], stateDir });
    adapter.setWitness('sig-task', {
      v: 1, taskId: 'sig-task', owner: 'h2a', runId: 'r0', trigger: 'manual', host: 'ws', pid: 1,
      startedAt: '2026-11-25T09:00:00.000Z', finishedAt: '2026-11-25T09:01:00.000Z', durationMs: 1000,
      outcome: 'succeeded', exitCode: 0, signal: null, consecutiveFailures: 0, lastSuccessAt: '2026-11-25T09:01:00.000Z', lastSuccessRunId: 'r0',
    });
    const lastRunPath = path.join(stateDir, 'tasks', 'sig-task', 'last-run.json');
    const before = readFileSync(lastRunPath, 'utf8');

    const realBootId = readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim();
    mkdirSync(path.join(stateDir, 'locks'), { recursive: true, mode: 0o700 });
    writeFileSync(path.join(stateDir, 'locks', 'sig-task.lock'), JSON.stringify({
      v: 1, taskId: 'sig-task', pid: 9999, pidStartTime: '1', pidNs: 'pid:[4026539999]',
      timeNs: null, phase: 'running', childPid: 10000, childPgid: 10000, host: 'ws',
      bootId: realBootId, nonce: 'n', acquiredAt: '2026-11-25T10:00:00.000Z',
    }), { mode: 0o600 });

    const res = await runScheduledTaskInternal(manifest, { allowedBins: [process.execPath], allowedScripts: [script], stateDir }, { hostPidGuard: () => undefined });
    expect(res).toMatchObject({ outcome: 'skipped_locked', exitCode: 0, witness: null });
    expect(readFileSync(lastRunPath, 'utf8')).toBe(before);
    expect(readFileSync(path.join(stateDir, 'tasks', 'sig-task', 'skips.jsonl'), 'utf8')).toContain('"outcome":"skipped_locked"');
  });

  it('handles SIGTERM interruption -> outcome interrupted exit 143 without incrementing consecutiveFailures', async () => {
    const stateDir = makeStateDir();
    const script = path.join(stateDir, 'wait.mjs');
    writeFileSync(script, 'console.log("ready"); setInterval(() => {}, 1000);\n', { mode: 0o600 });
    const base = {
      v: 1 as const,
      spec: {
        v: 1 as const, taskId: 'sig-task', owner: 'h2a', description: 'sig test',
        schedule: { onCalendar: 'daily', persistent: true },
        command: { bin: process.execPath, args: [script] }, timeoutMs: 10_000, killGraceMs: 1_000,
      },
      runner: { bin: process.execPath, args: [script] }, enabled: true,
      installedAt: '2026-11-25T10:00:00.000Z', enabledAt: '2026-11-25T10:00:00.000Z',
      stateDir, envFilePath: path.join(stateDir, 'env'), expectedIntervalMs: 86_400_000,
    };
    const u = renderSystemdUnits(base);
    const manifest: LocalTaskManifestV1 = { ...base, units: { serviceSha256: u.serviceSha256, timerSha256: u.timerSha256 } };
    const timer = setTimeout(() => { process.emit('SIGTERM', 'SIGTERM'); }, 150);
    const res = await runScheduledTaskInternal(manifest, { allowedBins: [process.execPath], allowedScripts: [script], stateDir }, {
      hostPidGuard: () => undefined, perfNow: (() => { let t = 100; return () => (t += 42); })(),
    });
    clearTimeout(timer);
    expect(res).toMatchObject({ outcome: 'interrupted', exitCode: 143 });
    expect(res.witness?.consecutiveFailures).toBe(0);
    expect(res.witness?.durationMs).toBe(42);
  });

  it('truncates UTF-8 safely and rotates logs preserving 0600 mode', () => {
    const stateDir = makeStateDir();
    const logPath = path.join(stateDir, 'runs.log');
    expect(Buffer.byteLength(truncateLogExcerpt('é'.repeat(20), 5), 'utf8')).toBeLessThanOrEqual(5);
    expect(truncateLogExcerpt('a\x00b\nc')).toBe('ab\nc');
    writeFileSync(logPath, 'x'.repeat(200), { mode: 0o600 });
    rotateLogFile(logPath, 100, 3);
    expect(existsSync(`${logPath}.1`)).toBe(true);
    expect(statSync(`${logPath}.1`).mode & 0o777).toBe(0o600);
  });
});
