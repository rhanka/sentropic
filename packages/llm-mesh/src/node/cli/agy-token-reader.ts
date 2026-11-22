// @sentropic/llm-mesh/node/cli/agy-token-reader.ts
//
// Thin `--from-agy` reader spawning the fixed `/usr/bin/secret-tool` binary
// with fixed arguments, no shell, allowlisted child env, bounded piped stdout,
// discarded stderr, and a hard wall-clock timeout.

import { spawn, type ChildProcess } from 'node:child_process';
import type { ProcessReadStream } from 'node:process';
import {
  AgyTokenReadError,
  MAX_CREDENTIAL_BYTES,
  parseCloudCodeCredentialPayload,
  readCredentialFromStdin,
  type CloudCodeOAuthCredential,
} from './credential-schema.js';

export {
  AgyTokenReadError,
  MAX_CREDENTIAL_BYTES,
  parseCloudCodeCredentialPayload,
  readCredentialFromStdin,
  type CloudCodeOAuthCredential,
};

export const SECRET_TOOL_PATH = '/usr/bin/secret-tool';
export const SECRET_TOOL_ARGS = ['lookup', 'service', 'gemini', 'username', 'antigravity'] as const;
export const SECRET_TOOL_TIMEOUT_MS = 5_000;

const CHILD_ENV_ALLOWLIST = ['DBUS_SESSION_BUS_ADDRESS', 'XDG_RUNTIME_DIR', 'HOME', 'LANG', 'LC_ALL', 'TZ'] as const;
const ABSENT_SECRET_TOOL_MSG =
  `secret-tool binary not found at ${SECRET_TOOL_PATH}; install libsecret-tools or pass --credential-stdin`;

const killChild = (child: ChildProcess, closed: boolean): void => {
  if (closed) return;
  if (child.pid !== undefined && process.platform !== 'win32') {
    try { process.kill(-child.pid, 'SIGKILL'); } catch { /* fall through */ }
  }
  try { if (child.exitCode === null) child.kill('SIGKILL'); } catch { /* gone */ }
  try { child.stdout?.destroy(); } catch { /* gone */ }
  try { child.stderr?.destroy(); } catch { /* gone */ }
};

export const readAgyFromSecretTool = (options: {
  binaryPath?: string;
  env?: Record<string, string | undefined>;
  timeoutMs?: number;
} = {}): Promise<string> => new Promise((resolve, reject) => {
  const binaryPath = options.binaryPath ?? SECRET_TOOL_PATH;
  if (!options.binaryPath && process.platform !== 'linux') {
    reject(new AgyTokenReadError('--from-agy requires Linux secret-tool; use --credential-stdin on this platform'));
    return;
  }
  const sourceEnv = options.env ?? process.env;
  const childEnv: Record<string, string | undefined> = {};
  for (const key of CHILD_ENV_ALLOWLIST) {
    if (sourceEnv[key] !== undefined) childEnv[key] = sourceEnv[key];
  }
  let child: ChildProcess;
  try {
    child = spawn(binaryPath, SECRET_TOOL_ARGS, {
      env: childEnv, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32',
    });
  } catch {
    reject(new AgyTokenReadError(ABSENT_SECRET_TOOL_MSG));
    return;
  }
  let settled = false;
  let closed = false;
  let received = 0;
  const chunks: Buffer[] = [];
  const finish = (err?: Error, value?: string): void => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    if (err) reject(err);
    else resolve(value ?? '');
  };
  const timer = setTimeout(() => {
    killChild(child, closed);
    finish(new AgyTokenReadError('secret-tool lookup timed out'));
  }, options.timeoutMs ?? SECRET_TOOL_TIMEOUT_MS);
  (timer as unknown as { unref?: () => void }).unref?.();
  child.stdout?.on('data', (chunk: Buffer) => {
    received += chunk.length;
    if (received > MAX_CREDENTIAL_BYTES) {
      killChild(child, closed);
      finish(new AgyTokenReadError('secret-tool output exceeds maximum allowed size'));
      return;
    }
    chunks.push(chunk);
  });
  child.stderr?.on('data', () => { /* drained and discarded; never leaked */ });
  child.once('error', (error: unknown) => {
    const code = (error as { code?: unknown } | null)?.code;
    finish(new AgyTokenReadError(code === 'ENOENT' ? ABSENT_SECRET_TOOL_MSG : 'failed to execute secret-tool'));
  });
  child.once('close', (code: number | null) => {
    closed = true;
    if (code !== 0) {
      finish(new AgyTokenReadError('secret-tool lookup failed; unlock the OS keyring or pass --credential-stdin'));
      return;
    }
    const raw = Buffer.concat(chunks).toString('utf8');
    if (!raw.trim()) {
      finish(new AgyTokenReadError('agy OAuth credential not found in OS keyring'));
      return;
    }
    finish(undefined, raw);
  });
});

export const readCloudCodeCredential = async (options: {
  source: 'from-agy' | 'credential-stdin';
  env?: Record<string, string | undefined>;
  stdin?: ProcessReadStream;
  secretToolPath?: string;
  secretToolTimeoutMs?: number;
  readRaw?: () => Promise<string>;
}): Promise<CloudCodeOAuthCredential> => {
  const raw = options.readRaw
    ? await options.readRaw()
    : options.source === 'credential-stdin'
      ? await readCredentialFromStdin(options.stdin)
      : await readAgyFromSecretTool({
          ...(options.secretToolPath ? { binaryPath: options.secretToolPath } : {}),
          ...(options.env ? { env: options.env } : {}),
          ...(options.secretToolTimeoutMs ? { timeoutMs: options.secretToolTimeoutMs } : {}),
        });
  return parseCloudCodeCredentialPayload(raw);
};
