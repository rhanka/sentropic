import { InvalidTaskSpecError } from './errors.js';
import {
  BLOCKED_LOADER_ENV_VARS,
  LOCAL_TASK_SPEC_V1,
  ON_CALENDAR_CUSTOM_REGEX,
  ON_CALENDAR_PRESETS,
  type LocalTaskCommandV1,
  type LocalTaskResourcesV1,
  type LocalTaskScheduleV1,
  type LocalTaskSpecV1,
} from './contract-types.js';

const CONTROL_CHARS = /[\x00-\x1f\x7f]/;
const ENV_NAME_REGEX = /^[A-Za-z_][A-Za-z0-9_]*$/;
const TASK_ID_REGEX = /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/;
const OWNER_REGEX = /^[a-z0-9][a-z0-9-]{0,31}$/;
const SECRET_ENV_REGEX =
  /(?:^|_)(?:TOKEN|SECRET|KEY|PASSWORD|CREDENTIAL[A-Z0-9_]*)$|^(?:ANTHROPIC|OPENAI|GEMINI|AWS)_/i;

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
export function hasControlChars(s: string): boolean {
  return CONTROL_CHARS.test(s);
}
export function isBlockedLoaderEnvVar(name: string): boolean {
  return (BLOCKED_LOADER_ENV_VARS as readonly string[]).includes(name);
}
export function isSecretEnvVarName(name: string): boolean {
  return SECRET_ENV_REGEX.test(name);
}
function fail(message: string, field?: string): never {
  throw new InvalidTaskSpecError('INVALID_TASK_SPEC', message, field);
}
function checkBoundedNumber(v: unknown, min: number, max: number, field: string, integer = false): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || (integer && !Number.isInteger(v)) || v < min || v > max) {
    fail(`${field} must be a finite ${integer ? 'integer' : 'number'} in [${min}, ${max}]`, field);
  }
  return v;
}
function parseMemoryBytes(raw: string): number {
  const m = /^(\d+)([KMGT])?$/.exec(raw);
  if (!m) fail('resources.memoryMax must match ^\\d+[KMGT]?$', 'resources.memoryMax');
  const mult: Record<string, number> = { '': 1, K: 1024, M: 1024 ** 2, G: 1024 ** 3, T: 1024 ** 4 };
  return Number(m[1]) * mult[m[2] ?? ''];
}
function validateSchedule(raw: unknown): LocalTaskScheduleV1 {
  if (!isPlainObject(raw)) fail('schedule must be an object', 'schedule');
  const { onCalendar, persistent, randomizedDelaySec, accuracySec, expectedIntervalMs, graceMultiplier } = raw;
  if (typeof onCalendar !== 'string' || hasControlChars(onCalendar)) fail('invalid schedule.onCalendar', 'schedule.onCalendar');
  const isPreset = (ON_CALENDAR_PRESETS as readonly string[]).includes(onCalendar);
  if (!isPreset && !ON_CALENDAR_CUSTOM_REGEX.test(onCalendar)) {
    fail('schedule.onCalendar must be a preset or match ON_CALENDAR_CUSTOM_REGEX', 'schedule.onCalendar');
  }
  if (typeof persistent !== 'boolean') fail('schedule.persistent must be a boolean', 'schedule.persistent');
  if (randomizedDelaySec !== undefined) checkBoundedNumber(randomizedDelaySec, 0, 3600, 'schedule.randomizedDelaySec');
  if (accuracySec !== undefined) checkBoundedNumber(accuracySec, 1, 3600, 'schedule.accuracySec');
  if (expectedIntervalMs !== undefined) checkBoundedNumber(expectedIntervalMs, 60_000, Number.MAX_SAFE_INTEGER, 'schedule.expectedIntervalMs');
  if (graceMultiplier !== undefined) checkBoundedNumber(graceMultiplier, 1.1, 5.0, 'schedule.graceMultiplier');
  return raw as unknown as LocalTaskScheduleV1;
}
function validateEnvVars(env: unknown, envAllowlist: unknown): void {
  if (env !== undefined) {
    if (!isPlainObject(env)) fail('command.env must be a plain object', 'command.env');
    for (const [k, v] of Object.entries(env)) {
      if (!ENV_NAME_REGEX.test(k)) fail(`invalid env var name: ${k}`, 'command.env');
      if (isBlockedLoaderEnvVar(k)) fail(`loader env var forbidden in command.env: ${k}`, 'command.env');
      if (isSecretEnvVarName(k)) fail(`secret-shaped env var forbidden in command.env: ${k}`, 'command.env');
      if (typeof v !== 'string' || hasControlChars(v)) fail(`invalid value for command.env.${k}`, 'command.env');
    }
  }
  if (envAllowlist !== undefined) {
    if (!Array.isArray(envAllowlist)) fail('command.envAllowlist must be an array', 'command.envAllowlist');
    for (const name of envAllowlist) {
      if (typeof name !== 'string' || !ENV_NAME_REGEX.test(name)) fail(`invalid envAllowlist entry`, 'command.envAllowlist');
      if (isBlockedLoaderEnvVar(name)) fail(`loader env var forbidden in envAllowlist: ${name}`, 'command.envAllowlist');
      if (isSecretEnvVarName(name)) fail(`secret-shaped env var forbidden in envAllowlist: ${name}`, 'command.envAllowlist');
    }
  }
}
function validateCommand(raw: unknown): LocalTaskCommandV1 {
  if (!isPlainObject(raw)) fail('command must be an object', 'command');
  const { bin, args, cwd, env, envAllowlist } = raw;
  if (typeof bin !== 'string' || !bin.startsWith('/') || hasControlChars(bin) || bin.includes('"') || bin.includes('\\')) {
    fail('command.bin must be an absolute path without control chars, quotes, or backslashes', 'command.bin');
  }
  if (!Array.isArray(args) || args.length > 64) fail('command.args must be an array of at most 64 strings', 'command.args');
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (typeof arg !== 'string' || arg.length > 1024 || hasControlChars(arg) || arg === ';' || arg.endsWith('\\')) {
      fail(`invalid command.args[${i}]`, 'command.args');
    }
  }
  if (cwd !== undefined && (typeof cwd !== 'string' || !cwd.startsWith('/') || hasControlChars(cwd))) {
    fail('command.cwd must be an absolute path without control chars', 'command.cwd');
  }
  validateEnvVars(env, envAllowlist);
  return raw as unknown as LocalTaskCommandV1;
}
function validateResources(raw: unknown): LocalTaskResourcesV1 {
  if (!isPlainObject(raw)) fail('resources must be an object', 'resources');
  if (raw.nice !== undefined) checkBoundedNumber(raw.nice, 0, 19, 'resources.nice', true);
  if (raw.ioSchedulingClass !== undefined && raw.ioSchedulingClass !== 'idle' && raw.ioSchedulingClass !== 'best-effort') {
    fail('resources.ioSchedulingClass must be idle or best-effort', 'resources.ioSchedulingClass');
  }
  if (raw.memoryMax !== undefined) {
    if (typeof raw.memoryMax !== 'string') fail('resources.memoryMax must be a string', 'resources.memoryMax');
    const bytes = parseMemoryBytes(raw.memoryMax);
    if (bytes < 64 * 1024 ** 2 || bytes > 4 * 1024 ** 3) fail('resources.memoryMax must be within 64M..4G', 'resources.memoryMax');
  }
  if (raw.cpuQuota !== undefined) {
    const m = typeof raw.cpuQuota === 'string' ? /^(\d+)%$/.exec(raw.cpuQuota) : null;
    if (!m || Number(m[1]) < 5 || Number(m[1]) > 100) fail('resources.cpuQuota must be within 5%..100%', 'resources.cpuQuota');
  }
  if (raw.tasksMax !== undefined) checkBoundedNumber(raw.tasksMax, 8, 512, 'resources.tasksMax', true);
  return raw as unknown as LocalTaskResourcesV1;
}
/** Validates an unknown value against the LocalTaskSpecV1 contract. */
export function validateTaskSpec(spec: unknown): LocalTaskSpecV1 {
  if (!isPlainObject(spec)) fail('task spec must be an object');
  if (spec.v !== LOCAL_TASK_SPEC_V1) fail(`spec.v must be ${LOCAL_TASK_SPEC_V1}`, 'v');
  if (typeof spec.taskId !== 'string' || !TASK_ID_REGEX.test(spec.taskId)) fail('invalid taskId', 'taskId');
  if (typeof spec.owner !== 'string' || !OWNER_REGEX.test(spec.owner)) fail('invalid owner', 'owner');
  if (
    typeof spec.description !== 'string' || spec.description.length === 0 || spec.description.length > 120 ||
    hasControlChars(spec.description) || spec.description.includes('%') || spec.description.includes('\\')
  ) {
    fail('description must be 1..120 chars without control chars, %, or \\', 'description');
  }
  validateSchedule(spec.schedule);
  validateCommand(spec.command);
  checkBoundedNumber(spec.timeoutMs, 5_000, 7_200_000, 'timeoutMs');
  if (spec.killGraceMs !== undefined) checkBoundedNumber(spec.killGraceMs, 1_000, 60_000, 'killGraceMs');
  if (spec.killSwitchEnv !== undefined) {
    if (
      typeof spec.killSwitchEnv !== 'string' || !ENV_NAME_REGEX.test(spec.killSwitchEnv) ||
      isBlockedLoaderEnvVar(spec.killSwitchEnv) || isSecretEnvVarName(spec.killSwitchEnv)
    ) {
      fail('invalid killSwitchEnv', 'killSwitchEnv');
    }
  }
  if (spec.resources !== undefined) validateResources(spec.resources);
  return spec as unknown as LocalTaskSpecV1;
}
