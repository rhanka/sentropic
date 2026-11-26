import path from 'node:path';
import type { LocalTaskManifestV1 } from './contract-types.js';
import type { LocalSchedulerErrorCode } from './errors.js';
import { acquireTaskLock, type TaskLockHandle } from './lock.js';
import { safeLstat } from './lock-probes.js';
import type { LockSystemDeps } from './lock-types.js';
import { appendRunLog, rotateSkipsLog } from './log-rotator.js';
import { ensurePrivateDir, verifyOwnedPrivatePath } from './state-dir.js';
import {
  appendSkipEntry, writeTaskWitnessAtomic,
  type LocalTaskOutcomeV1, type LocalTaskTriggerV1, type LocalTaskWitnessV1, type RunnerErrorSummary,
} from './witness.js';

export interface RunScheduledTaskOptionsV1 {
  readonly allowedBins: readonly string[];
  readonly allowedScripts?: readonly string[];
  readonly stateDir?: string;
  readonly env?: NodeJS.ProcessEnv;
}
export interface RunScheduledTaskResultV1 {
  readonly outcome: LocalTaskOutcomeV1 | 'skipped_locked' | 'not_run';
  readonly exitCode: 0 | 1 | 2 | 70 | 77 | 124 | 130 | 143;
  readonly witness: LocalTaskWitnessV1 | null;
  readonly error?: RunnerErrorSummary;
}
export function bestEffortSandboxSkip(stateDir: string, taskId: string, runId: string, at: string): void {
  try {
    const taskDir = path.join(stateDir, 'tasks', taskId);
    verifyOwnedPrivatePath(stateDir, 'dir');
    verifyOwnedPrivatePath(path.join(stateDir, 'tasks'), 'dir');
    verifyOwnedPrivatePath(taskDir, 'dir');
    const skipsPath = path.join(taskDir, 'skips.jsonl');
    if (safeLstat(skipsPath)) verifyOwnedPrivatePath(skipsPath, 'file');
    appendSkipEntry(stateDir, taskId, { v: 1, runId, at, pid: process.pid, outcome: 'refused_policy', refusal: 'sandbox' });
  } catch { /* best-effort only; never touch locks or last-run.json */ }
}
export function persistOutcomeAndRelease(params: {
  readonly stateDir: string;
  readonly manifest: LocalTaskManifestV1;
  readonly trigger: LocalTaskTriggerV1;
  readonly witness: LocalTaskWitnessV1;
  readonly exitCode: RunScheduledTaskResultV1['exitCode'];
  readonly excerpt: string;
  readonly error?: { readonly code: LocalSchedulerErrorCode; readonly message: string };
  readonly lock: TaskLockHandle;
  readonly stdout: (s: string) => void;
  readonly beforeWitnessWrite?: () => void;
}): RunScheduledTaskResultV1 {
  const { stateDir, manifest, trigger, witness, exitCode, excerpt, error, lock, stdout, beforeWitnessWrite } = params;
  const spec = manifest.spec;
  try {
    beforeWitnessWrite?.();
    const logPath = appendRunLog(stateDir, spec.taskId, {
      v: 1, taskId: spec.taskId, runId: witness.runId, trigger, outcome: witness.outcome,
      durationMs: witness.durationMs, exitCode: witness.exitCode, signal: witness.signal,
      consecutiveFailures: witness.consecutiveFailures,
    }, excerpt);
    const finalWitness: LocalTaskWitnessV1 = { ...witness, logPath };
    writeTaskWitnessAtomic(stateDir, spec.taskId, finalWitness);
    rotateSkipsLog(stateDir, spec.taskId);
    stdout(`${JSON.stringify({
      v: 1, taskId: spec.taskId, runId: witness.runId, trigger, outcome: finalWitness.outcome,
      durationMs: finalWitness.durationMs, exitCode: finalWitness.exitCode,
      signal: finalWitness.signal, consecutiveFailures: finalWitness.consecutiveFailures,
    })}\n`);
    lock.release();
    return { outcome: finalWitness.outcome, exitCode, witness: finalWitness, ...(error ? { error } : {}) };
  } catch (err) {
    try { lock.release(); } catch { /* ignore */ }
    return { outcome: witness.outcome, exitCode: 70, witness: null, error: { code: 'RUNNER_INTERNAL_ERROR', message: (err as Error).message } };
  }
}
export function acquireRunnerLock(params: {
  readonly stateDir: string;
  readonly taskId: string;
  readonly runId: string;
  readonly startedAt: string;
  readonly trigger: LocalTaskTriggerV1;
  readonly stdout: (s: string) => void;
  readonly lockDeps?: LockSystemDeps;
  readonly beforeLockDir?: () => void;
  readonly beforeLockPublish?: () => void;
}): { readonly lock: TaskLockHandle } | { readonly result: RunScheduledTaskResultV1 } {
  let lock: TaskLockHandle | null = null;
  try {
    params.beforeLockDir?.();
    ensurePrivateDir(params.stateDir);
    ensurePrivateDir(path.join(params.stateDir, 'locks'));
    params.beforeLockPublish?.();
    lock = acquireTaskLock(params.stateDir, params.taskId, params.lockDeps);
  } catch (err) {
    try { lock?.release(); } catch { /* ignore */ }
    return { result: { outcome: 'not_run', exitCode: 70, witness: null, error: { code: 'RUNNER_INTERNAL_ERROR', message: (err as Error).message } } };
  }
  if (!lock) {
    try {
      appendSkipEntry(params.stateDir, params.taskId, {
        v: 1, runId: params.runId, at: params.startedAt, pid: process.pid, outcome: 'skipped_locked',
      });
    } catch { /* ignore */ }
    params.stdout(`${JSON.stringify({
      v: 1, taskId: params.taskId, runId: params.runId, trigger: params.trigger,
      outcome: 'skipped_locked', durationMs: 0, exitCode: 0, signal: null,
    })}\n`);
    return { result: { outcome: 'skipped_locked', exitCode: 0, witness: null } };
  }
  return { lock };
}
