import type { LocalTaskManifestV1 } from './contract-types.js';
import type { LocalTaskKillSwitchMatchV1 } from './env-file.js';
import type { LocalTaskSkipEntryV1, LocalTaskWitnessV1 } from './witness.js';

export type LocalTaskHealthStatus =
  | 'healthy'
  | 'not_installed'
  | 'unobservable'
  | 'disabled'
  | 'paused'
  | 'pending_first_run'
  | 'interrupted'
  | 'failing'
  | 'schedule_missed'
  | 'clock_skew'
  | 'witness_corrupt';

export interface LocalTaskLockSummaryV1 {
  readonly pid: number;
  readonly phase: 'acquired' | 'spawning' | 'running';
  readonly acquiredAt: string;
}
export interface EvaluateTaskHealthInput {
  readonly stateDirObservable?: boolean;
  readonly manifest: LocalTaskManifestV1 | null | 'corrupt';
  readonly witness: LocalTaskWitnessV1 | null | 'corrupt';
  readonly persistedKillSwitch?: LocalTaskKillSwitchMatchV1 | null;
  readonly readerEnvKillSwitch?: LocalTaskKillSwitchMatchV1 | null;
  readonly lock?: LocalTaskLockSummaryV1 | null | 'unreadable';
  readonly lastSkip?: LocalTaskSkipEntryV1 | null;
  readonly envFileProtectedOverrides?: readonly string[];
  readonly nowIso: string;
  readonly clockSkewToleranceMs?: number;
}
export interface LocalTaskHealthVerdict {
  readonly status: LocalTaskHealthStatus;
  readonly severity: 'ok' | 'warning' | 'critical';
  readonly overdueByMs?: number;
  readonly consecutiveFailures: number;
  readonly lastSuccessAt: string | null;
  readonly opsReason?: 'job-failed' | 'deadline-exceeded' | 'schedule-missed' | 'stale';
  readonly message: string;
  readonly hints: readonly string[];
}

function collectHints(input: EvaluateTaskHealthInput, status: LocalTaskHealthStatus): string[] {
  const hints: string[] = [];
  if (status === 'not_installed') hints.push('task is not installed');
  if (input.readerEnvKillSwitch) {
    hints.push(`reader process env sets ${input.readerEnvKillSwitch.name}; this does not pause the systemd user timer`);
  }
  const witnessValid = input.witness !== null && input.witness !== 'corrupt' ? input.witness : null;
  if (input.persistedKillSwitch && status !== 'paused' && status !== 'disabled') {
    if (status === 'schedule_missed') {
      hints.push(`env file sets ${input.persistedKillSwitch.name}, but no tick is recorded since ${witnessValid?.finishedAt ?? 'enable'}; the timer may be stopped`);
    } else {
      hints.push(`persisted env file sets ${input.persistedKillSwitch.name}; next scheduled tick will pause`);
    }
  }
  const skipAfterWitness =
    input.lastSkip?.outcome === 'skipped_locked' &&
    (!witnessValid || Date.parse(input.lastSkip.at) > Date.parse(witnessValid.finishedAt));
  if (skipAfterWitness) {
    if (input.lock && input.lock !== 'unreadable') {
      hints.push(`recent ticks found the lock held by pid ${input.lock.pid} (phase ${input.lock.phase}) since ${input.lock.acquiredAt}; if no run is active, a reboot clears it`);
    } else if (input.lock === 'unreadable') {
      hints.push('recent ticks found an unreadable lock file; if no run is active, a reboot clears it');
    }
  }
  for (const v of input.envFileProtectedOverrides ?? []) {
    hints.push(`env file sets ${v}; runner enforces constant child PATH and manifest.stateDir parity — remove ${v} from the env file`);
  }
  return hints;
}

/** Pure, zero-I/O dead-man, pause, and failure evaluator (§2.6). */
export function evaluateTaskHealth(input: EvaluateTaskHealthInput): LocalTaskHealthVerdict {
  const w = input.witness && input.witness !== 'corrupt' ? input.witness : null;
  const consecutiveFailures = w ? w.consecutiveFailures : 0;
  const lastSuccessAt = w ? w.lastSuccessAt : null;
  const finish = (
    status: LocalTaskHealthStatus,
    severity: 'ok' | 'warning' | 'critical',
    message: string,
    extra?: { overdueByMs?: number; opsReason?: LocalTaskHealthVerdict['opsReason'] },
  ): LocalTaskHealthVerdict => ({
    status,
    severity,
    ...(extra?.overdueByMs !== undefined ? { overdueByMs: extra.overdueByMs } : {}),
    consecutiveFailures,
    lastSuccessAt,
    ...(extra?.opsReason !== undefined ? { opsReason: extra.opsReason } : {}),
    message,
    hints: collectHints(input, status),
  });

  if (input.stateDirObservable === false) {
    return finish('unobservable', 'warning', 'scheduler state directory is unobservable from this environment');
  }
  if (input.manifest === null) return finish('not_installed', 'ok', 'task is not installed');
  if (input.manifest === 'corrupt') return finish('witness_corrupt', 'critical', 'task manifest is corrupt', { opsReason: 'stale' });
  if (!input.manifest.enabled) return finish('disabled', 'ok', 'task is disabled');
  if (input.witness === 'corrupt') return finish('witness_corrupt', 'critical', 'last-run witness is corrupt', { opsReason: 'stale' });

  const deadlineMs = Math.round(input.manifest.expectedIntervalMs * (input.manifest.spec.schedule.graceMultiplier ?? 1.5));
  const skewMs = input.clockSkewToleranceMs ?? 300_000;
  const now = Date.parse(input.nowIso);
  const enabledAtMs = Date.parse(input.manifest.enabledAt);
  const lastSuccessMs = w?.lastSuccessAt ? Date.parse(w.lastSuccessAt) : -Infinity;
  const freshnessRefMs = Math.max(lastSuccessMs, enabledAtMs);

  if (w === null) {
    const elapsed = now - enabledAtMs;
    return elapsed <= deadlineMs
      ? finish('pending_first_run', 'ok', 'awaiting first scheduled run')
      : finish('schedule_missed', 'critical', 'first scheduled run missed deadline', { overdueByMs: elapsed - deadlineMs, opsReason: 'schedule-missed' });
  }
  const finishedAtMs = Date.parse(w.finishedAt);
  if (finishedAtMs - now > skewMs || (w.lastSuccessAt !== null && lastSuccessMs - now > skewMs)) {
    return finish('clock_skew', 'warning', 'witness timestamp exceeds clock skew tolerance', { opsReason: 'stale' });
  }
  if (w.outcome === 'skipped_disabled' && now - finishedAtMs <= deadlineMs) {
    const overdueByMs = now - freshnessRefMs - deadlineMs;
    const msg = `paused since ${w.finishedAt} by ${w.killSwitch?.name ?? 'kill-switch'}; last success ${w.lastSuccessAt ?? 'never'}`;
    return overdueByMs > 0
      ? finish('paused', 'warning', msg, { overdueByMs })
      : finish('paused', 'ok', msg);
  }
  if (w.outcome === 'refused_policy') {
    return finish('failing', 'critical', `execution refused by policy (${w.refusal ?? 'unknown'})`, { opsReason: 'job-failed' });
  }
  if (w.outcome === 'timed_out') {
    return finish('failing', 'critical', `last run timed out after ${w.durationMs}ms`, { opsReason: 'deadline-exceeded' });
  }
  if (w.outcome === 'failed') {
    const critical = w.consecutiveFailures >= 2 || now - freshnessRefMs > deadlineMs;
    return finish('failing', critical ? 'critical' : 'warning', `last run failed (consecutive failures: ${w.consecutiveFailures})`, { opsReason: 'job-failed' });
  }
  if (w.outcome === 'interrupted' && now - freshnessRefMs <= deadlineMs) {
    return finish('interrupted', 'warning', `last run interrupted (${w.signal ?? 'signal'})`);
  }
  if (now - freshnessRefMs > deadlineMs) {
    return finish('schedule_missed', 'critical', 'scheduled run missed dead-man deadline', {
      overdueByMs: now - freshnessRefMs - deadlineMs,
      opsReason: 'schedule-missed',
    });
  }
  const message =
    w.outcome === 'skipped_disabled'
      ? `last tick paused at ${w.finishedAt}; re-enabled at ${input.manifest.enabledAt}`
      : `last run succeeded at ${w.finishedAt}`;
  return finish('healthy', 'ok', message);
}
