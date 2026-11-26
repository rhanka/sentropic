import { randomUUID } from 'node:crypto';
import os from 'node:os';
import { validateAllowedExecutable } from './allowlist.js';
import { validateTaskSpec } from './contract.js';
import type { LocalTaskManifestV1 } from './contract-types.js';
import { evaluateKillSwitch } from './env-file.js';
import { LocalSchedulerError, PolicyRefusalError } from './errors.js';
import { assertHostPidNamespace } from './host-pid-guard.js';
import type { LockSystemDeps } from './lock-types.js';
import { buildSanitizedChildEnv, deriveTrigger, loadAndVerifyManifestById, verifyDirectManifestAndStateDir } from './runner-env.js';
import { awaitDetachedChild, spawnDetachedChild } from './runner-spawn.js';
import {
  acquireRunnerLock, bestEffortSandboxSkip, persistOutcomeAndRelease,
  type RunScheduledTaskOptionsV1, type RunScheduledTaskResultV1,
} from './runner-witness.js';
import { resolveStateDir } from './state-dir.js';
import { readTaskWitness, sanitizeWitnessSummary } from './witness.js';

export type { RunScheduledTaskOptionsV1, RunScheduledTaskResultV1 };
export interface RunnerInternalDeps {
  readonly hostPidGuard?: () => void;
  readonly lockDeps?: LockSystemDeps;
  readonly nowIso?: () => string;
  readonly perfNow?: () => number;
  readonly writeStdout?: (line: string) => void;
  readonly writeStderr?: (line: string) => void;
  readonly hooks?: {
    readonly beforeLockDir?: () => void;
    readonly beforeLockPublish?: () => void;
    readonly beforePreSpawnRewrite?: () => void;
    readonly beforeWitnessWrite?: () => void;
    readonly beforeRunLogAppend?: () => void;
  };
}
/** @internal Package-internal execution seam (never exported in package.json). */
export async function runScheduledTaskInternal(
  manifest: LocalTaskManifestV1,
  opts: RunScheduledTaskOptionsV1,
  deps: RunnerInternalDeps = {},
): Promise<RunScheduledTaskResultV1> {
  const env = opts.env ?? process.env;
  const nowIso = deps.nowIso ?? (() => new Date().toISOString());
  const stdout = deps.writeStdout ?? ((s: string) => { process.stdout.write(s); });
  const stderr = deps.writeStderr ?? ((s: string) => { process.stderr.write(s); });
  const runId = randomUUID();
  const startedAt = nowIso();
  const trigger = deriveTrigger(env);
  const host = os.hostname();

  let stateDir: string;
  let verifiedManifest: LocalTaskManifestV1;
  try {
    const res = verifyDirectManifestAndStateDir(manifest, opts.stateDir, env);
    stateDir = res.resolvedStateDir;
    verifiedManifest = res.verifiedManifest;
  } catch (err) {
    const e = err instanceof LocalSchedulerError ? err : new LocalSchedulerError('INVALID_TASK_SPEC', 2, (err as Error).message);
    stderr(`[local-scheduler] ${e.code}: ${e.message}\n`);
    return { outcome: 'not_run', exitCode: e.exitCode as 2 | 77, witness: null, error: { code: e.code, message: e.message } };
  }
  const spec = verifiedManifest.spec;
  try {
    (deps.hostPidGuard ?? assertHostPidNamespace)();
  } catch (err) {
    const msg = (err as Error).message;
    stderr(`[local-scheduler] POLICY_REFUSED_SANDBOX: ${msg}\n`);
    bestEffortSandboxSkip(stateDir, spec.taskId, runId, startedAt);
    return { outcome: 'refused_policy', exitCode: 77, witness: null, error: { code: 'POLICY_REFUSED_SANDBOX', message: msg } };
  }
  const lockOutcome = acquireRunnerLock({
    stateDir, taskId: spec.taskId, runId, startedAt, trigger, stdout, lockDeps: deps.lockDeps,
    beforeLockDir: deps.hooks?.beforeLockDir, beforeLockPublish: deps.hooks?.beforeLockPublish,
  });
  if ('result' in lockOutcome) return lockOutcome.result;
  const lock = lockOutcome.lock;
  const prev = readTaskWitness(stateDir, spec.taskId);
  const prevFailures = prev && prev !== 'corrupt' ? prev.consecutiveFailures : 0;
  const prevSuccessAt = prev && prev !== 'corrupt' ? prev.lastSuccessAt : null;
  const prevSuccessRunId = prev && prev !== 'corrupt' ? prev.lastSuccessRunId : null;
  const finish = (
    witness: Parameters<typeof persistOutcomeAndRelease>[0]['witness'],
    exitCode: RunScheduledTaskResultV1['exitCode'],
    excerpt: string,
    error?: RunScheduledTaskResultV1['error'],
  ) => persistOutcomeAndRelease({ stateDir, manifest: verifiedManifest, trigger, witness, exitCode, excerpt, error, lock, stdout, beforeWitnessWrite: deps.hooks?.beforeWitnessWrite, beforeRunLogAppend: deps.hooks?.beforeRunLogAppend });
  const ks = evaluateKillSwitch(env, spec);
  if (ks) {
    return finish({
      v: 1, taskId: spec.taskId, owner: spec.owner, runId, trigger, host, pid: process.pid,
      startedAt, finishedAt: nowIso(), durationMs: 0, outcome: 'skipped_disabled',
      exitCode: null, signal: null, killSwitch: ks, consecutiveFailures: prevFailures,
      lastSuccessAt: prevSuccessAt, lastSuccessRunId: prevSuccessRunId,
    }, 0, '');
  }
  let canonicalBin: string;
  try {
    validateTaskSpec(spec);
    canonicalBin = validateAllowedExecutable(spec.command.bin, spec.command.args, opts.allowedBins, opts.allowedScripts, 'command').canonicalBin;
  } catch (err) {
    const e = err instanceof LocalSchedulerError ? err : new PolicyRefusalError('POLICY_REFUSED_ALLOWLIST', 'allowlist', (err as Error).message);
    const refusal: 'allowlist' | 'file-mode' = e instanceof PolicyRefusalError && e.refusal === 'file-mode' ? 'file-mode' : 'allowlist';
    return finish({
      v: 1, taskId: spec.taskId, owner: spec.owner, runId, trigger, host, pid: process.pid,
      startedAt, finishedAt: nowIso(), durationMs: 0, outcome: 'refused_policy',
      exitCode: null, signal: null, refusal, consecutiveFailures: prevFailures + 1,
      lastSuccessAt: prevSuccessAt, lastSuccessRunId: prevSuccessRunId, summary: sanitizeWitnessSummary(e.message),
    }, 77, e.message, { code: e.code, message: e.message });
  }
  let child;
  try {
    deps.hooks?.beforePreSpawnRewrite?.();
    lock.transitionToSpawning();
    child = spawnDetachedChild(canonicalBin, spec.command.args, spec.command.cwd ?? os.homedir(), buildSanitizedChildEnv(env, spec));
    if (child.pid !== undefined) lock.transitionToRunning(child.pid);
  } catch (err) {
    if (child?.pid !== undefined) { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* ignore */ } }
    try { lock.release(); } catch { /* ignore */ }
    return { outcome: 'not_run', exitCode: 70, witness: null, error: { code: 'RUNNER_INTERNAL_ERROR', message: (err as Error).message } };
  }
  const runRes = await awaitDetachedChild(child, spec.timeoutMs, spec.killGraceMs ?? 15_000, deps.perfNow);
  const finishedAt = nowIso();
  const nextFailures = runRes.outcome === 'succeeded' ? 0 : runRes.outcome === 'interrupted' ? prevFailures : prevFailures + 1;
  const summary = sanitizeWitnessSummary(
    `outcome=${runRes.outcome} exitCode=${runRes.exitCode ?? 'null'}${runRes.signal ? ` signal=${runRes.signal}` : ''}`,
  );
  return finish({
    v: 1, taskId: spec.taskId, owner: spec.owner, runId, trigger, host, pid: process.pid,
    startedAt, finishedAt, durationMs: runRes.durationMs, outcome: runRes.outcome,
    exitCode: runRes.exitCode, signal: runRes.signal, consecutiveFailures: nextFailures,
    lastSuccessAt: runRes.outcome === 'succeeded' ? finishedAt : prevSuccessAt,
    lastSuccessRunId: runRes.outcome === 'succeeded' ? runId : prevSuccessRunId,
    summary,
  }, runRes.runnerExitCode, runRes.excerpt);
}
export async function runScheduledTaskByIdInternal(taskId: string, opts: RunScheduledTaskOptionsV1, deps: RunnerInternalDeps = {}): Promise<RunScheduledTaskResultV1> {
  const env = opts.env ?? process.env;
  const resolvedStateDir = opts.stateDir ?? resolveStateDir(env);
  try {
    const manifest = loadAndVerifyManifestById(taskId, resolvedStateDir);
    return await runScheduledTaskInternal(manifest, { ...opts, stateDir: resolvedStateDir, env }, deps);
  } catch (err) {
    const e = err instanceof LocalSchedulerError ? err : new LocalSchedulerError('MANIFEST_CORRUPT', 2, (err as Error).message);
    (deps.writeStderr ?? ((s: string) => { process.stderr.write(s); }))(`[local-scheduler] ${e.code}: ${e.message}\n`);
    return { outcome: 'not_run', exitCode: e.exitCode as 2 | 77, witness: null, error: { code: e.code, message: e.message } };
  }
}
export const runScheduledTask = (manifest: LocalTaskManifestV1, opts: RunScheduledTaskOptionsV1): Promise<RunScheduledTaskResultV1> =>
  runScheduledTaskInternal(manifest, opts);
export const runScheduledTaskById = (taskId: string, opts: RunScheduledTaskOptionsV1): Promise<RunScheduledTaskResultV1> =>
  runScheduledTaskByIdInternal(taskId, opts);
