import { createHash } from 'node:crypto';
import { logger } from '../../../logger';
import { LiveError } from './records';

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
export interface InstallBudget { stallMs: number; ceilingMs: number }
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
export interface InstallProgress { report(): void; suspendStall(suspended: boolean): void }
/** A timeout does not attest termination: callers must quiesce and confirm teardown before replacement. */
export async function withinPhase<T>(work: Promise<T>, milliseconds = PHASE_DEADLINE_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([work, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new LiveError('builder_unavailable', 'phase_timeout')), milliseconds); timer.unref();
    })]);
  } finally { clearTimeout(timer); }
}
/** Install-phase failure: the failing phase rides in the reason, so the job ledger and `stateDetail` name it. */
const installTimeout = () => new LiveError('builder_unavailable', 'phase_timeout:install');
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
  let rejectStall!: (error: unknown) => void;
  let rejectCeiling!: (error: unknown) => void;
  const stalled = new Promise<never>((_resolve, reject) => { rejectStall = reject; });
  const expired = new Promise<never>((_resolve, reject) => { rejectCeiling = reject; });
  stalled.catch(() => undefined); expired.catch(() => undefined);
  const arm = () => {
    clearTimeout(stall); stall = undefined;
    if (!suspended && seen && !settled && !controller.signal.aborted) {
      stall = setTimeout(() => { controller.abort(); rejectStall(installTimeout()); }, budget.stallMs); stall.unref();
    }
  };
  const progress: InstallProgress = { report: () => { if (!settled) { seen = true; arm(); } },
    suspendStall: suspend => { if (!settled) { suspended = suspend; arm(); } } };
  try {
    ceiling = setTimeout(() => { controller.abort(); rejectCeiling(installTimeout()); }, budget.ceilingMs); ceiling.unref();
    // A cut install is aborted, but a stage that ignores the signal may still settle late; its late rejection
    // must never surface as an unhandled rejection after the race already settled.
    const run = work(progress, controller.signal); run.catch(() => undefined);
    return await Promise.race([run, stalled, expired]);
  } finally { settled = true; clearTimeout(stall); clearTimeout(ceiling); }
}
/** Key hash for phase logs: the ledger identity is never logged raw. */
export function phaseKeyHash(key: { storageScopeId: string; artifactId: string }): string {
  return createHash('sha256').update(JSON.stringify([key.storageScopeId, key.artifactId])).digest('hex');
}
/** One phase log line: `artifact_live_phase` with the key hash, phase, duration, outcome and reason; no secret.
 * The start line carries `reason: 'started'` so an aggregation over `outcome` never mistakes a start for a success. */
export interface PhaseLogFields {
  msg: 'artifact_live_phase'; key: string; phase: string; ms: number; outcome: 'ok' | 'fail'; reason?: string;
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
    log({ msg: 'artifact_live_phase', key: hashed, phase, ms: now() - started, outcome: 'fail', reason });
    throw failure;
  }
}
