import { execFile } from 'node:child_process';
import os from 'node:os';
import { SchedulerUnavailableError, SystemctlFailedError } from '../errors.js';

export type ExecFileFn = (
  file: string,
  args: readonly string[],
  options: { readonly timeout: number; readonly env?: NodeJS.ProcessEnv },
) => Promise<{ readonly stdout: string; readonly stderr: string }>;

export const defaultExecFile: ExecFileFn = (file, args, options) =>
  new Promise((resolve, reject) => {
    execFile(file, [...args], { timeout: options.timeout, env: options.env, encoding: 'utf8' }, (err, stdout, stderr) => {
      if (err) {
        reject(Object.assign(err, { stdout: String(stdout ?? ''), stderr: String(stderr ?? '') }));
      } else {
        resolve({ stdout: String(stdout ?? ''), stderr: String(stderr ?? '') });
      }
    });
  });

export type SystemdAvailability =
  | { readonly available: true; readonly systemdVersion: string }
  | { readonly available: false; readonly reason: 'not-linux' | 'no-systemctl' | 'no-user-manager' | 'timeout'; readonly detail: string };

export async function probeSystemdUserAvailabilityWith(
  platform: NodeJS.Platform,
  execFn: ExecFileFn = defaultExecFile,
): Promise<SystemdAvailability> {
  if (platform !== 'linux') {
    return { available: false, reason: 'not-linux', detail: `unsupported platform: ${platform}` };
  }
  try {
    const { stdout } = await execFn('systemctl', ['--user', 'show', '--property=Version', '--value'], { timeout: 5_000 });
    const version = stdout.trim();
    if (!version) return { available: false, reason: 'no-user-manager', detail: 'empty systemd version' };
    return { available: true, systemdVersion: version };
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { killed?: boolean; signal?: string; stderr?: string };
    if (e.code === 'ENOENT') return { available: false, reason: 'no-systemctl', detail: 'systemctl binary not found' };
    if (e.killed || e.code === 'ETIMEDOUT' || e.signal === 'SIGTERM') {
      return { available: false, reason: 'timeout', detail: 'systemctl --user timed out' };
    }
    return { available: false, reason: 'no-user-manager', detail: (e.stderr || e.message || 'user manager unavailable').trim() };
  }
}

/** Probes whether systemd --user is reachable on Linux without calling show-environment (§3.3, §4.2). */
export function probeSystemdUserAvailability(): Promise<SystemdAvailability> {
  return probeSystemdUserAvailabilityWith(process.platform, defaultExecFile);
}

export function formatUnavailableMessage(
  reason: 'not-linux' | 'no-systemctl' | 'no-user-manager' | 'timeout',
  detail: string,
): string {
  const base = `systemd --user unavailable (${reason}: ${detail}); no fallback scheduler is used.`;
  switch (reason) {
    case 'not-linux':
      return `${base} Run on a Linux host with an active systemd --user session.`;
    case 'no-systemctl':
      return `${base} Install systemd (systemctl) and run from a Linux host user session.`;
    case 'timeout':
      return `${base} Check that the systemd --user D-Bus session is responsive (systemctl --user status) and retry.`;
    case 'no-user-manager':
      return `${base} Run from an unsandboxed host login session with XDG_RUNTIME_DIR and DBUS_SESSION_BUS_ADDRESS set.`;
  }
}

export async function requireSystemdUserAvailable(execFn: ExecFileFn = defaultExecFile): Promise<string> {
  const res = await probeSystemdUserAvailabilityWith(process.platform, execFn);
  if (!res.available) throw new SchedulerUnavailableError(res.reason, formatUnavailableMessage(res.reason, res.detail));
  return res.systemdVersion;
}

export interface LingerProbeDeps {
  readonly userInfo?: () => { readonly username: string };
  readonly env?: NodeJS.ProcessEnv;
  readonly getuid?: () => number;
}

export async function probeLingerEnabledWith(
  execFn: ExecFileFn = defaultExecFile,
  user?: string,
  deps?: LingerProbeDeps,
): Promise<boolean | null> {
  let targetUser = user;
  const readUserInfo = deps?.userInfo ?? os.userInfo;
  const env = deps?.env ?? process.env;
  const getuid = deps?.getuid ?? process.getuid;
  if (!targetUser) {
    try { targetUser = readUserInfo().username; } catch { targetUser = undefined; }
  }
  if (!targetUser) targetUser = env.USER || env.LOGNAME || (getuid ? String(getuid()) : undefined);
  if (!targetUser) return null;
  try {
    const { stdout } = await execFn('loginctl', ['show-user', '--property=Linger', '--value', '--', targetUser], { timeout: 5_000 });
    const val = stdout.trim().toLowerCase();
    return val === 'yes' ? true : val === 'no' ? false : null;
  } catch {
    return null;
  }
}

export async function runSystemctl(
  args: readonly string[],
  execFn: ExecFileFn = defaultExecFile,
  env?: NodeJS.ProcessEnv,
): Promise<string> {
  try {
    const { stdout } = await execFn('systemctl', ['--user', ...args], { timeout: 10_000, ...(env ? { env } : {}) });
    return stdout;
  } catch (err) {
    const e = err as Error & { stderr?: string };
    const stderr = String(e.stderr ?? e.message).trim();
    throw new SystemctlFailedError(['systemctl', '--user', ...args], stderr, false, `systemctl --user ${args[0]} failed: ${stderr}`, { cause: err });
  }
}

export function parseShowProperties(stdout: string): Record<string, string> {
  const props: Record<string, string> = {};
  for (const line of stdout.split(/\r?\n/)) {
    const idx = line.indexOf('=');
    if (idx > 0) props[line.slice(0, idx)] = line.slice(idx + 1);
  }
  return props;
}

export function normalizeShowProp(val: string | undefined): string | null {
  if (!val) return null;
  const trimmed = val.trim();
  return !trimmed || trimmed === 'n/a' || trimmed === '[not set]' ? null : trimmed;
}

export function parseSystemdTimestampMs(raw: string | null): number | null {
  if (!raw) return null;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : null;
}
