import { lstatSync, readFileSync, readlinkSync, statfsSync, type Stats } from 'node:fs';
import os from 'node:os';
import type { LocalTaskLockRecordV1, LockSystemDeps, ProcStatSample } from './lock-types.js';

export const QUALIFIED_FS_MAGIC = new Set([0xef53, 0x58465342, 0x9123683e, 0xf2f52010]);
export const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const INIT_TIME_NS = 'time:[4026531834]';

function readProcStatFile(procPath: string): ProcStatSample | null {
  try {
    const raw = readFileSync(procPath, 'utf8');
    const closeParen = raw.lastIndexOf(')');
    if (closeParen < 0) return null;
    const fields = raw.slice(closeParen + 1).trim().split(/\s+/);
    return fields.length > 19 ? { state: fields[0], startTime: fields[19] } : null;
  } catch {
    return null;
  }
}
function readLinkOrNull(p: string): string | null {
  try { return readlinkSync(p); } catch { return null; }
}
export function defaultLockSystemDeps(): LockSystemDeps {
  const readSelfTimeNs = () => readLinkOrNull('/proc/self/ns/time');
  return {
    pid: process.pid,
    hostname: () => os.hostname(),
    geteuid: () => (process.getuid ? process.getuid() : 0),
    nowMs: () => Date.now(),
    readBootId: () => {
      try { return readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim(); } catch { return null; }
    },
    readSelfStartTime: () => readProcStatFile('/proc/self/stat')?.startTime ?? null,
    readProcStat: (pid) => readProcStatFile(`/proc/${pid}/stat`),
    readProcThreads: (pid) => {
      try {
        const m = /^Threads:\s*(\d+)/m.exec(readFileSync(`/proc/${pid}/status`, 'utf8'));
        return m ? Number(m[1]) : null;
      } catch {
        return null;
      }
    },
    readSelfPidNs: () => readLinkOrNull('/proc/self/ns/pid'),
    readSelfTimeNs,
    readBootTimeMs: () => {
      if (readSelfTimeNs() !== INIT_TIME_NS) return null;
      try {
        const btimeMatch = /^btime\s+(\d+)/m.exec(readFileSync('/proc/stat', 'utf8'));
        const uptimeSec = Number(readFileSync('/proc/uptime', 'utf8').trim().split(/\s+/)[0]);
        if (!btimeMatch || !Number.isFinite(uptimeSec)) return null;
        const btimeSec = Number(btimeMatch[1]);
        if (Math.abs((Date.now() / 1000 - uptimeSec) - btimeSec) > 5) return null;
        return btimeSec * 1000;
      } catch {
        return null;
      }
    },
    statfsType: (dirPath) => {
      try { return statfsSync(dirPath).type >>> 0; } catch { return null; }
    },
    killZero: (pid) => {
      try { process.kill(pid, 0); return 'alive'; } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        return code === 'ESRCH' ? 'esrch' : code === 'EPERM' ? 'eperm' : 'other';
      }
    },
  };
}
export function classifyLockReclaimability(
  record: LocalTaskLockRecordV1 | null,
  st: Stats,
  locksDir: string,
  deps: LockSystemDeps,
): 'dead' | 'undecidable' {
  const fsType = deps.statfsType(locksDir);
  if (fsType === null || !QUALIFIED_FS_MAGIC.has(fsType)) return 'undecidable';
  if (st.uid !== deps.geteuid() || !st.isFile()) return 'undecidable';
  if (record === null) {
    if (st.nlink !== 1) return 'undecidable';
    const bootTimeMs = deps.readBootTimeMs();
    return bootTimeMs !== null && st.mtimeMs < bootTimeMs && st.ctimeMs < bootTimeMs ? 'dead' : 'undecidable';
  }
  const currentBootId = deps.readBootId();
  if (record.bootId !== null && currentBootId !== null && UUID_REGEX.test(record.bootId) && UUID_REGEX.test(currentBootId)) {
    if (record.bootId !== currentBootId) return 'dead';
  }
  if (record.phase === 'spawning' && record.childPgid === null) return 'undecidable';
  const currentPidNs = deps.readSelfPidNs();
  if (record.host !== deps.hostname() || record.pidNs === null || record.pidNs !== currentPidNs) return 'undecidable';
  const currentTimeNs = deps.readSelfTimeNs();
  const sameTimeNs = record.timeNs !== null && record.timeNs === currentTimeNs;
  const k = deps.killZero(record.pid);
  if (k === 'other') return 'undecidable';
  let runnerDead = k === 'esrch';
  if (!runnerDead) {
    const pstat = deps.readProcStat(record.pid);
    if (pstat === null) return 'undecidable';
    if (pstat.state === 'Z') {
      runnerDead = sameTimeNs && deps.readProcThreads(record.pid) === 1 && pstat.startTime === record.pidStartTime;
    } else if (pstat.startTime !== record.pidStartTime) {
      runnerDead = sameTimeNs;
    }
  }
  if (!runnerDead) return 'undecidable';
  if (record.childPgid === null) return record.phase === 'acquired' ? 'dead' : 'undecidable';
  return deps.killZero(-record.childPgid) === 'esrch' ? 'dead' : 'undecidable';
}
export function safeLstat(filePath: string): Stats | null {
  try { return lstatSync(filePath); } catch { return null; }
}
