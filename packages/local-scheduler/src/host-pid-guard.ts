import { readFileSync, readlinkSync, statSync } from 'node:fs';
import { PolicyRefusalError } from './errors.js';

export interface HostPidNamespaceProbes {
  readonly platform: NodeJS.Platform;
  readonly readLink: (p: string) => string;
  readonly statUid: (p: string) => number;
  readonly readText: (p: string) => string;
}

const DEFAULT_PROBES: HostPidNamespaceProbes = {
  platform: process.platform,
  readLink: (p) => readlinkSync(p),
  statUid: (p) => statSync(p).uid,
  readText: (p) => readFileSync(p, 'utf8'),
};

const HOST_INIT_PID_NS = 'pid:[4026531836]';

function sandboxRefusal(reason: string): never {
  throw new PolicyRefusalError(
    'POLICY_REFUSED_SANDBOX',
    'sandbox',
    `Host PID namespace guard failed (refusing sandboxed execution): ${reason}`,
  );
}

/**
 * Verifies the cumulative 3-part Linux host init PID namespace proof (§3.4) using injected probes.
 * Package-internal only; never exported from the public entrypoint.
 */
export function assertHostPidNamespaceWith(probes: HostPidNamespaceProbes): void {
  const p = probes;
  if (p.platform !== 'linux') {
    sandboxRefusal(`unsupported platform ${p.platform}`);
  }
  let pidNs: string;
  try {
    pidNs = p.readLink('/proc/self/ns/pid');
  } catch {
    sandboxRefusal('unreadable /proc/self/ns/pid');
  }
  if (pidNs !== HOST_INIT_PID_NS) {
    sandboxRefusal(`unexpected pid namespace ${pidNs}`);
  }
  let proc1Uid: number;
  try {
    proc1Uid = p.statUid('/proc/1');
  } catch {
    sandboxRefusal('unreadable /proc/1');
  }
  if (proc1Uid !== 0) {
    sandboxRefusal(`/proc/1 owned by uid ${proc1Uid}, expected 0`);
  }
  let comm: string;
  let cgroup: string;
  try {
    comm = p.readText('/proc/1/comm').trim();
    cgroup = p.readText('/proc/1/cgroup');
  } catch {
    sandboxRefusal('unreadable /proc/1/comm or /proc/1/cgroup');
  }
  if (comm !== 'systemd' && comm !== 'init') {
    sandboxRefusal(`/proc/1/comm is ${JSON.stringify(comm)}`);
  }
  if (!cgroup.split(/\r?\n/).some((line) => line.trim() === '0::/init.scope')) {
    sandboxRefusal('/proc/1/cgroup does not contain 0::/init.scope');
  }
}

/**
 * Verifies the cumulative 3-part Linux host init PID namespace proof (§3.4).
 * Fails closed with PolicyRefusalError (exit 77) on any mismatch or unreadable /proc file.
 */
export function assertHostPidNamespace(): void {
  assertHostPidNamespaceWith(DEFAULT_PROBES);
}
