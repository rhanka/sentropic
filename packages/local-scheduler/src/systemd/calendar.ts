import { hasControlChars } from '../contract.js';
import { EXPECTED_PRESET_INTERVALS_MS, ON_CALENDAR_CUSTOM_REGEX, ON_CALENDAR_PRESETS } from '../contract-types.js';
import { InvalidTaskSpecError, SchedulerUnavailableError } from '../errors.js';
import { defaultExecFile, type ExecFileFn } from './systemctl.js';

export async function computeExpectedIntervalMsWith(
  onCalendar: string,
  execFn: ExecFileFn = defaultExecFile,
): Promise<number> {
  if (typeof onCalendar !== 'string' || hasControlChars(onCalendar) || onCalendar.endsWith('\\')) {
    throw new InvalidTaskSpecError('INVALID_TASK_SPEC', 'invalid schedule.onCalendar', 'schedule.onCalendar');
  }
  if ((ON_CALENDAR_PRESETS as readonly string[]).includes(onCalendar)) {
    return EXPECTED_PRESET_INTERVALS_MS[onCalendar as (typeof ON_CALENDAR_PRESETS)[number]];
  }
  if (!ON_CALENDAR_CUSTOM_REGEX.test(onCalendar)) {
    throw new InvalidTaskSpecError('INVALID_TASK_SPEC', 'schedule.onCalendar failed allow-list', 'schedule.onCalendar');
  }
  let stdout: string;
  try {
    ({ stdout } = await execFn('systemd-analyze', ['calendar', '--iterations=8', '--', onCalendar], {
      timeout: 10_000,
      env: { ...process.env, TZ: 'UTC', LC_ALL: 'C' },
    }));
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stderr?: string };
    if (e.code === 'ENOENT') throw new SchedulerUnavailableError('no-systemctl', 'systemd-analyze binary not found', { cause: err });
    throw new InvalidTaskSpecError('INVALID_TASK_SPEC', `invalid OnCalendar expression: ${(e.stderr || e.message).trim()}`, 'schedule.onCalendar', { cause: err });
  }
  const timestamps: number[] = [];
  for (const match of stdout.matchAll(/^\s*(?:Next elapse|Iteration #\d+):\s*(.+)$/gm)) {
    const ms = Date.parse(match[1].trim());
    if (Number.isFinite(ms)) timestamps.push(ms);
  }
  if (timestamps.length < 2) {
    throw new InvalidTaskSpecError('INVALID_TASK_SPEC', 'schedule.onCalendar must yield at least 2 future iterations', 'schedule.onCalendar');
  }
  let maxGap = 0;
  for (let i = 1; i < timestamps.length; i += 1) {
    const gap = timestamps[i] - timestamps[i - 1];
    if (gap > maxGap) maxGap = gap;
  }
  if (!Number.isFinite(maxGap) || maxGap < 60_000) {
    throw new InvalidTaskSpecError('INVALID_TASK_SPEC', 'schedule.onCalendar interval must be >= 60_000 ms', 'schedule.onCalendar');
  }
  return maxGap;
}

/** Computes nominal expectedIntervalMs for presets or custom OnCalendar expressions (§2.1, §4.2). */
export function computeExpectedIntervalMs(onCalendar: string): Promise<number> {
  return computeExpectedIntervalMsWith(onCalendar, defaultExecFile);
}
