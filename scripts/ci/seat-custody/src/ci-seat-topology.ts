// r6 §4.3.2 ControlHostPlacementReceiptV1: kernel-translated SO_PEERCRED triples,
// fixed launch-security-control-root elevation, named guardian, clock/termination bounds.
import { ensure } from './seat-admission.ts';

export const WATCHER_UID = 62001;
export const CONSUMER_UID = 62002;
export const LAUNCH_STEP_ID = 'launch-security-control-root';
export const CONTROL_LAUNCH_BINARY = 'security-control-launch';
export const CLOCK_DETECTION_LIMIT_S = 60;
export const CLOCK_TOTAL_LIMIT_S = 75;
export const DIRECT_READ_GET_TIMEOUT_S = 2;
export const DIRECT_READ_VALIDITY_S = 5;

export type PeerCred = { pid: number; uid: number; gid: number };
export type NamespaceMap = {
  pid: Record<number, number>; uid: Record<number, number>; gid: Record<number, number>;
};

// Translate a host SO_PEERCRED triple into the endpoint's namespace. Overflow,
// unmapped or colliding identities refuse; a translated value equal to the host
// value inside a *different* namespace is host-value substitution and refuses.
export function translatePeerCred(host: PeerCred, map: NamespaceMap, hostNamespace: string, endpointNamespace: string): PeerCred {
  ensure(Number.isSafeInteger(host.pid) && host.pid >= 0 && host.pid <= 2 ** 31 - 1, 'peer-overflow');
  ensure(Number.isSafeInteger(host.uid) && host.uid >= 0 && host.uid <= 2 ** 31 - 1, 'peer-overflow');
  ensure(Number.isSafeInteger(host.gid) && host.gid >= 0 && host.gid <= 2 ** 31 - 1, 'peer-overflow');
  const pid = map.pid[host.pid]; const uid = map.uid[host.uid]; const gid = map.gid[host.gid];
  ensure(Number.isSafeInteger(pid) && Number.isSafeInteger(uid) && Number.isSafeInteger(gid), 'peer-unmapped');
  if (hostNamespace !== endpointNamespace) {
    ensure(!(pid === host.pid && uid === host.uid && gid === host.gid), 'host-value-substitution');
  }
  return { pid, uid, gid };
}

export type ElevationReceipt = {
  stepId: string; wrapperDigest: string; binaryName: string; binaryDigest: string;
  argumentSchema: string; mechanism: string; effectiveUid: number; capabilities: string[];
  dropSteps: string[];
};

export function assertElevation(e: ElevationReceipt): void {
  ensure(e.stepId === LAUNCH_STEP_ID, 'elevation-step');
  ensure(e.binaryName === CONTROL_LAUNCH_BINARY, 'elevation-binary');
  ensure(/^[0-9a-f]{64}$/.test(e.wrapperDigest) && /^[0-9a-f]{64}$/.test(e.binaryDigest), 'elevation-digest');
  ensure(e.argumentSchema === 'fixed:v1' && e.mechanism !== '', 'elevation-schema');
  ensure(e.effectiveUid === 0 && Array.isArray(e.capabilities) && e.dropSteps.length > 0, 'elevation-drop');
}

export type GuardianReceipt = {
  executableDigest: string; configDigest: string; processIdentity: string;
  watchedProcessGroups: number[]; livenessFd: number; clockSource: string; clockEpoch: number;
  observedKill: boolean; observedEof: boolean;
};

export function assertGuardian(g: GuardianReceipt): void {
  ensure(/^[0-9a-f]{64}$/.test(g.executableDigest) && /^[0-9a-f]{64}$/.test(g.configDigest), 'guardian-digest');
  ensure(g.processIdentity.length > 0 && g.watchedProcessGroups.length > 0, 'guardian-watch');
  ensure(Number.isSafeInteger(g.livenessFd) && g.livenessFd >= 0, 'guardian-liveness-fd');
  ensure(g.clockSource === 'chronyd-nts' && Number.isSafeInteger(g.clockEpoch), 'guardian-clock');
  ensure(g.observedKill && g.observedEof, 'guardian-behavior');
}

export type ControlHostPlacementReceiptV1 = {
  schemaVersion: 1;
  repository: string; workflow: string; runId: string; runAttempt: number;
  job: string; environment: string; controlDigests: Record<string, string>;
  hostBootId: string;
  launcher: { pid: number; uid: number; gid: number };
  watcher: { pid: number; uid: number; gid: number };
  consumer: { pid: number; uid: number; gid: number };
  guardian: { pid: number; uid: number; gid: number };
  namespaces: { pid: string; user: string; mount: string; network: string; time: string };
  uidMap: string; gidMap: string;
  socket: { path: string; inode: number; mode: number; listenerUid: number };
  channelBinding: string;
  peerVerification: { expected: PeerCred; observed: PeerCred; result: 'match' | 'mismatch' };
  elevation: ElevationReceipt;
  guardianReceipt: GuardianReceipt;
  clock: { detectionSeconds: number; totalSeconds: number };
  directRead: { getTimeoutSeconds: number; validitySeconds: number };
};

export function validatePlacementReceipt(r: ControlHostPlacementReceiptV1): void {
  ensure(r.schemaVersion === 1, 'schema');
  ensure(r.repository === 'rhanka/sentropic', 'repository');
  ensure(r.watcher.uid === WATCHER_UID, 'watcher-uid');
  ensure(r.consumer.uid === CONSUMER_UID, 'consumer-uid');
  ensure(r.launcher.uid !== r.watcher.uid && r.watcher.uid !== r.consumer.uid, 'identity-collision');
  ensure(r.uidMap === '0 1000 65536' && r.gidMap === '0 1000 65536', 'mapping-changed');
  ensure(r.socket.listenerUid !== 0, 'root-created-listener');
  ensure(r.socket.mode === 0o660, 'socket-mode');
  ensure(r.peerVerification.result === 'match'
    && r.peerVerification.expected.pid === r.peerVerification.observed.pid
    && r.peerVerification.expected.uid === r.peerVerification.observed.uid
    && r.peerVerification.expected.gid === r.peerVerification.observed.gid, 'peer-verification');
  ensure(r.peerVerification.observed.uid !== r.launcher.uid, 'peer-identity-equal');
  assertElevation(r.elevation);
  assertGuardian(r.guardianReceipt);
  ensure(r.clock.detectionSeconds <= CLOCK_DETECTION_LIMIT_S && r.clock.totalSeconds <= CLOCK_TOTAL_LIMIT_S
    && r.clock.totalSeconds >= r.clock.detectionSeconds, 'clock-bounds');
  ensure(r.directRead.getTimeoutSeconds <= DIRECT_READ_GET_TIMEOUT_S
    && r.directRead.validitySeconds <= DIRECT_READ_VALIDITY_S, 'direct-read-bounds');
}

export function makePlacementReceipt(overrides: Partial<ControlHostPlacementReceiptV1> = {}): ControlHostPlacementReceiptV1 {
  const base: ControlHostPlacementReceiptV1 = {
    schemaVersion: 1,
    repository: 'rhanka/sentropic', workflow: 'security-daily.yml', runId: '2719', runAttempt: 1,
    job: 'scan-supervisor', environment: 'security-daily-control',
    controlDigests: { control: 'c'.repeat(64), launch: 'd'.repeat(64) },
    hostBootId: 'boot-1',
    launcher: { pid: 100, uid: 1000, gid: 1000 },
    watcher: { pid: 200, uid: WATCHER_UID, gid: WATCHER_UID },
    consumer: { pid: 300, uid: CONSUMER_UID, gid: CONSUMER_UID },
    guardian: { pid: 400, uid: WATCHER_UID, gid: WATCHER_UID },
    namespaces: { pid: '4026532', user: '4026532', mount: '4026533', network: '4026534', time: '4026535' },
    uidMap: '0 1000 65536', gidMap: '0 1000 65536',
    socket: { path: '/run/seat-control/permits.sock', inode: 424242, mode: 0o660, listenerUid: WATCHER_UID },
    channelBinding: 'cb'.repeat(32),
    peerVerification: { expected: { pid: 55, uid: CONSUMER_UID, gid: CONSUMER_UID }, observed: { pid: 55, uid: CONSUMER_UID, gid: CONSUMER_UID }, result: 'match' },
    elevation: {
      stepId: LAUNCH_STEP_ID, wrapperDigest: 'e'.repeat(64), binaryName: CONTROL_LAUNCH_BINARY,
      binaryDigest: 'f'.repeat(64), argumentSchema: 'fixed:v1', mechanism: 'reviewed-noninteractive-wrapper',
      effectiveUid: 0, capabilities: ['CAP_SETUID', 'CAP_SETGID', 'CAP_SYS_ADMIN'], dropSteps: ['setuid 62001', 'setgid 62001', 'unshare --mount --pid --net --time'],
    },
    guardianReceipt: {
      executableDigest: '1'.repeat(64), configDigest: '2'.repeat(64), processIdentity: 'security-control-guardian@sha256:1111',
      watchedProcessGroups: [200, 300], livenessFd: 7, clockSource: 'chronyd-nts', clockEpoch: 3,
      observedKill: true, observedEof: true,
    },
    clock: { detectionSeconds: 60, totalSeconds: 75 },
    directRead: { getTimeoutSeconds: 2, validitySeconds: 5 },
  };
  return { ...base, ...overrides };
}
