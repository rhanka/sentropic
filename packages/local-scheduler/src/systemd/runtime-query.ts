import type { SystemdRuntimeStateV1 } from '../contract-types.js';
import { SystemctlFailedError } from '../errors.js';
import type { readTaskWitness } from '../witness.js';
import {
  normalizeShowProp, parseShowProperties, parseSystemdTimestampMs,
  probeLingerEnabledWith, probeSystemdUserAvailabilityWith, runSystemctl,
  type ExecFileFn,
} from './systemctl.js';

export const TASK_ID_REGEX = /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/;

export function isNotLoadedError(err: unknown): boolean {
  const msg = err instanceof SystemctlFailedError ? err.stderr : String(err);
  return /not loaded|does not exist|not found|No such file/i.test(msg);
}

export function isBenignCleanError(err: unknown): boolean {
  if (isNotLoadedError(err)) return true;
  const msg = err instanceof SystemctlFailedError ? err.stderr : String(err);
  return /No matching resources found|NothingToClean/i.test(msg);
}

export async function querySystemdRuntime(
  serviceName: string,
  timerName: string,
  witness: ReturnType<typeof readTaskWitness>,
  execFn: ExecFileFn,
): Promise<{ readonly systemd: SystemdRuntimeStateV1 | 'unavailable'; readonly lingerEnabled: boolean | null }> {
  const avail = await probeSystemdUserAvailabilityWith(process.platform, execFn);
  if (!avail.available) return { systemd: 'unavailable', lingerEnabled: null };
  const showEnv = { ...process.env, TZ: 'UTC', LC_ALL: 'C' };
  const [tOut, sOut, lingerEnabled] = await Promise.all([
    runSystemctl(['show', '--property=UnitFileState,ActiveState,NextElapseUSecRealtime,LastTriggerUSec,LastTriggerUSecMonotonic', '--', timerName], execFn, showEnv).catch(() => ''),
    runSystemctl(['show', '--property=ActiveState,Result,ExecMainStatus,ExecMainExitTimestamp', '--', serviceName], execFn, showEnv).catch(() => ''),
    probeLingerEnabledWith(execFn),
  ]);
  const t = parseShowProperties(tOut);
  const s = parseShowProperties(sOut);
  const monoRaw = normalizeShowProp(t.LastTriggerUSecMonotonic);
  const monoNum = monoRaw !== null && Number.isFinite(Number(monoRaw)) && Number(monoRaw) > 0 ? Number(monoRaw) : null;
  const exitTs = normalizeShowProp(s.ExecMainExitTimestamp);
  const statusRaw = normalizeShowProp(s.ExecMainStatus);
  const statusNum = statusRaw !== null && Number.isInteger(Number(statusRaw)) && (exitTs !== null || Number(statusRaw) !== 0) ? Number(statusRaw) : null;
  let execDiagnostic: string | undefined;
  if (statusNum === 203) {
    execDiagnostic = 'runner binary moved or not executable (203/EXEC); re-run enable';
  } else if (statusNum === 77) {
    const exitMs = parseSystemdTimestampMs(exitTs);
    const wMs = witness && witness !== 'corrupt' ? Date.parse(witness.finishedAt) : NaN;
    execDiagnostic = witness && witness !== 'corrupt' && witness.outcome === 'refused_policy' && Number.isFinite(wMs) && exitMs !== null && wMs >= exitMs - 5_000
      ? `command refused by the allow-list (${witness.refusal ?? 'allowlist'}); re-run enable`
      : `refused before the lock: host PID guard (unit sandboxing) or state directory/manifest ownership or mode; see journalctl --user -u ${serviceName}`;
  }
  return {
    lingerEnabled,
    systemd: {
      timerUnitFileState: normalizeShowProp(t.UnitFileState) ?? 'unknown',
      timerActive: normalizeShowProp(t.ActiveState) ?? 'unknown',
      nextElapse: normalizeShowProp(t.NextElapseUSecRealtime),
      lastTrigger: normalizeShowProp(t.LastTriggerUSec),
      lastTriggerMonotonicUs: monoNum,
      serviceActive: normalizeShowProp(s.ActiveState) ?? 'unknown',
      serviceResult: normalizeShowProp(s.Result),
      execMainStatus: statusNum,
      execMainExitTimestamp: exitTs,
      ...(execDiagnostic ? { execDiagnostic } : {}),
    },
  };
}
