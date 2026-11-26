import { mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  evaluateKillSwitch, isTaskKillSwitchActive, parseSchedulerEnvFile, readLastSkipEntry,
  readSchedulerEnvFile, readTaskManifest, readTaskWitness, resolveSchedulerEnvFilePath,
  resolveStateDir, type LocalTaskWitnessV1,
} from '../src/index.js';
import { appendSkipEntry, sanitizeWitnessSummary, writeTaskWitnessAtomic } from '../src/witness.js';

const tmpDirs: string[] = [];
const makeTmp = () => { const d = mkdtempSync(path.join(os.tmpdir(), 'lsch-ew-')); tmpDirs.push(d); return d; };
afterEach(() => { while (tmpDirs.length) rmSync(tmpDirs.pop()!, { recursive: true, force: true }); });

function baseWitness(over: Partial<LocalTaskWitnessV1> = {}): LocalTaskWitnessV1 {
  return {
    v: 1, taskId: 'h2a-session-archive', owner: 'h2a', runId: 'r-1', trigger: 'manual',
    host: 'ws-1', pid: 42, startedAt: '2026-11-25T10:00:00.000Z', finishedAt: '2026-11-25T10:01:00.000Z',
    durationMs: 60_000, outcome: 'succeeded', exitCode: 0, signal: null,
    consecutiveFailures: 0, lastSuccessAt: '2026-11-25T10:01:00.000Z', lastSuccessRunId: 'r-1', ...over,
  };
}

describe('env-file parsing, kill-switch & path resolution', () => {
  it('rejects malformed keys/lines, keeps shell syntax literal, and handles readSchedulerEnvFile', () => {
    const text = '# comment\n; semicolon\n\nNO_EQUALS\n=empty\n1BAD=x\nBAD-KEY=x\nA B=x\nKEY = "a\'b"\nUNCLOSED="abc\nCMD=$(whoami) $HOME\n';
    expect(parseSchedulerEnvFile(text)).toEqual({ KEY: "a'b", UNCLOSED: '"abc', CMD: '$(whoami) $HOME' });
    const dir = makeTmp();
    const envPath = path.join(dir, 'env');
    expect(readSchedulerEnvFile(envPath)).toBeNull();
    writeFileSync(envPath, 'FOO=bar\n', { mode: 0o600 });
    expect(readSchedulerEnvFile(envPath)).toEqual({ FOO: 'bar' });
  });

  it('evaluates kill-switch truthy/falsy matrix and task-id normalization', () => {
    const spec = { taskId: 'my-task-2', killSwitchEnv: 'MY_ALIAS_OFF' };
    for (const falsy of [undefined, '', '   ', '0', 'false', 'FALSE']) {
      expect(isTaskKillSwitchActive({ SENTROPIC_LOCAL_SCHEDULER_OFF: falsy, SENTROPIC_TASK_MY_TASK_2_OFF: falsy, MY_ALIAS_OFF: falsy }, spec)).toBe(false);
    }
    for (const truthy of ['1', 'true', 'TRUE', 'yes', ' 1 ']) {
      expect(evaluateKillSwitch({ SENTROPIC_TASK_MY_TASK_2_OFF: truthy }, { taskId: 'my-task-2' })).toEqual({ scope: 'task', name: 'SENTROPIC_TASK_MY_TASK_2_OFF' });
      expect(isTaskKillSwitchActive({ MY_ALIAS_OFF: truthy }, spec)).toBe(true);
    }
  });

  it('resolves stateDir and envFilePath from env overrides and XDG defaults', () => {
    expect(resolveStateDir({ SENTROPIC_LOCAL_SCHEDULER_STATE_DIR: '/custom/state', XDG_STATE_HOME: '/xdg/state' })).toBe('/custom/state');
    expect(resolveStateDir({ XDG_STATE_HOME: '/xdg/state' })).toBe('/xdg/state/sentropic/local-scheduler');
    expect(resolveStateDir({})).toBe(path.join(os.homedir(), '.local', 'state', 'sentropic', 'local-scheduler'));
    expect(resolveSchedulerEnvFilePath({ XDG_CONFIG_HOME: '/xdg/cfg' })).toBe('/xdg/cfg/sentropic/local-scheduler/env');
    expect(resolveSchedulerEnvFilePath({})).toBe(path.join(os.homedir(), '.config', 'sentropic', 'local-scheduler', 'env'));
  });
});

describe('witness atomicity, schema validation & skips.jsonl', () => {
  it('writes witness atomically with 0600 mode, no leftover tmp, and overwrites cleanly', () => {
    const stateDir = makeTmp();
    writeTaskWitnessAtomic(stateDir, 'h2a-session-archive', baseWitness({ runId: 'r-1' }));
    writeTaskWitnessAtomic(stateDir, 'h2a-session-archive', baseWitness({ runId: 'r-2' }));
    const taskDir = path.join(stateDir, 'tasks', 'h2a-session-archive');
    expect(readdirSync(taskDir)).toEqual(['last-run.json']);
    expect(statSync(path.join(taskDir, 'last-run.json')).mode & 0o777).toBe(0o600);
    expect(readTaskWitness(stateDir, 'h2a-session-archive')).toMatchObject({ runId: 'r-2' });
    expect(readTaskWitness(stateDir, 'absent-task')).toBeNull();
    expect(readTaskManifest(stateDir, 'absent-task')).toBeNull();
  });

  it('rejects every invalid or closed-schema witness violation as corrupt (m-32(g))', () => {
    const stateDir = makeTmp();
    const taskDir = path.join(stateDir, 'tasks', 'h2a-session-archive');
    writeTaskWitnessAtomic(stateDir, 'h2a-session-archive', baseWitness());
    const p = path.join(taskDir, 'last-run.json');
    const badPayloads: unknown[] = [
      { ...baseWitness(), extraKey: 1 },
      { ...baseWitness(), v: 2 },
      { ...baseWitness(), taskId: 'other-task' },
      { ...baseWitness(), startedAt: '2026-11-25T10:00:00+02:00' },
      { ...baseWitness(), lastSuccessAt: 'not-a-date' },
      { ...baseWitness(), durationMs: -1 },
      { ...baseWitness(), durationMs: 1.5 },
      { ...baseWitness(), consecutiveFailures: -1 },
      { ...baseWitness(), outcome: 'unknown_outcome' },
      { ...baseWitness(), outcome: 'skipped_disabled' },
      { ...baseWitness(), killSwitch: { scope: 'alias', name: 'X' } },
      { ...baseWitness(), outcome: 'refused_policy' },
      { ...baseWitness(), outcome: 'refused_policy', refusal: 'sandbox' },
      { ...baseWitness(), outcome: 'refused_policy', refusal: 'state-dir' },
      { ...baseWitness(), refusal: 'allowlist' },
      { ...baseWitness(), summary: 'a'.repeat(513) },
      { ...baseWitness(), summary: 'bad\x00summary' },
    ];
    for (const payload of badPayloads) {
      writeFileSync(p, JSON.stringify(payload), { mode: 0o600 });
      expect(readTaskWitness(stateDir, 'h2a-session-archive')).toBe('corrupt');
    }
    writeFileSync(p, '{broken json', { mode: 0o600 });
    expect(readTaskWitness(stateDir, 'h2a-session-archive')).toBe('corrupt');

    const cleaned = sanitizeWitnessSummary(`ok\x00\x07${'é'.repeat(300)}`);
    expect(Buffer.byteLength(cleaned, 'utf8')).toBeLessThanOrEqual(512);
    expect(cleaned.includes('\x00')).toBe(false);
  });

  it('appends skips.jsonl with 0600, rejects >=4096 bytes, and reads latest valid entry', () => {
    const stateDir = makeTmp();
    expect(readLastSkipEntry(stateDir, 't-1')).toBeNull();
    appendSkipEntry(stateDir, 't-1', { v: 1, runId: 's1', at: '2026-11-25T10:00:00.000Z', pid: 10, outcome: 'skipped_locked' });
    const skipsPath = path.join(stateDir, 'tasks', 't-1', 'skips.jsonl');
    expect(statSync(skipsPath).mode & 0o777).toBe(0o600);
    writeFileSync(skipsPath, '{"v":1,"runId":"bad","at":"2026-11-25T10:02:00.000Z","pid":12,"outcome":"refused_policy","refusal":"allowlist"}\n{corrupt\n\n', { flag: 'a' });
    expect(readLastSkipEntry(stateDir, 't-1')?.runId).toBe('s1');
    expect(() => appendSkipEntry(stateDir, 't-1', { v: 1, runId: 'x'.repeat(4096), at: '2026-11-25T10:03:00.000Z', pid: 13, outcome: 'skipped_locked' })).toThrow();
  });
});
