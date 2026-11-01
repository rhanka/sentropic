import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CONSUMER_UID, LAUNCH_STEP_ID, WATCHER_UID, makePlacementReceipt, translatePeerCred, validatePlacementReceipt,
} from '../src/ci-seat-topology.ts';

test('T6-C3: a valid placement receipt passes with translated SO_PEERCRED triples and fixed elevation', () => {
  const receipt = makePlacementReceipt();
  validatePlacementReceipt(receipt);
  assert.equal(receipt.watcher.uid, WATCHER_UID);
  assert.equal(receipt.consumer.uid, CONSUMER_UID);
  assert.equal(receipt.elevation.stepId, LAUNCH_STEP_ID);
  // translation inside the endpoint namespace: host 300/62002 maps to ns 55/62002
  const map = { pid: { 300: 55 }, uid: { 62002: 62002 }, gid: { 62002: 62002 } };
  const translated = translatePeerCred({ pid: 300, uid: 62002, gid: 62002 }, map, 'host-ns', 'container-ns');
  assert.deepEqual(translated, { pid: 55, uid: 62002, gid: 62002 });
});

test('T6-C3: unmapped/overflow UID confusion and host-value substitution refuse', () => {
  const map = { pid: { 300: 55 }, uid: { 62002: 62002 }, gid: { 62002: 62002 } };
  assert.throws(() => translatePeerCred({ pid: 300, uid: 62001, gid: 62002 }, map, 'host-ns', 'container-ns'), /peer-unmapped/);
  assert.throws(() => translatePeerCred({ pid: 300, uid: 2 ** 31, gid: 62002 }, map, 'host-ns', 'container-ns'), /peer-overflow/);
  // host UID 62001 appearing untranslated in a different namespace is substitution, not proof
  const sameMap = { pid: { 300: 300 }, uid: { 62001: 62001 }, gid: { 62001: 62001 } };
  assert.throws(() => translatePeerCred({ pid: 300, uid: 62001, gid: 62001 }, sameMap, 'host-ns', 'other-ns'), /host-value-substitution/);
  const ok = translatePeerCred({ pid: 300, uid: 62001, gid: 62001 }, sameMap, 'host-ns', 'host-ns');
  assert.equal(ok.uid, 62001);
});

test('T6-C3: receipt refusals — collision, root listener, changed mapping, peer mismatch/equality, extra elevation, missing guardian, clock/FD bounds', () => {
  const cases: [string, (r: ReturnType<typeof makePlacementReceipt>) => void][] = [
    ['identity-collision', r => { r.watcher.uid = CONSUMER_UID; }],
    ['root-created-listener', r => { r.socket.listenerUid = 0; }],
    ['changed-mapping', r => { r.uidMap = '0 0 65536'; }],
    ['peer-mismatch', r => { r.peerVerification.observed = { ...r.peerVerification.observed, uid: WATCHER_UID }; }],
    ['peer-identity-equal', r => { r.peerVerification.observed = { pid: 100, uid: 1000, gid: 1000 }; r.peerVerification.expected = { pid: 100, uid: 1000, gid: 1000 }; }],
    ['extra-elevation-route', r => { r.elevation.stepId = 'sudo-custom-step'; }],
    ['caller-supplied-command', r => { r.elevation.argumentSchema = 'caller:v9'; }],
    ['missing-guardian', r => { r.guardianReceipt.watchedProcessGroups = []; }],
    ['lost-liveness-fd', r => { r.guardianReceipt.livenessFd = -1; }],
    ['stopped-watcher-clock', r => { r.clock.detectionSeconds = 61; }],
    ['termination-bound', r => { r.clock.totalSeconds = 76; }],
    ['direct-read-timeout', r => { r.directRead.getTimeoutSeconds = 3; }],
    ['direct-read-validity', r => { r.directRead.validitySeconds = 6; }],
    ['wrong-repository', r => { r.repository = 'other/repo'; }],
  ];
  for (const [name, mutate] of cases) {
    const receipt = makePlacementReceipt();
    mutate(receipt);
    assert.throws(() => validatePlacementReceipt(receipt), undefined, name);
  }
});
