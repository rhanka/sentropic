import {
  EXPECTED_PRESET_INTERVALS_MS,
  ON_CALENDAR_PRESETS,
  type DisableResultV1,
  type EnablePolicyV1,
  type EnableResultV1,
  type LocalTaskManifestV1,
  type LocalTaskSpecV1,
  type SystemdRuntimeStateV1,
  type UninstallOptionsV1,
  type UninstallResultV1,
} from './contract-types.js';
import { InvalidTaskSpecError } from './errors.js';
import type { LocalTaskHealthVerdict, LocalTaskLockSummaryV1 } from './health.js';
import type { LocalTaskSkipEntryV1, LocalTaskWitnessV1 } from './witness.js';

export interface LocalTaskStatusV1 {
  readonly manifest: LocalTaskManifestV1 | null | 'corrupt';
  readonly witness: LocalTaskWitnessV1 | null | 'corrupt';
  readonly lock?: LocalTaskLockSummaryV1 | null | 'unreadable';
  readonly lastSkip?: LocalTaskSkipEntryV1 | null;
  readonly health: LocalTaskHealthVerdict;
  readonly systemd: SystemdRuntimeStateV1 | 'unavailable';
  readonly lingerEnabled: boolean | null;
}

export interface OsSchedulerAdapter {
  enable(spec: LocalTaskSpecV1, policy: EnablePolicyV1): Promise<EnableResultV1>;
  disable(taskId: string, opts?: { readonly unitDir?: string; readonly stateDir?: string; readonly runtime?: boolean }): Promise<DisableResultV1>;
  status(taskId: string, opts?: { readonly stateDir?: string; readonly nowIso?: string }): Promise<LocalTaskStatusV1>;
  uninstall(taskId: string, opts?: UninstallOptionsV1): Promise<UninstallResultV1>;
}

export interface FakeSchedulerAdapter extends OsSchedulerAdapter {
  setWitness(taskId: string, witness: LocalTaskWitnessV1 | null | 'corrupt'): void;
  setPersistedEnvFile(text: string): void;
  setSystemdState(state: SystemdRuntimeStateV1 | 'unavailable', lingerEnabled?: boolean | null): void;
  getRenderedUnits(taskId: string): { readonly service: string; readonly timer: string } | null;
}

export const DEFAULT_FAKE_SYSTEMD_STATE: SystemdRuntimeStateV1 = {
  timerUnitFileState: 'enabled',
  timerActive: 'active',
  nextElapse: null,
  lastTrigger: null,
  lastTriggerMonotonicUs: null,
  serviceActive: 'inactive',
  serviceResult: 'success',
  execMainStatus: 0,
  execMainExitTimestamp: null,
};

export function computeFakeExpectedIntervalMs(spec: LocalTaskSpecV1): number {
  const cal = spec.schedule.onCalendar;
  const preset = (ON_CALENDAR_PRESETS as readonly string[]).includes(cal)
    ? EXPECTED_PRESET_INTERVALS_MS[cal as (typeof ON_CALENDAR_PRESETS)[number]]
    : undefined;
  const expected = preset ?? spec.schedule.expectedIntervalMs ?? 86_400_000;
  if (spec.schedule.expectedIntervalMs !== undefined && preset !== undefined) {
    if (Math.abs(spec.schedule.expectedIntervalMs - preset) / preset > 0.1) {
      throw new InvalidTaskSpecError(
        'INTERVAL_MISMATCH',
        `schedule.expectedIntervalMs (${spec.schedule.expectedIntervalMs}) deviates > 10% from ${cal} (${preset})`,
        'schedule.expectedIntervalMs',
      );
    }
  }
  return expected;
}
