import { createHash } from 'node:crypto';
import { logger } from '../../../logger';
import { LiveError } from './records';

/** Bound of one heavy phase; the recipes carry the same 300 s timeout. */
export const PHASE_DEADLINE_MS = 300_000;
/** Env override of the install stall bound: no install progress observed for this long fails the phase. */
export const INSTALL_STALL_MS_ENV = 'ARTIFACT_INSTALL_STALL_MS';
/** Env override of the install absolute ceiling: a cold install never runs past this. */
export const INSTALL_CEILING_MS_ENV = 'ARTIFACT_INSTALL_CEILING_MS';
/** No install progress (tarball streamed, file drained) for this long fails the install, even cold. */
export const INSTALL_STALL_MS_DEFAULT = 60_000;
/** A cold cache of ~1,500 packages / ~1 GB at the measured relay rate (~3.4 MB/s, ~5 min of fetch) plus the offline
 * `npm ci`, the source transfer and the cache drain fits in 20 min with headroom; a cut install never poisons the
 * cache (admission is atomic), so a retry starts cold again instead of resuming a half-written entry. */
export const INSTALL_CEILING_MS_DEFAULT = 1_200_000;
/** Progress-based bound of the dependency install phase: stall watchdog plus absolute ceiling. */
export interface InstallBudget { stallMs: number; ceilingMs: number }
export const defaultInstallBudget = (): InstallBudget =>
  ({ stallMs: INSTALL_STALL_MS_DEFAULT, ceilingMs: INSTALL_CEILING_MS_DEFAULT });
const positive = (value: string | undefined) => {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
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
/** Progress-based bound of the dependency install phase: `report` on every streamed tarball or drained file keeps
 * the stall timer quiet, the opaque `npm ci` sub-phase suspends it, and the absolute ceiling always applies. A
 * timeout does not attest termination: callers must quiesce and confirm teardown before replacement. */
export async function withinInstallBudget<T>(work: (progress: InstallProgress) => Promise<T>,
  budget: InstallBudget = defaultInstallBudget()): Promise<T> {
  let stall: ReturnType<typeof setTimeout> | undefined;
  let ceiling: ReturnType<typeof setTimeout> | undefined;
  let suspended = false;
  let rejectStall!: (error: unknown) => void;
  let rejectCeiling!: (error: unknown) => void;
  const stalled = new Promise<never>((_resolve, reject) => { rejectStall = reject; });
  const expired = new Promise<never>((_resolve, reject) => { rejectCeiling = reject; });
  stalled.catch(() => undefined); expired.catch(() => undefined);
  const arm = () => {
    clearTimeout(stall);
    if (!suspended) { stall = setTimeout(() => rejectStall(installTimeout()), budget.stallMs); stall.unref(); }
  };
  const progress: InstallProgress = { report: () => arm(),
    suspendStall: suspend => { suspended = suspend; arm(); } };
  try {
    ceiling = setTimeout(() => rejectCeiling(installTimeout()), budget.ceilingMs); ceiling.unref();
    arm();
    // A cut install keeps streaming in the background (a late success still admits a verified entry); its late
    // rejection must never surface as an unhandled rejection after the race already settled.
    const run = work(progress); run.catch(() => undefined);
    return await Promise.race([run, stalled, expired]);
  } finally { clearTimeout(stall); clearTimeout(ceiling); }
}
/** Key hash for phase logs: the ledger identity is never logged raw. */
export function phaseKeyHash(key: { storageScopeId: string; artifactId: string }): string {
  return createHash('sha256').update(JSON.stringify([key.storageScopeId, key.artifactId])).digest('hex');
}
/** One phase log line: `artifact_live_phase` with the key hash, phase, duration, outcome and reason; no secret. */
export interface PhaseLogFields {
  msg: 'artifact_live_phase'; key: string; phase: string; ms: number; outcome: 'ok' | 'fail'; reason?: string;
}
export type PhaseLogger = (fields: PhaseLogFields) => void;
const defaultPhaseLogger: PhaseLogger = ({ msg, ...fields }) => logger.info(fields, msg);
/** Runs one named heavy phase, logging its start, end, duration and failing phase name on the build-only and live
 * paths; the error itself is unchanged (the reason already carries the phase for the install watchdog). */
export async function runPhase<T>(key: { storageScopeId: string; artifactId: string }, phase: string,
  work: () => Promise<T>, options: { log?: PhaseLogger; now?: () => number } = {}): Promise<T> {
  const log = options.log ?? defaultPhaseLogger; const now = options.now ?? Date.now;
  const hashed = phaseKeyHash(key); const started = now();
  log({ msg: 'artifact_live_phase', key: hashed, phase, ms: 0, outcome: 'ok' });
  try {
    const result = await work();
    log({ msg: 'artifact_live_phase', key: hashed, phase, ms: now() - started, outcome: 'ok' });
    return result;
  } catch (error) {
    const reason = error instanceof LiveError ? (error.reason ? `${error.code}:${error.reason}` : error.code)
      : 'builder_unavailable';
    log({ msg: 'artifact_live_phase', key: hashed, phase, ms: now() - started, outcome: 'fail', reason });
    throw error;
  }
}
