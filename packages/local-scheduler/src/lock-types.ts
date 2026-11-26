import { isPlainObject } from './contract.js';
import { isValidUtcIsoZ } from './state-dir.js';

export type LockPhase = 'acquired' | 'spawning' | 'running';

export interface LocalTaskLockRecordV1 {
  readonly v: 1;
  readonly taskId: string;
  readonly pid: number;
  readonly pidStartTime: string;
  readonly pidNs: string | null;
  readonly timeNs: string | null;
  readonly phase: LockPhase;
  readonly childPid: number | null;
  readonly childPgid: number | null;
  readonly host: string;
  readonly bootId: string | null;
  readonly nonce: string;
  readonly acquiredAt: string;
}

export interface ProcStatSample {
  readonly state: string;
  readonly startTime: string;
}

export interface LockSystemDeps {
  readonly pid: number;
  readonly hostname: () => string;
  readonly geteuid: () => number;
  readonly nowMs: () => number;
  readonly readBootId: () => string | null;
  readonly readSelfStartTime: () => string | null;
  readonly readProcStat: (pid: number) => ProcStatSample | null;
  readonly readProcThreads: (pid: number) => number | null;
  readonly readSelfPidNs: () => string | null;
  readonly readSelfTimeNs: () => string | null;
  readonly readBootTimeMs: () => number | null;
  readonly statfsType: (dirPath: string) => number | null;
  readonly killZero: (pid: number) => 'alive' | 'esrch' | 'eperm' | 'other';
  readonly onPublishWrite?: () => void;
  readonly onBeforeReclaimUnlink?: (ctx: { readonly lockPath: string; readonly quarantinePath: string }) => void;
  readonly unlinkLockFn?: (filePath: string) => void;
}

export function parseLockRecord(rawText: string, expectedTaskId?: string): LocalTaskLockRecordV1 | null {
  let raw: unknown;
  try { raw = JSON.parse(rawText); } catch { return null; }
  if (!isPlainObject(raw) || raw.v !== 1 || typeof raw.taskId !== 'string') return null;
  if (expectedTaskId !== undefined && raw.taskId !== expectedTaskId) return null;
  if (!Number.isInteger(raw.pid) || (raw.pid as number) <= 0 || typeof raw.pidStartTime !== 'string') return null;
  if (raw.pidNs !== null && typeof raw.pidNs !== 'string') return null;
  if (raw.timeNs !== null && typeof raw.timeNs !== 'string') return null;
  if (raw.phase !== 'acquired' && raw.phase !== 'spawning' && raw.phase !== 'running') return null;
  if (raw.childPid !== null && (!Number.isInteger(raw.childPid) || (raw.childPid as number) <= 0)) return null;
  if (raw.childPgid !== null && (!Number.isInteger(raw.childPgid) || (raw.childPgid as number) <= 0)) return null;
  if (typeof raw.host !== 'string' || typeof raw.nonce !== 'string' || !isValidUtcIsoZ(raw.acquiredAt)) return null;
  if (raw.bootId !== null && typeof raw.bootId !== 'string') return null;
  return raw as unknown as LocalTaskLockRecordV1;
}
