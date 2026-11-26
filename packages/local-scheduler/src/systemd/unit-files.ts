import { lstatSync, mkdirSync, readFileSync, rmSync, unlinkSync, type Stats } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { LocalTaskManifestV1 } from '../contract-types.js';
import { PolicyRefusalError, UnmanagedUnitError } from '../errors.js';
import { writeFileAtomicPrivate } from '../state-dir.js';
import { runSystemctl, type ExecFileFn } from './systemctl.js';
import { renderSystemdUnits } from './unit-generator.js';

export interface UnitPaths {
  readonly serviceName: string;
  readonly timerName: string;
  readonly servicePath: string;
  readonly timerPath: string;
}

export function defaultUnitDir(env: NodeJS.ProcessEnv = process.env): string {
  const xdgConfig = env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(xdgConfig, 'systemd', 'user');
}

export function unitPaths(unitDir: string, taskId: string): UnitPaths {
  const serviceName = `sentropic-task-${taskId}.service`;
  const timerName = `sentropic-task-${taskId}.timer`;
  return {
    serviceName,
    timerName,
    servicePath: path.join(unitDir, serviceName),
    timerPath: path.join(unitDir, timerName),
  };
}

/**
 * Ensures unitDir is safe (§3.1, §6.3): creates with 0700 ONLY if absent,
 * never chmods an existing directory, and refuses symlink/foreign-uid/writable dirs.
 */
export function ensureSafeUnitDir(unitDir: string): void {
  let st: Stats | null = null;
  try {
    st = lstatSync(unitDir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw new PolicyRefusalError('POLICY_REFUSED_FILE_MODE', 'file-mode', `Unreadable unitDir: ${unitDir}`, { cause: err });
    }
  }
  if (!st) {
    mkdirSync(unitDir, { recursive: true, mode: 0o700 });
    st = lstatSync(unitDir);
  }
  if (st.isSymbolicLink() || !st.isDirectory()) {
    throw new PolicyRefusalError('POLICY_REFUSED_FILE_MODE', 'file-mode', `unitDir must be a real directory: ${unitDir}`);
  }
  const uid = process.getuid ? process.getuid() : 0;
  if (st.uid !== uid) {
    throw new PolicyRefusalError('POLICY_REFUSED_FILE_MODE', 'file-mode', `Unsafe owner uid=${st.uid} on unitDir ${unitDir}`);
  }
  if ((st.mode & 0o022) !== 0) {
    throw new PolicyRefusalError('POLICY_REFUSED_FILE_MODE', 'file-mode', `Unsafe writable mode ${(st.mode & 0o777).toString(8)} on unitDir ${unitDir}`);
  }
}

/** Verifies an existing unit file carries @sentropic/local-scheduler ownership headers (§3.1). */
export function assertManagedUnitIfPresent(unitPath: string, taskId: string): boolean {
  let st: Stats;
  try {
    st = lstatSync(unitPath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw new UnmanagedUnitError(unitPath, `Cannot inspect existing unit file: ${unitPath}`, { cause: err });
  }
  if (st.isSymbolicLink() || !st.isFile()) {
    throw new UnmanagedUnitError(unitPath, `Refusing non-regular or symlinked unit file: ${unitPath}`);
  }
  let text: string;
  try {
    text = readFileSync(unitPath, 'utf8');
  } catch (err) {
    throw new UnmanagedUnitError(unitPath, `Cannot read existing unit file: ${unitPath}`, { cause: err });
  }
  const lines = text.split(/\r?\n/).slice(0, 10);
  const hasManager = lines.some((l) => l.trim() === '# Managed-By: @sentropic/local-scheduler v1');
  const hasTaskId = lines.some((l) => l.trim() === `# Task-Id: ${taskId}`);
  if (!hasManager || !hasTaskId) {
    throw new UnmanagedUnitError(unitPath, `Refusing unmanaged unit without @sentropic/local-scheduler headers: ${unitPath}`);
  }
  return true;
}

/** Rolls back written unit files on SYSTEMCTL_FAILED during enable() (m-29). */
export async function rollbackEnableUnits(
  prev: LocalTaskManifestV1 | null,
  paths: UnitPaths,
  runtime: boolean | undefined,
  execFn: ExecFileFn,
): Promise<boolean> {
  try {
    if (prev) {
      const prevUnits = renderSystemdUnits(prev);
      if (prevUnits.serviceSha256 !== prev.units.serviceSha256 || prevUnits.timerSha256 !== prev.units.timerSha256) return false;
      writeFileAtomicPrivate(paths.servicePath, prevUnits.service);
      writeFileAtomicPrivate(paths.timerPath, prevUnits.timer);
      await runSystemctl(['daemon-reload'], execFn).catch(() => {});
      return true;
    }
    await runSystemctl([...(runtime ? ['disable', '--runtime'] : ['disable']), '--', paths.timerName], execFn).catch(() => {});
    for (const p of [paths.timerPath, paths.servicePath]) {
      try { unlinkSync(p); } catch (uErr) { if ((uErr as NodeJS.ErrnoException).code !== 'ENOENT') throw uErr; }
    }
    await runSystemctl(['daemon-reload'], execFn).catch(() => {});
    return true;
  } catch {
    return false;
  }
}

/** Unlinks managed unit files and removes manifest or purges state directory (§3.2). */
export function removeUnitsAndTaskState(
  paths: UnitPaths,
  targetDir: string,
  taskId: string,
  purgeState: boolean | undefined,
): string[] {
  const removedUnits: string[] = [];
  for (const p of [paths.timerPath, paths.servicePath]) {
    try { unlinkSync(p); removedUnits.push(p); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
  }
  const taskDir = path.join(targetDir, 'tasks', taskId);
  if (purgeState) {
    rmSync(taskDir, { recursive: true, force: true });
    try { unlinkSync(path.join(targetDir, 'locks', `${taskId}.lock`)); } catch { /* absent */ }
  } else {
    try { unlinkSync(path.join(taskDir, 'manifest.json')); } catch { /* absent */ }
  }
  return removedUnits;
}
