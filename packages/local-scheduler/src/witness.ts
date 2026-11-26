import { closeSync, constants, openSync, readFileSync, writeSync } from 'node:fs';
import path from 'node:path';
import { isPlainObject } from './contract.js';
import type { LocalSchedulerErrorCode } from './errors.js';
import type { LocalTaskKillSwitchMatchV1 } from './env-file.js';
import { ensurePrivateDir, isValidUtcIsoZ, writeFileAtomicPrivate } from './state-dir.js';

export const LOCAL_TASK_WITNESS_V1 = 1 as const;
export type LocalTaskTriggerV1 = 'systemd-timer' | 'manual';
export type LocalTaskOutcomeV1 =
  | 'succeeded'
  | 'failed'
  | 'timed_out'
  | 'interrupted'
  | 'skipped_disabled'
  | 'refused_policy';

export type LocalTaskSkipEntryV1 =
  | { readonly v: 1; readonly runId: string; readonly at: string; readonly pid: number; readonly outcome: 'skipped_locked' }
  | { readonly v: 1; readonly runId: string; readonly at: string; readonly pid: number; readonly outcome: 'refused_policy'; readonly refusal: 'sandbox' };

export interface LocalTaskWitnessV1 {
  readonly v: typeof LOCAL_TASK_WITNESS_V1;
  readonly taskId: string;
  readonly owner: string;
  readonly runId: string;
  readonly trigger: LocalTaskTriggerV1;
  readonly host: string;
  readonly pid: number;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly durationMs: number;
  readonly outcome: LocalTaskOutcomeV1;
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly killSwitch?: LocalTaskKillSwitchMatchV1;
  readonly refusal?: 'allowlist' | 'file-mode';
  readonly consecutiveFailures: number;
  readonly lastSuccessAt: string | null;
  readonly lastSuccessRunId: string | null;
  readonly summary?: string;
  readonly logPath?: string;
}

const VALID_OUTCOMES = new Set<string>(['succeeded', 'failed', 'timed_out', 'interrupted', 'skipped_disabled', 'refused_policy']);
const VALID_SCOPES = new Set<string>(['global', 'task', 'alias']);
const WITNESS_KEYS = new Set<string>([
  'v', 'taskId', 'owner', 'runId', 'trigger', 'host', 'pid', 'startedAt', 'finishedAt',
  'durationMs', 'outcome', 'exitCode', 'signal', 'killSwitch', 'refusal',
  'consecutiveFailures', 'lastSuccessAt', 'lastSuccessRunId', 'summary', 'logPath',
]);
const CONTROL_CHARS = /[\x00-\x1f\x7f]/g;

export function sanitizeWitnessSummary(raw: string): string {
  const cleaned = raw.replace(CONTROL_CHARS, ' ').trim();
  let end = cleaned.length;
  while (end > 0 && Buffer.byteLength(cleaned.slice(0, end), 'utf8') > 512) end -= 1;
  return cleaned.slice(0, end);
}

export function isValidTaskWitness(raw: unknown, expectedTaskId?: string): raw is LocalTaskWitnessV1 {
  if (!isPlainObject(raw) || Object.keys(raw).some((k) => !WITNESS_KEYS.has(k))) return false;
  if (raw.v !== LOCAL_TASK_WITNESS_V1 || typeof raw.taskId !== 'string') return false;
  if (expectedTaskId !== undefined && raw.taskId !== expectedTaskId) return false;
  if (typeof raw.owner !== 'string' || typeof raw.runId !== 'string' || typeof raw.host !== 'string') return false;
  if (raw.trigger !== 'systemd-timer' && raw.trigger !== 'manual') return false;
  if (!Number.isInteger(raw.pid) || (raw.pid as number) <= 0) return false;
  if (!isValidUtcIsoZ(raw.startedAt) || !isValidUtcIsoZ(raw.finishedAt)) return false;
  if (!Number.isInteger(raw.durationMs) || (raw.durationMs as number) < 0) return false;
  if (typeof raw.outcome !== 'string' || !VALID_OUTCOMES.has(raw.outcome)) return false;
  if (raw.exitCode !== null && typeof raw.exitCode !== 'number') return false;
  if (raw.signal !== null && typeof raw.signal !== 'string') return false;
  if (!Number.isInteger(raw.consecutiveFailures) || (raw.consecutiveFailures as number) < 0) return false;
  if (raw.lastSuccessAt !== null && !isValidUtcIsoZ(raw.lastSuccessAt)) return false;
  if (raw.lastSuccessRunId !== null && typeof raw.lastSuccessRunId !== 'string') return false;
  if (raw.outcome === 'skipped_disabled') {
    if (!isPlainObject(raw.killSwitch) || !VALID_SCOPES.has(String(raw.killSwitch.scope)) || typeof raw.killSwitch.name !== 'string') return false;
  } else if (raw.killSwitch !== undefined) return false;
  if (raw.outcome === 'refused_policy') {
    if (raw.refusal !== 'allowlist' && raw.refusal !== 'file-mode') return false;
  } else if (raw.refusal !== undefined) return false;
  if (raw.summary !== undefined && (typeof raw.summary !== 'string' || CONTROL_CHARS.test(raw.summary) || Buffer.byteLength(raw.summary, 'utf8') > 512)) {
    return false;
  }
  return raw.logPath === undefined || typeof raw.logPath === 'string';
}

export function readTaskWitness(stateDir: string, taskId: string): LocalTaskWitnessV1 | null | 'corrupt' {
  const witnessPath = path.join(stateDir, 'tasks', taskId, 'last-run.json');
  let rawText: string;
  try {
    rawText = readFileSync(witnessPath, 'utf8');
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'ENOENT' ? null : 'corrupt';
  }
  try {
    const parsed: unknown = JSON.parse(rawText);
    return isValidTaskWitness(parsed, taskId) ? parsed : 'corrupt';
  } catch {
    return 'corrupt';
  }
}

export function writeTaskWitnessAtomic(stateDir: string, taskId: string, witness: LocalTaskWitnessV1): void {
  const taskDir = path.join(stateDir, 'tasks', taskId);
  ensurePrivateDir(taskDir);
  writeFileAtomicPrivate(path.join(taskDir, 'last-run.json'), `${JSON.stringify(witness, null, 2)}\n`);
}

export function appendSkipEntry(stateDir: string, taskId: string, entry: LocalTaskSkipEntryV1): void {
  const taskDir = path.join(stateDir, 'tasks', taskId);
  ensurePrivateDir(taskDir);
  const line = `${JSON.stringify(entry)}\n`;
  if (Buffer.byteLength(line, 'utf8') >= 4096) throw new Error('skip entry exceeds 4096 bytes');
  const fd = openSync(path.join(taskDir, 'skips.jsonl'), constants.O_WRONLY | constants.O_CREAT | constants.O_APPEND, 0o600);
  try {
    writeSync(fd, line);
  } finally {
    closeSync(fd);
  }
}

export function readLastSkipEntry(stateDir: string, taskId: string): LocalTaskSkipEntryV1 | null {
  let raw: string;
  try {
    raw = readFileSync(path.join(stateDir, 'tasks', taskId, 'skips.jsonl'), 'utf8');
  } catch {
    return null;
  }
  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    try {
      const p: unknown = JSON.parse(lines[i]);
      if (!isPlainObject(p) || p.v !== 1 || typeof p.runId !== 'string' || !isValidUtcIsoZ(p.at) || !Number.isInteger(p.pid)) continue;
      if (p.outcome === 'skipped_locked') return p as unknown as LocalTaskSkipEntryV1;
      if (p.outcome === 'refused_policy' && p.refusal === 'sandbox') return p as unknown as LocalTaskSkipEntryV1;
    } catch { /* try preceding line */ }
  }
  return null;
}

export type RunnerErrorSummary = { readonly code: LocalSchedulerErrorCode; readonly message: string };
