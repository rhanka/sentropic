import {
  accessSync, closeSync, constants, fsyncSync, lstatSync, mkdirSync,
  openSync, readFileSync, renameSync, unlinkSync, writeFileSync, type Stats,
} from 'node:fs';
import { randomBytes } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { isPlainObject, validateTaskSpec } from './contract.js';
import type { LocalTaskManifestV1 } from './contract-types.js';
import { PolicyRefusalError } from './errors.js';
import { assertHostPidNamespace, assertHostPidNamespaceWith, type HostPidNamespaceProbes } from './host-pid-guard.js';

export interface StateDirObservabilityResult {
  readonly observable: boolean;
  readonly reason?: 'absent-outside-host-namespace' | 'inaccessible' | 'not-a-directory';
}
const UTC_ISO_Z_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const SHA256_HEX_REGEX = /^[0-9a-f]{64}$/;

export function isValidUtcIsoZ(value: unknown): value is string {
  return typeof value === 'string' && UTC_ISO_Z_REGEX.test(value) && Number.isFinite(Date.parse(value));
}
export function resolveStateDir(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.SENTROPIC_LOCAL_SCHEDULER_STATE_DIR;
  if (override && override.length > 0) return override;
  const xdgState = env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state');
  return path.join(xdgState, 'sentropic', 'local-scheduler');
}
export function resolveSchedulerEnvFilePath(env: NodeJS.ProcessEnv = process.env): string {
  const xdgConfig = env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(xdgConfig, 'sentropic', 'local-scheduler', 'env');
}
export function probeStateDirObservabilityWith(
  stateDir: string,
  hostPidProbes?: HostPidNamespaceProbes,
): StateDirObservabilityResult {
  try {
    const st = lstatSync(stateDir);
    if (st.isSymbolicLink() || !st.isDirectory()) return { observable: false, reason: 'not-a-directory' };
    accessSync(stateDir, constants.R_OK);
    return { observable: true };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      try {
        if (hostPidProbes) assertHostPidNamespaceWith(hostPidProbes);
        else assertHostPidNamespace();
        return { observable: true };
      } catch {
        return { observable: false, reason: 'absent-outside-host-namespace' };
      }
    }
    if (code === 'ENOTDIR') return { observable: false, reason: 'not-a-directory' };
    return { observable: false, reason: 'inaccessible' };
  }
}
export function probeStateDirObservability(stateDir: string): StateDirObservabilityResult {
  return probeStateDirObservabilityWith(stateDir);
}
export function verifyOwnedPrivatePath(targetPath: string, kind: 'dir' | 'file'): Stats {
  let st: Stats;
  try {
    st = lstatSync(targetPath);
  } catch (err) {
    throw new PolicyRefusalError('POLICY_REFUSED_FILE_MODE', 'file-mode', `Unreadable ${kind}: ${targetPath}`, { cause: err });
  }
  if (st.isSymbolicLink()) {
    throw new PolicyRefusalError('POLICY_REFUSED_FILE_MODE', 'file-mode', `Symlink refused at ${targetPath}`);
  }
  if (kind === 'dir' ? !st.isDirectory() : !st.isFile()) {
    throw new PolicyRefusalError('POLICY_REFUSED_FILE_MODE', 'file-mode', `Expected ${kind} at ${targetPath}`);
  }
  const uid = process.getuid ? process.getuid() : 0;
  if (st.uid !== uid) {
    throw new PolicyRefusalError('POLICY_REFUSED_FILE_MODE', 'file-mode', `Unsafe owner uid=${st.uid} on ${targetPath}`);
  }
  if ((st.mode & 0o077) !== 0) {
    throw new PolicyRefusalError('POLICY_REFUSED_FILE_MODE', 'file-mode', `Unsafe mode ${(st.mode & 0o777).toString(8)} on ${targetPath}`);
  }
  return st;
}
export function ensurePrivateDir(dirPath: string): void {
  mkdirSync(dirPath, { recursive: true, mode: 0o700 });
  verifyOwnedPrivatePath(dirPath, 'dir');
}
export function fsyncDirBestEffort(dirPath: string): void {
  try {
    const fd = openSync(dirPath, 'r');
    try { fsyncSync(fd); } finally { closeSync(fd); }
  } catch { /* some virtual filesystems disallow dir fsync */ }
}
export function writeFileAtomicPrivate(filePath: string, content: string | Buffer): void {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  const tmpPath = path.join(dir, `.${base}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`);
  const fd = openSync(tmpPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
  try {
    writeFileSync(fd, content);
    fsyncSync(fd);
  } catch (err) {
    closeSync(fd);
    try { unlinkSync(tmpPath); } catch { /* ignore cleanup failure */ }
    throw err;
  }
  closeSync(fd);
  renameSync(tmpPath, filePath);
  fsyncDirBestEffort(dir);
}
export function isValidTaskManifest(raw: unknown, expectedTaskId?: string): raw is LocalTaskManifestV1 {
  if (!isPlainObject(raw) || raw.v !== 1 || typeof raw.enabled !== 'boolean') return false;
  try {
    const spec = validateTaskSpec(raw.spec);
    if (expectedTaskId !== undefined && spec.taskId !== expectedTaskId) return false;
  } catch {
    return false;
  }
  if (!isPlainObject(raw.runner) || typeof raw.runner.bin !== 'string' || !Array.isArray(raw.runner.args)) return false;
  if (!raw.runner.args.every((a) => typeof a === 'string')) return false;
  if (!isValidUtcIsoZ(raw.installedAt) || !isValidUtcIsoZ(raw.enabledAt)) return false;
  if (typeof raw.stateDir !== 'string' || !raw.stateDir.startsWith('/')) return false;
  if (typeof raw.envFilePath !== 'string' || !raw.envFilePath.startsWith('/')) return false;
  if (typeof raw.expectedIntervalMs !== 'number' || !Number.isFinite(raw.expectedIntervalMs) || raw.expectedIntervalMs < 60_000) return false;
  if (!isPlainObject(raw.units)) return false;
  return SHA256_HEX_REGEX.test(String(raw.units.serviceSha256)) && SHA256_HEX_REGEX.test(String(raw.units.timerSha256));
}
export function readTaskManifest(stateDir: string, taskId: string): LocalTaskManifestV1 | null | 'corrupt' {
  const manifestPath = path.join(stateDir, 'tasks', taskId, 'manifest.json');
  let rawText: string;
  try {
    rawText = readFileSync(manifestPath, 'utf8');
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'ENOENT' ? null : 'corrupt';
  }
  try {
    const parsed: unknown = JSON.parse(rawText);
    return isValidTaskManifest(parsed, taskId) ? parsed : 'corrupt';
  } catch {
    return 'corrupt';
  }
}
