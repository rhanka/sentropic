import { describe, it, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PERMIT_TTL_MS,
  CHALLENGE_TIMEOUT_MS,
  GET_TIMEOUT_MS,
  WATCHER_UID,
  CONSUMER_UID,
  ELEVATION_STEP,
  ELEVATION_BINARY,
  channelBinding,
  validateChallenge,
  permitWindow,
  validatePlacementReceipt,
  validateGuardianReceipt,
} from './control-permit.mjs';
import {
  PERMIT_VALIDITY_S,
  SOCKET_FAMILY,
  assertChannel,
  permitKeys,
  signPermit,
  verifyPermit,
} from './control-permit-channel.mjs';

const ctx = {
  hostBootId: 'boot-1',
  watcherInstanceId: 'w-1',
  consumerInstanceId: 'c-1',
  targetRepositoryId: 123,
  workflowSha: 'a'.repeat(40),
  runId: 9,
  runAttempt: 1,
  jobId: 'deadline-record',
};

function challenge() {
  return {
    schemaVersion: 1,
    consumerInstanceId: 'c-1',
    channelBinding: channelBinding(ctx),
    action: 'deadline-record',
    operationId: 'op-1',
    requestNonce: 'ab'.repeat(32),
    binding: { purpose: 'deadline-report', generation: 3 },
  };
}

describe('L8-G: permit channel contract', () => {
  it('positive challenge validates against its context', () => {
    assert.deepEqual(validateChallenge(challenge(), ctx), []);
    assert.equal(PERMIT_TTL_MS, 5000);
    assert.equal(CHALLENGE_TIMEOUT_MS, 3000);
    assert.equal(GET_TIMEOUT_MS, 2000);
  });

  it('wrong binding, reused/short nonce and oversized frames fail', () => {
    assert.ok(validateChallenge({ ...challenge(), channelBinding: '00'.repeat(32) }, ctx).length > 0);
    assert.ok(validateChallenge({ ...challenge(), requestNonce: 'abcd' }, ctx).length > 0);
    assert.ok(validateChallenge({ ...challenge(), extra: true }, ctx).length > 0);
    assert.ok(validateChallenge({ ...challenge(), action: 'merge-fix' }, ctx).length > 0);
  });

  it('permit window expires exactly five seconds after read start', () => {
    const window = permitWindow({ readStartedAt: 100000, observedAt: 100001, issuedAt: 100002 });
    assert.equal(window.expiresAt, 105000);
    assert.equal(window.liveAt(104999), true);
    assert.equal(window.liveAt(105000), false);
  });
});

describe('T6-C3: placement receipt refuses identity confusion', () => {
  function receipt() {
    return {
      repositoryId: 123,
      workflow: 'security-report-control.yml',
      runId: 9,
      runAttempt: 1,
      job: 'deadline-record',
      environment: 'security-report-publish',
      controlDigest: 'd'.repeat(64),
      hostBootId: 'boot-1',
      launcher: { pid: 10, uid: 0 },
      watcher: { pid: 11, uid: WATCHER_UID },
      consumer: { pid: 12, uid: CONSUMER_UID },
      guardian: { pid: 13, uid: WATCHER_UID },
      namespaces: { watcher: 'ns-w', consumer: 'ns-c' },
      uidMap: '0 62001 1',
      gidMap: '0 62001 1',
      peers: {
        watcherSide: { pid: 11, uid: WATCHER_UID, gid: 1 },
        consumerSide: { pid: 12, uid: CONSUMER_UID, gid: 1 },
      },
      socket: { path: '/run/security/control.sock', inode: 99, mode: 0o770, creatorUid: WATCHER_UID },
      channelBinding: 'cb',
      peerVerification: 'matched',
    };
  }

  it('positive receipt validates with distinct UIDs', () => {
    assert.equal(WATCHER_UID, 62001);
    assert.equal(CONSUMER_UID, 62002);
    assert.deepEqual(validatePlacementReceipt(receipt()), []);
  });

  it('collision, root listener, overflow and equal peers fail', () => {
    assert.ok(validatePlacementReceipt({ ...receipt(), consumer: { pid: 12, uid: WATCHER_UID } }).length > 0);
    assert.ok(validatePlacementReceipt({ ...receipt(), socket: { path: '/x', inode: 1, mode: 0o770, creatorUid: 0 } }).length > 0);
    const overflow = receipt();
    overflow.peers.watcherSide.uid = 4294967295;
    assert.ok(validatePlacementReceipt(overflow).length > 0);
    const equal = receipt();
    equal.peers.consumerSide = { ...equal.peers.watcherSide };
    assert.ok(validatePlacementReceipt(equal).length > 0);
  });

  it('elevation entry is the single pinned root step', () => {
    assert.equal(ELEVATION_STEP, 'launch-security-control-root');
    assert.equal(ELEVATION_BINARY, 'security-control-launch');
    assert.deepEqual(validateGuardianReceipt({ executable: 'security-control-guardian', configDigest: 'c'.repeat(64), processId: 13, watchedGroups: ['watcher'], livenessFd: 7, clockSource: 'chronyd', clockEpoch: 5, behaviors: { kill: true, eof: true, pause: true, restart: true } }), []);
    assert.ok(validateGuardianReceipt({ executable: 'other', configDigest: 'c', processId: 1, watchedGroups: [], livenessFd: 0, clockSource: 'x', clockEpoch: 0, behaviors: {} }).length > 0);
  });
});

// T5-C6 / T6-C3 (r6 §6.4 D/ destination): watcher 62001 / consumer 62002 AF_UNIX permit
// channel — translated SO_PEERCRED triples, 5-second ed25519 permits, and refusal of
// forged/expired permits, wrong UIDs, wrong family and host-value substitution.
const keys = permitKeys();
const nowMs = 1_800_000_000_000;
const peer = { pid: 4242, uid: CONSUMER_UID, gid: CONSUMER_UID };
const hostPeer = { pid: 4242, uid: 0, gid: 0 };

function permit(overrides = {}) {
  const payload = { channelBinding: 'chan-1', consumerUid: CONSUMER_UID, issuedAtMs: nowMs, nonce: 'n-1', ...overrides };
  return { payload, signature: signPermit(keys.privatePem, payload) };
}

function channel(overrides = {}) {
  return {
    socketFamily: SOCKET_FAMILY, watcherUid: WATCHER_UID, consumerUid: CONSUMER_UID,
    expectedPeer: peer, observedPeer: peer, hostPeer, sameNamespace: false,
    permit: permit(), publicPem: keys.publicPem, nowMs,
    ...overrides,
  };
}

test('T5-C6/T6-C3: a valid channel admission passes with fixed UIDs, matching translated peer and a fresh permit', () => {
  const payload = assertChannel(channel());
  assert.equal(payload.consumerUid, CONSUMER_UID);
  assert.equal(WATCHER_UID, 62001);
  assert.equal(CONSUMER_UID, 62002);
  assert.equal(PERMIT_VALIDITY_S, 5);
});

test('T5-C6/T6-C3: wrong socket family, wrong watcher/consumer UID or peer mismatch refuses', () => {
  assert.throws(() => assertChannel(channel({ socketFamily: 'AF_INET' })), /channel-family/);
  assert.throws(() => assertChannel(channel({ watcherUid: 0 })), /watcher-uid/);
  assert.throws(() => assertChannel(channel({ consumerUid: 0 })), /consumer-uid/);
  assert.throws(() => assertChannel(channel({ observedPeer: { ...peer, pid: 9999 } })), /peer-triple-mismatch/);
  assert.throws(() => assertChannel(channel({ observedPeer: { pid: 1, uid: 0, gid: 0 } })), /peer-uid-mismatch/);
});

test('T5-C6/T6-C3: host-value substitution inside a different namespace refuses', () => {
  const substituted = { pid: hostPeer.pid, uid: 0, gid: 0 };
  assert.throws(
    () => assertChannel(channel({ observedPeer: substituted, expectedPeer: substituted, hostPeer })),
    /host-value-substitution|peer-uid-mismatch/,
  );
  // Same triple in the same namespace is legitimate.
  assert.equal(assertChannel(channel({ sameNamespace: true, hostPeer: null })).consumerUid, CONSUMER_UID);
});

test('T5-C6/T6-C3: forged, expired, future or wrong-consumer permits refuse', () => {
  const forged = permit();
  forged.signature = signPermit(permitKeys().privatePem, forged.payload);
  assert.throws(() => assertChannel(channel({ permit: forged })), /permit-forged/);
  assert.throws(() => assertChannel(channel({ permit: permit({ issuedAtMs: nowMs - (PERMIT_VALIDITY_S + 1) * 1000 }) })), /permit-expired/);
  assert.throws(() => assertChannel(channel({ permit: permit({ issuedAtMs: nowMs + 5000 }) })), /permit-future/);
  assert.throws(() => assertChannel(channel({ permit: permit({ consumerUid: 0 }) })), /permit-consumer-mismatch/);
  assert.throws(() => verifyPermit(keys.publicPem, { payload: {}, signature: 'AAAA' }, nowMs), /permit-forged|permit-malformed/);
});
