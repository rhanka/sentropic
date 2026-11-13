import assert from 'node:assert/strict';
import { readdirSync, readFileSync, readlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

/** Capture every process and private netns in the exact tenant scope. */
export function qualificationProcesses(uid: string): { pids: string[]; namespaces: string[] } {
  const group = execFileSync('systemctl', ['show', `builder-sbx-${uid}.scope`, '--property=ControlGroup', '--value'],
    { encoding: 'utf8', timeout: 1000, killSignal: 'SIGKILL' }).trim();
  assert.match(group, /^\/builder\.slice\/builder-tenant\.slice\/builder-tenant-(sentropic|immo)\.slice\/builder-sbx-[a-zA-Z0-9-]+\.scope$/);
  const pids = readFileSync(`/sys/fs/cgroup${group}/cgroup.procs`, 'utf8').trim().split(/\s+/).filter(Boolean);
  assert.ok(pids.length, 'empty qualification scope');
  const host = readlinkSync('/proc/self/ns/net');
  const namespaces = [...new Set(pids.flatMap(pid => {
    try { const namespace = readlinkSync(`/proc/${pid}/ns/net`); return namespace === host ? [] : [namespace]; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
  }))];
  return { pids, namespaces };
}

/** Refuse residual processes AND open namespace FDs, including outside the scope. */
export function assertQualificationProcessesGone(snapshot: ReturnType<typeof qualificationProcesses>): void {
  for (const pid of readdirSync('/proc').filter(name => /^\d+$/.test(name))) {
    const links = [`/proc/${pid}/ns/net`];
    try { links.push(...readdirSync(`/proc/${pid}/fd`).map(fd => `/proc/${pid}/fd/${fd}`)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    for (const path of links) {
      try { assert.ok(!snapshot.namespaces.includes(readlinkSync(path)), `private netns remains at ${path}`); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
    if (snapshot.pids.includes(pid)) {
      // Reused PID is permitted; a surviving captured process is not.
      assert.fail(`qualification process ${pid} still exists`);
    }
  }
}
