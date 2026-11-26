import { createHash } from 'node:crypto';
import { isNodeInterpreter } from '../allowlist.js';
import { hasControlChars } from '../contract.js';
import {
  BLOCKED_LOADER_ENV_VARS,
  ON_CALENDAR_CUSTOM_REGEX,
  ON_CALENDAR_PRESETS,
  type LocalTaskManifestV1,
} from '../contract-types.js';
import { InvalidTaskSpecError } from '../errors.js';

const GLOB_CHARS = /[*?\[]/;

function rejectInvalidUnitText(value: string, label: string): void {
  if (hasControlChars(value) || value.endsWith('\\')) {
    throw new InvalidTaskSpecError('INVALID_TASK_SPEC', `${label} contains control chars or trailing backslash`, label);
  }
}
function sanitizeUnitPath(raw: string, label: string): string {
  rejectInvalidUnitText(raw, label);
  if (!raw.startsWith('/') || raw.includes('"') || raw.includes('\\')) {
    throw new InvalidTaskSpecError('INVALID_TASK_SPEC', `${label} must be an absolute path without quotes or backslashes`, label);
  }
  return raw.replace(/%/g, '%%');
}
function escapeEnvFilePath(raw: string): string {
  if (GLOB_CHARS.test(raw)) {
    throw new InvalidTaskSpecError('INVALID_TASK_SPEC', 'envFilePath must not contain glob metacharacters (*, ?, [)', 'envFilePath');
  }
  return sanitizeUnitPath(raw, 'envFilePath');
}
function escapeExecPathToken(raw: string, label: string): string {
  const escapedPath = sanitizeUnitPath(raw, label);
  return `"${escapedPath.replace(/\$/g, '$$$$')}"`;
}
function escapeExecArgToken(raw: string, label: string): string {
  rejectInvalidUnitText(raw, label);
  if (raw === ';') {
    throw new InvalidTaskSpecError('INVALID_TASK_SPEC', `${label} must not be a lone ";" token`, label);
  }
  const escaped = raw
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/%/g, '%%')
    .replace(/\$/g, '$$$$');
  return `"${escaped}"`;
}
function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** Pure, injection-safe systemd .service and .timer generator (§3.1, §6.6). */
export function renderSystemdUnits(manifest: Omit<LocalTaskManifestV1, 'units'>): {
  readonly service: string;
  readonly timer: string;
  readonly serviceSha256: string;
  readonly timerSha256: string;
} {
  const { spec, runner } = manifest;
  rejectInvalidUnitText(spec.description, 'description');
  if (spec.description.includes('%') || spec.description.includes('\\')) {
    throw new InvalidTaskSpecError('INVALID_TASK_SPEC', 'description must not contain % or \\', 'description');
  }
  const onCalendar = spec.schedule.onCalendar;
  const validCal = (ON_CALENDAR_PRESETS as readonly string[]).includes(onCalendar) || ON_CALENDAR_CUSTOM_REGEX.test(onCalendar);
  if (!validCal || hasControlChars(onCalendar) || onCalendar.endsWith('\\')) {
    throw new InvalidTaskSpecError('INVALID_TASK_SPEC', 'invalid schedule.onCalendar', 'schedule.onCalendar');
  }
  const stateDirEscaped = sanitizeUnitPath(manifest.stateDir, 'stateDir');
  const envFileEscaped = escapeEnvFilePath(manifest.envFilePath);
  const execTokens: string[] = [escapeExecPathToken(runner.bin, 'runner.bin')];
  const nodeRunner = isNodeInterpreter(runner.bin);
  runner.args.forEach((arg, idx) => {
    execTokens.push(
      nodeRunner && idx === 0
        ? escapeExecPathToken(arg, 'runner.args[0]')
        : escapeExecArgToken(arg, `runner.args[${idx}]`),
    );
  });
  execTokens.push(escapeExecArgToken(spec.taskId, 'taskId'));

  const nice = spec.resources?.nice ?? 15;
  const ioClass = spec.resources?.ioSchedulingClass ?? 'idle';
  const memoryMax = spec.resources?.memoryMax ?? '512M';
  const cpuQuota = spec.resources?.cpuQuota ?? '50%';
  const tasksMax = spec.resources?.tasksMax ?? 64;
  const killGraceMs = spec.killGraceMs ?? 15_000;
  const timeoutStartSec = Math.ceil((spec.timeoutMs + killGraceMs) / 1000) + 30;
  const timeoutStopSec = Math.ceil(killGraceMs / 1000) + 15;
  const randomizedDelaySec = spec.schedule.randomizedDelaySec ?? 300;
  const accuracySec = spec.schedule.accuracySec ?? 60;

  const service = [
    '# Managed-By: @sentropic/local-scheduler v1',
    `# Task-Id: ${spec.taskId}`,
    `# Owner: ${spec.owner}`,
    '[Unit]',
    `Description=Sentropic local scheduled task: ${spec.description} (${spec.taskId})`,
    'After=default.target',
    '',
    '[Service]',
    'Type=oneshot',
    'KillMode=mixed',
    'SuccessExitStatus=130 143',
    `Nice=${nice}`,
    `IOSchedulingClass=${ioClass}`,
    `MemoryMax=${memoryMax}`,
    `CPUQuota=${cpuQuota}`,
    `TasksMax=${tasksMax}`,
    'UMask=0077',
    'NoNewPrivileges=yes',
    'RestrictAddressFamilies=AF_UNIX',
    'LockPersonality=yes',
    'RestrictRealtime=yes',
    `TimeoutStartSec=${timeoutStartSec}`,
    `TimeoutStopSec=${timeoutStopSec}`,
    'Environment="PATH=/usr/bin:/bin"',
    `Environment="SENTROPIC_LOCAL_SCHEDULER_STATE_DIR=${stateDirEscaped}"`,
    `EnvironmentFile=-${envFileEscaped}`,
    `UnsetEnvironment=${BLOCKED_LOADER_ENV_VARS.join(' ')}`,
    `ExecStart=${execTokens.join(' ')}`,
    'StandardOutput=journal',
    'StandardError=journal',
    '',
  ].join('\n');

  const timer = [
    '# Managed-By: @sentropic/local-scheduler v1',
    `# Task-Id: ${spec.taskId}`,
    `# Owner: ${spec.owner}`,
    '[Unit]',
    `Description=Timer for Sentropic local scheduled task: ${spec.taskId}`,
    '',
    '[Timer]',
    `OnCalendar=${onCalendar}`,
    `Persistent=${spec.schedule.persistent ? 'true' : 'false'}`,
    `RandomizedDelaySec=${randomizedDelaySec}`,
    `AccuracySec=${accuracySec}`,
    `Unit=sentropic-task-${spec.taskId}.service`,
    '',
    '[Install]',
    'WantedBy=timers.target',
    '',
  ].join('\n');

  return { service, timer, serviceSha256: sha256Hex(service), timerSha256: sha256Hex(timer) };
}
