import { createHash } from 'node:crypto';
import { logger } from '../../../logger';
import { LiveError } from './records';
import { scrubRecipeOutput, truncateRecipeTail } from './recipe-diagnostics';

/** Bound of one heavy phase; the recipes carry the same 300 s timeout. */
export const PHASE_DEADLINE_MS = 300_000;
/** Env override of the install stall bound: no install progress observed for this long fails the phase.
 * Optional, unset by default; when set it must satisfy the same bounds as every install bound below. */
export const INSTALL_STALL_MS_ENV = 'ARTIFACT_INSTALL_STALL_MS';
/** Env override of the install absolute ceiling: a cold install never runs past this.
 * Optional, unset by default; when set it must exceed the stall bound. */
export const INSTALL_CEILING_MS_ENV = 'ARTIFACT_INSTALL_CEILING_MS';
/** No install progress (tarball streamed, put frame sent, file drained) for this long fails the install, even cold.
 * The stall timer arms only on the first observed progress: the pre-progress window (heavy-queue admission up to
 * 600 s, forge re-download up to 120 s, relay frames up to 320 s each) is covered by those inner bounds plus the
 * ceiling, never by the stall. */
export const INSTALL_STALL_MS_DEFAULT = 60_000;
/** `setTimeout` overflows past 2^31-1 ms (~24.8 days) to ~1 ms, so env bounds are clamped to this maximum. */
export const MAX_TIMEOUT_MS = 2_147_483_647;
/** A cold cache of ~1,500 packages / ~1 GB at the measured preprod relay rate (~3.4 MB/s, 826 MB fetched in 244 s)
 * needs ~5 min of fetch alone, plus the source-tree transfer to the pod, the pod-side `npm ci --offline`
 * (`INSTALL_RECIPE`, 300 s), and the drain of installed files back to the cache: 20 min covers the sum with
 * headroom. Inner bounds are separate and unchanged: the staged-tarball stream to the pod refuses past 512 MiB
 * total, each supervisor frame past 320 s, the pod recipe past its own 300 s timeout. A set exceeding an inner
 * bound fails with that bound's error, not the watchdog's. A cut install never poisons the cache (admission is
 * atomic), so a retry starts cold again instead of resuming a half-written entry. */
export const INSTALL_CEILING_MS_DEFAULT = 1_200_000;
/** Progress-based bound of the dependency install phase: stall watchdog plus absolute ceiling. */
export interface InstallBudget { stallMs: number; ceilingMs: number; lookupMs?: number; admitMs?: number }
export const defaultInstallBudget = (): InstallBudget =>
  ({ stallMs: INSTALL_STALL_MS_DEFAULT, ceilingMs: INSTALL_CEILING_MS_DEFAULT });
const positive = (value: string | undefined) => {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= MAX_TIMEOUT_MS ? parsed : undefined;
};
/** Install budget from the environment; a missing or invalid value falls back to the safe default, and a ceiling
 * that does not exceed the stall falls back as a whole (names only, never values). */
export function readInstallBudget(env: Readonly<Record<string, string | undefined>>): InstallBudget {
  const stallMs = positive(env[INSTALL_STALL_MS_ENV]?.trim()) ?? INSTALL_STALL_MS_DEFAULT;
  const ceilingMs = positive(env[INSTALL_CEILING_MS_ENV]?.trim()) ?? INSTALL_CEILING_MS_DEFAULT;
  return ceilingMs > stallMs ? { stallMs, ceilingMs } : defaultInstallBudget();
}
/** Progress signal of the install phase; the opaque offline `npm ci` sub-phase suspends the stall timer (it is still
 * covered by the ceiling) because the API observes no progress while the pod runs it. */
export interface InstallProgress { report(): void; suspendStall(suspended: boolean): void;
  /** Current install sub-step (cache lookup, heavy admission, forge re-download, transfer, recipe, drain):
   * recorded for the ceiling/stall reason so a future timeout names its sub-step. Optional for older fakes. */
  step?(name: string): void;
  /** Clears the current sub-step after a successful completion, so a later hang in a gap between steps
   * blames no completed step (bare phase reason) instead of the last finished one. Optional for older fakes. */
  clearStep?(): void }
/** A timeout does not attest termination: callers must quiesce and confirm teardown before replacement.
 * A `signal` abort always rejects with a bare `phase_timeout` (never the raw `AbortError`), so callers map it to
 * their own phase or step name instead of leaking a generic abort. */
export async function withinPhase<T>(work: Promise<T>, milliseconds = PHASE_DEADLINE_MS, signal?: AbortSignal): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  if (signal?.aborted) throw new LiveError('builder_unavailable', 'phase_timeout');
  let onAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(new LiveError('builder_unavailable', 'phase_timeout'));
  });
  // Prevent an unhandled rejection when the race settles via work or timeout while no abort ever fires.
  aborted.catch(() => undefined);
  if (signal && onAbort) signal.addEventListener('abort', onAbort, { once: true });
  try {
    return await Promise.race([work, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new LiveError('builder_unavailable', 'phase_timeout')), milliseconds); timer.unref();
    }), ...(signal ? [aborted] : [])]);
  } finally {
    clearTimeout(timer);
    if (signal && onAbort) signal.removeEventListener('abort', onAbort);
  }
}
/** Install-phase failure: the failing phase rides in the reason, so the job ledger and `stateDetail` name it. */
const installTimeout = (step?: string) => new LiveError('builder_unavailable',
  step ? `phase_timeout:install:${step}` : 'phase_timeout:install');
/** Progress-based bound of the dependency install phase: `report` on every streamed tarball, sent put frame or
 * drained file keeps the stall timer quiet, the opaque `npm ci` sub-phase suspends it, and the absolute ceiling
 * always applies. The stall arms only on the first `report`, so a slow start (heavy-queue admission, forge
 * re-download, source transfer) is bounded by those inner timeouts plus the ceiling, never cut early by the stall.
 * A timeout aborts the signal handed to `work`, so in-flight fetch and supervisor frames stop instead of running on
 * as a zombie; it does not attest termination by itself, callers still quiesce and confirm teardown before
 * replacement. */
export async function withinInstallBudget<T>(work: (progress: InstallProgress, signal: AbortSignal) => Promise<T>,
  budget: InstallBudget = defaultInstallBudget()): Promise<T> {
  const controller = new AbortController();
  let stall: ReturnType<typeof setTimeout> | undefined;
  let ceiling: ReturnType<typeof setTimeout> | undefined;
  let suspended = false;
  let seen = false;
  let settled = false;
  let lastStep: string | undefined;
  let rejectStall!: (error: unknown) => void;
  let rejectCeiling!: (error: unknown) => void;
  const stalled = new Promise<never>((_resolve, reject) => { rejectStall = reject; });
  const expired = new Promise<never>((_resolve, reject) => { rejectCeiling = reject; });
  stalled.catch(() => undefined); expired.catch(() => undefined);
  const arm = () => {
    clearTimeout(stall); stall = undefined;
    if (!suspended && seen && !settled && !controller.signal.aborted) {
      stall = setTimeout(() => { controller.abort(); rejectStall(installTimeout(lastStep)); }, budget.stallMs); stall.unref();
    }
  };
  const progress: InstallProgress = { report: () => { if (!settled) { seen = true; arm(); } },
    suspendStall: suspend => { if (!settled) { suspended = suspend; arm(); } },
    step: name => { if (!settled && typeof name === 'string' && name.length > 0) lastStep = name; },
    clearStep: () => { if (!settled) lastStep = undefined; } };
  try {
    ceiling = setTimeout(() => { controller.abort(); rejectCeiling(installTimeout(lastStep)); }, budget.ceilingMs); ceiling.unref();
    // A cut install is aborted, but a stage that ignores the signal may still settle late; its late rejection
    // must never surface as an unhandled rejection after the race already settled.
    const run = work(progress, controller.signal); run.catch(() => undefined);
    return await Promise.race([run, stalled, expired]);
  } finally { settled = true; clearTimeout(stall); clearTimeout(ceiling); }
}
/** Bound of one cache lookup (Postgres SELECT + S3 GET): the warm-hit path has no other bound, so a hung lookup
 * would otherwise wait for the 20 min ceiling with no progress and no named sub-step (preprod 11/11). */
export const INSTALL_CACHE_LOOKUP_TIMEOUT_MS = 120_000;
/** Bound of one cache admission (S3 PUT + Postgres INSERT): same I/O family as the lookup, so the same 120 s
 * bound applies instead of waiting for the 20 min ceiling with the last completed step still named. */
export const INSTALL_CACHE_ADMIT_TIMEOUT_MS = 120_000;
/** Structured install sub-step log: one bounded line per completed sub-step (ok/fail) with duration and counts,
 * so a future timeout's completed prefix plus its ceiling/stall reason name the hanging sub-step. */
export interface InstallStepFields {
  msg: 'artifact_live_install_step'; step: string; ms: number; bytes?: number; files?: number;
  outcome: 'ok' | 'fail'; reason?: string;
}
export type InstallStepLogger = (fields: InstallStepFields) => void;
export const defaultStepLogger: InstallStepLogger = fields => logger.info(fields, fields.msg);
/** Runs one install sub-step: records it for the budget reason, times it, logs one bounded line on completion.
 * A sub-step `timeoutMs` throws `phase_timeout:install:<step>` (like the budget) so the phase log names it.
 * A `signal` abort (ceiling/stall cut) rejects promptly with the same step-named failure instead of waiting for
 * the inner timeout, so the fail line is emitted at the cut time rather than 120 s later. On success the budget's
 * last-step is cleared so a later gap hang blames no completed step. */
export async function runInstallStep<T>(progress: Pick<InstallProgress, 'step' | 'clearStep'> | undefined, step: string,
  work: () => Promise<T>, options: { log?: InstallStepLogger; now?: () => number; timeoutMs?: number; signal?: AbortSignal;
    counts?: (result: T | undefined) => { bytes?: number; files?: number } } = {}): Promise<T> {
  const log = options.log ?? defaultStepLogger;
  const now = options.now ?? Date.now;
  const signal = options.signal;
  progress?.step?.(step);
  const started = now();
  // The abort cut is deferred one macrotask so a work that handles the abort itself (supervisor frames
  // rejecting with their own LiveError, including a pre-aborted signal the channel refuses at once) wins the
  // race with its meaningful reason; a hung work that ignores the signal is still cut promptly with the
  // step-named timeout instead of waiting for the inner bound. No upfront throw: it would mask the work's own
  // pre-abort refusal (e.g. supervisor_channel_aborted from the post-drain clear).
  let onAbort: (() => void) | undefined;
  let abortTimer: ReturnType<typeof setTimeout> | undefined;
  const aborted = signal ? new Promise<never>((_resolve, reject) => {
    const fire = () => {
      abortTimer = setTimeout(() => reject(new LiveError('builder_unavailable', 'phase_timeout')), 0);
      abortTimer.unref?.();
    };
    if (signal.aborted) fire();
    else { onAbort = fire; signal.addEventListener('abort', onAbort, { once: true }); }
  }) : undefined;
  aborted?.catch(() => undefined);
  try {
    let result: T;
    if (options.timeoutMs !== undefined) {
      result = await withinPhase(work(), options.timeoutMs, signal);
    } else if (aborted) {
      result = await Promise.race([work(), aborted]);
    } else {
      result = await work();
    }
    const { bytes, files } = options.counts?.(result) ?? {};
    log({ msg: 'artifact_live_install_step', step, ms: now() - started, ...(bytes !== undefined ? { bytes } : {}),
      ...(files !== undefined ? { files } : {}), outcome: 'ok' });
    progress?.clearStep?.();
    return result;
  } catch (error) {
    const failure = error instanceof LiveError && error.code === 'builder_unavailable' && error.reason === 'phase_timeout'
      ? new LiveError(error.code, `phase_timeout:install:${step}`, error.detail) : error;
    const reason = failure instanceof LiveError ? (failure.reason ? `${failure.code}:${failure.reason}` : failure.code)
      : 'builder_unavailable';
    const { bytes, files } = options.counts?.(undefined) ?? {};
    log({ msg: 'artifact_live_install_step', step, ms: now() - started, ...(bytes !== undefined ? { bytes } : {}),
      ...(files !== undefined ? { files } : {}), outcome: 'fail', reason });
    throw failure;
  } finally {
    if (signal && onAbort) signal.removeEventListener('abort', onAbort);
    if (abortTimer) clearTimeout(abortTimer);
  }
}
/** Key hash for phase logs: the ledger identity is never logged raw. */
export function phaseKeyHash(key: { storageScopeId: string; artifactId: string }): string {
  return createHash('sha256').update(JSON.stringify([key.storageScopeId, key.artifactId])).digest('hex');
}
/** One phase log line: `artifact_live_phase` with the key hash, phase, duration, outcome and reason; no secret.
 * The start line carries `reason: 'started'` so an aggregation over `outcome` never mistakes a start for a success.
 * The fail line carries `detail` only when the error brings log-only diagnostics (a scrubbed bounded recipe tail);
 * the job ledger and `stateDetail` still see the closed `reason` alone. */
export interface PhaseLogFields {
  msg: 'artifact_live_phase'; key: string; phase: string; ms: number; outcome: 'ok' | 'fail'; reason?: string;
  detail?: string;
}
export type PhaseLogger = (fields: PhaseLogFields) => void;
const defaultPhaseLogger: PhaseLogger = ({ msg, ...fields }) => logger.info(fields, msg);
/** Runs one named heavy phase, logging its start, end, duration and failing phase name on the build-only and live
 * paths. A bare `phase_timeout` from `withinPhase` is rewritten to `phase_timeout:<phase>` so the job ledger and
 * `stateDetail` name the failing phase on every path, not just the install watchdog. */
export async function runPhase<T>(key: { storageScopeId: string; artifactId: string }, phase: string,
  work: () => Promise<T>, options: { log?: PhaseLogger; now?: () => number } = {}): Promise<T> {
  const log = options.log ?? defaultPhaseLogger; const now = options.now ?? Date.now;
  const hashed = phaseKeyHash(key); const started = now();
  log({ msg: 'artifact_live_phase', key: hashed, phase, ms: 0, outcome: 'ok', reason: 'started' });
  try {
    const result = await work();
    log({ msg: 'artifact_live_phase', key: hashed, phase, ms: now() - started, outcome: 'ok' });
    return result;
  } catch (error) {
    const failure = error instanceof LiveError && error.code === 'builder_unavailable' && error.reason === 'phase_timeout'
      ? new LiveError(error.code, `phase_timeout:${phase}`) : error;
    const reason = failure instanceof LiveError ? (failure.reason ? `${failure.code}:${failure.reason}` : failure.code)
      : 'builder_unavailable';
    // Scrubbed at the source and again here, so a detail that bypassed the recipe reader still never logs a secret.
    const detail = failure instanceof LiveError && failure.detail !== undefined
      ? truncateRecipeTail(scrubRecipeOutput(failure.detail)) : undefined;
    log({ msg: 'artifact_live_phase', key: hashed, phase, ms: now() - started, outcome: 'fail', reason,
      ...(detail === undefined ? {} : { detail }) });
    throw failure;
  }
}
