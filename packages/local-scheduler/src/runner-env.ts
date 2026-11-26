import { lstatSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isBlockedLoaderEnvVar, isSecretEnvVarName, validateTaskSpec } from './contract.js';
import type { LocalTaskManifestV1, LocalTaskSpecV1 } from './contract-types.js';
import { canonicalTaskKillSwitchVar } from './env-file.js';
import { InvalidTaskSpecError, LocalSchedulerError, ManifestCorruptError, PolicyRefusalError, TaskNotFoundError } from './errors.js';
import { isValidTaskManifest, resolveStateDir, verifyOwnedPrivatePath } from './state-dir.js';
import type { LocalTaskTriggerV1 } from './witness.js';

const BASE_ENV_KEYS = ['HOME', 'USER', 'LANG', 'LC_ALL'] as const;
const TASK_ID_REGEX = /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/;

export function deriveTrigger(env: NodeJS.ProcessEnv): LocalTaskTriggerV1 {
  const unit = env.TRIGGER_UNIT;
  return typeof unit === 'string' && unit.endsWith('.timer') ? 'systemd-timer' : 'manual';
}

/** Constructs the child environment with constant PATH=/usr/bin:/bin and stripped secrets/loaders. */
export function buildSanitizedChildEnv(
  runnerEnv: NodeJS.ProcessEnv,
  spec: LocalTaskSpecV1,
): NodeJS.ProcessEnv {
  const childEnv: NodeJS.ProcessEnv = { PATH: '/usr/bin:/bin' };
  const copySafe = (key: string, val: string | undefined): void => {
    if (val === undefined || key === 'PATH' || isBlockedLoaderEnvVar(key) || isSecretEnvVarName(key)) return;
    childEnv[key] = val;
  };
  for (const key of BASE_ENV_KEYS) copySafe(key, runnerEnv[key]);
  for (const [key, val] of Object.entries(runnerEnv)) {
    if (key.startsWith('XDG_')) copySafe(key, val);
  }
  if (spec.command.env) {
    for (const [key, val] of Object.entries(spec.command.env)) copySafe(key, val);
  }
  if (spec.command.envAllowlist) {
    for (const key of spec.command.envAllowlist) copySafe(key, runnerEnv[key]);
  }
  copySafe('SENTROPIC_LOCAL_SCHEDULER_OFF', runnerEnv.SENTROPIC_LOCAL_SCHEDULER_OFF);
  const taskKs = canonicalTaskKillSwitchVar(spec.taskId);
  copySafe(taskKs, runnerEnv[taskKs]);
  if (spec.killSwitchEnv) copySafe(spec.killSwitchEnv, runnerEnv[spec.killSwitchEnv]);
  if (!childEnv.HOME) childEnv.HOME = os.homedir();
  return childEnv;
}

export function loadAndVerifyManifestById(
  taskId: string,
  resolvedStateDir: string,
): LocalTaskManifestV1 {
  if (!TASK_ID_REGEX.test(taskId)) {
    throw new InvalidTaskSpecError('INVALID_TASK_SPEC', `Invalid taskId: ${taskId}`, 'taskId');
  }
  let dirExists = false;
  try {
    lstatSync(resolvedStateDir);
    dirExists = true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new TaskNotFoundError(taskId, `Task ${taskId} not found (stateDir missing)`);
    }
    throw new PolicyRefusalError('POLICY_REFUSED_FILE_MODE', 'file-mode', `Unreadable stateDir: ${resolvedStateDir}`, { cause: err });
  }
  if (dirExists) verifyOwnedPrivatePath(resolvedStateDir, 'dir');

  const tasksDir = path.join(resolvedStateDir, 'tasks');
  const taskDir = path.join(tasksDir, taskId);
  for (const d of [tasksDir, taskDir]) {
    try {
      lstatSync(d);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new TaskNotFoundError(taskId, `Task ${taskId} not found`);
      }
      throw new PolicyRefusalError('POLICY_REFUSED_FILE_MODE', 'file-mode', `Unreadable task path: ${d}`, { cause: err });
    }
    verifyOwnedPrivatePath(d, 'dir');
  }

  const manifestPath = path.join(taskDir, 'manifest.json');
  try {
    lstatSync(manifestPath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new TaskNotFoundError(taskId, `Task manifest missing: ${manifestPath}`);
    }
    throw new PolicyRefusalError('POLICY_REFUSED_FILE_MODE', 'file-mode', `Unreadable manifest: ${manifestPath}`, { cause: err });
  }
  verifyOwnedPrivatePath(manifestPath, 'file');

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch (err) {
    throw new ManifestCorruptError(manifestPath, `Manifest JSON parse failed: ${manifestPath}`, { cause: err });
  }
  if (!isValidTaskManifest(parsed, taskId)) {
    throw new ManifestCorruptError(manifestPath, `Manifest schema invalid: ${manifestPath}`);
  }
  if (parsed.stateDir !== resolvedStateDir) {
    throw new PolicyRefusalError(
      'POLICY_REFUSED_STATE_DIR',
      'state-dir',
      `Manifest stateDir (${parsed.stateDir}) mismatches resolved stateDir (${resolvedStateDir})`,
    );
  }
  return parsed;
}

export function verifyDirectManifestAndStateDir(
  manifest: LocalTaskManifestV1,
  optStateDir: string | undefined,
  env: NodeJS.ProcessEnv,
): { readonly resolvedStateDir: string; readonly verifiedManifest: LocalTaskManifestV1 } {
  const resolvedStateDir = optStateDir ?? resolveStateDir(env);
  if (!isValidTaskManifest(manifest)) {
    const rawTaskId = (manifest as { spec?: { taskId?: unknown } } | null | undefined)?.spec?.taskId;
    const manifestPath = typeof rawTaskId === 'string' && TASK_ID_REGEX.test(rawTaskId)
      ? path.join(resolvedStateDir, 'tasks', rawTaskId, 'manifest.json')
      : path.join(resolvedStateDir, 'manifest.json');
    throw new ManifestCorruptError(manifestPath, 'Provided manifest failed schema validation');
  }
  validateTaskSpec(manifest.spec);
  if (manifest.stateDir !== resolvedStateDir) {
    throw new PolicyRefusalError(
      'POLICY_REFUSED_STATE_DIR',
      'state-dir',
      `Manifest stateDir (${manifest.stateDir}) mismatches resolved stateDir (${resolvedStateDir})`,
    );
  }
  try {
    lstatSync(resolvedStateDir);
    verifyOwnedPrivatePath(resolvedStateDir, 'dir');
  } catch (err) {
    if (err instanceof LocalSchedulerError) throw err;
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw new PolicyRefusalError('POLICY_REFUSED_FILE_MODE', 'file-mode', `Unsafe stateDir: ${resolvedStateDir}`, { cause: err });
    }
  }
  const taskDir = path.join(resolvedStateDir, 'tasks', manifest.spec.taskId);
  try {
    lstatSync(taskDir);
    verifyOwnedPrivatePath(taskDir, 'dir');
  } catch (err) {
    if (err instanceof LocalSchedulerError) throw err;
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw new PolicyRefusalError('POLICY_REFUSED_FILE_MODE', 'file-mode', `Unsafe task directory: ${taskDir}`, { cause: err });
    }
  }
  return { resolvedStateDir, verifiedManifest: manifest };
}
