export const LOCAL_TASK_SPEC_V1 = 1 as const;
export const LOCAL_TASK_MANIFEST_V1 = 1 as const;
export const ON_CALENDAR_PRESETS = ['hourly', 'daily', 'weekly', 'monthly'] as const;
/**
 * Strict allow-list for custom systemd OnCalendar expressions:
 * - Presets: hourly | daily | weekly | monthly
 * - Custom: 1..64 ASCII chars in [0-9A-Za-z*,./:~ -], no '%', no leading '-', no trailing '\'.
 */
export const ON_CALENDAR_CUSTOM_REGEX = /^(?!-)[0-9A-Za-z*,./:~ -]{1,64}$/;
export const EXPECTED_PRESET_INTERVALS_MS: Readonly<Record<(typeof ON_CALENDAR_PRESETS)[number], number>> = {
  hourly: 3_600_000,
  daily: 86_400_000,
  weekly: 604_800_000,
  monthly: 2_678_400_000,
};
/** Loader/runtime-injection env vars forbidden in command.env, envAllowlist, child env, and unit env. */
export const BLOCKED_LOADER_ENV_VARS = [
  'NODE_OPTIONS',
  'NODE_PATH',
  'LD_PRELOAD',
  'LD_LIBRARY_PATH',
  'LD_AUDIT',
] as const;

export interface LocalTaskScheduleV1 {
  readonly onCalendar: string;
  readonly persistent: boolean;
  readonly randomizedDelaySec?: number;
  readonly accuracySec?: number;
  readonly expectedIntervalMs?: number;
  readonly graceMultiplier?: number;
}
export interface LocalTaskCommandV1 {
  readonly bin: string;
  readonly args: readonly string[];
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly envAllowlist?: readonly string[];
}
export interface LocalTaskResourcesV1 {
  readonly nice?: number;
  readonly ioSchedulingClass?: 'idle' | 'best-effort';
  readonly memoryMax?: string;
  readonly cpuQuota?: string;
  readonly tasksMax?: number;
}
export interface LocalTaskSpecV1 {
  readonly v: typeof LOCAL_TASK_SPEC_V1;
  readonly taskId: string;
  readonly owner: string;
  readonly description: string;
  readonly schedule: LocalTaskScheduleV1;
  readonly command: LocalTaskCommandV1;
  readonly timeoutMs: number;
  readonly killGraceMs?: number;
  readonly killSwitchEnv?: string;
  readonly resources?: LocalTaskResourcesV1;
}
export interface LocalTaskRunnerEntryV1 {
  readonly bin: string;
  readonly args: readonly string[];
}
export interface LocalTaskManifestV1 {
  readonly v: typeof LOCAL_TASK_MANIFEST_V1;
  readonly spec: LocalTaskSpecV1;
  readonly runner: LocalTaskRunnerEntryV1;
  readonly enabled: boolean;
  readonly installedAt: string;
  readonly enabledAt: string;
  readonly stateDir: string;
  readonly envFilePath: string;
  readonly expectedIntervalMs: number;
  readonly units: {
    readonly serviceSha256: string;
    readonly timerSha256: string;
  };
}
export interface EnablePolicyV1 {
  readonly runner: LocalTaskRunnerEntryV1;
  readonly allowedBins: readonly string[];
  readonly allowedScripts?: readonly string[];
  readonly unitDir?: string;
  readonly stateDir?: string;
  readonly envFilePath?: string;
  readonly runtime?: boolean;
}
export interface EnableResultV1 {
  readonly manifest: LocalTaskManifestV1;
  readonly servicePath: string;
  readonly timerPath: string;
  readonly lingerEnabled: boolean | null;
  readonly lingerNotice?: string;
}
export interface DisableResultV1 {
  readonly taskId: string;
  readonly manifest: LocalTaskManifestV1;
}
export interface UninstallOptionsV1 {
  readonly purgeState?: boolean;
  readonly unitDir?: string;
  readonly stateDir?: string;
  readonly runtime?: boolean;
}
export interface UninstallResultV1 {
  readonly taskId: string;
  readonly removedUnits: readonly string[];
  readonly purgedState: boolean;
}
export interface SystemdRuntimeStateV1 {
  readonly timerUnitFileState: string;
  readonly timerActive: string;
  readonly nextElapse: string | null;
  readonly lastTrigger: string | null;
  readonly lastTriggerMonotonicUs: number | null;
  readonly serviceActive: string;
  readonly serviceResult: string | null;
  readonly execMainStatus: number | null;
  readonly execMainExitTimestamp: string | null;
  readonly execDiagnostic?: string;
}
