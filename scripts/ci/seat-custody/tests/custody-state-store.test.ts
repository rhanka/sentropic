import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AGGREGATE_LIMIT_BYTES, CHUNK_LIMIT_BYTES, DECODED_LIMIT_BYTES, ENVELOPE_LIMIT_BYTES,
  FENCE_LIMIT_BYTES, FENCE_MAX_RESERVATIONS, HEAD_LIMIT_BYTES, MAX_SEGMENTS, MAX_STATE_SECRETS,
  WRITER_ENV, CustodyStateStore, InterruptedAt, SeatStateFenceV1, buildEnvelope, buildHead,
  chunkBuffer, makeGenesisState, parseHead, sealForTest, serializeState, validateAggregate,
  validateState, type CustodyStateV1,
} from '../src/custody-state-store.ts';
import { REPOSITORY, SyntheticEnvironmentApi, allowedSecretNames } from '../src/seat-environment-custody.ts';

const setup = () => {
  const api = new SyntheticEnvironmentApi({ repository: REPOSITORY });
  const fence = new SeatStateFenceV1({ storeEpoch: 1 });
  const store = new CustodyStateStore(api, fence);
  return { api, fence, store };
};

const genesis = async (store: CustodyStateStore, api: SyntheticEnvironmentApi, fence: SeatStateFenceV1, overrides: Partial<CustodyStateV1> = {}) => {
  const boot = await api.queueWorkflow({ workflowId: 'security-seat.yml', ref: 'refs/heads/main' });
  const state = makeGenesisState({ storeEpoch: 1, ...overrides });
  await store.initialize(state, boot.runId, 1);
  fence.genesis(1);
  const run = await api.queueWorkflow({ workflowId: 'security-seat.yml', ref: 'refs/heads/main' });
  return run.runId;
};

const bump = (s: CustodyStateV1): CustodyStateV1 => {
  s.generation = s.generation + 1;
  s.priorCommittedGeneration = s.generation - 1;
  s.counters = { ...s.counters, fleet: s.counters.fleet + 1 };
  return s;
};

const INTERRUPT_POINTS = [
  'after-fence-cas', 'after-segment:0', 'before-head', 'after-head',
  'before-queue', 'after-queue', 'before-verify', 'after-verify',
  'before-commit', 'after-commit', 'before-dispatch', 'after-dispatch',
];

test('T6-C2: the eight-job transaction runs in the fixed §4.3.1 order and commits exactly once', async () => {
  const { api, fence, store } = setup();
  await genesis(store, api, fence);
  const result = await store.executeTransaction({ mutate: bump });
  assert.deepEqual(result.trace, [
    'state-intent', 'state-write-allocate', 'seat-continuation-dispatch', 'state-verify',
    'verify-canonical', 'verify-projection', 'state-commit', 'continuation-dispatch',
  ]);
  assert.equal(result.committed, true);
  assert.equal(result.generation, 2);
  assert.equal(fence.committedSeq, 2);
  assert.equal(fence.pending, null);
  assert.throws(() => fence.commit(result.transactionId), /pending-mismatch|commit-twice/);
  const run = await api.queueWorkflow({ workflowId: 'security-seat.yml', ref: 'refs/heads/main' });
  const state = await store.readCommitted(run.runId);
  assert.equal(state.generation, 2);
  assert.equal(state.counters.fleet, 1);
  assert.ok(state.journals.some(j => j.transactionId === result.transactionId));
});

test('T6-C2: interruption at every §4.3.1 boundary retains pending, admits nothing partial and resumes to exactly one commit', async () => {
  for (const point of INTERRUPT_POINTS) {
    const { api, fence, store } = setup();
    const run0 = await genesis(store, api, fence);
    const txId = 'tx-' + point;
    await assert.rejects(
      store.executeTransaction({ transactionId: txId, mutate: bump, interruptAt: point }),
      (error: unknown) => error instanceof InterruptedAt && error.point === point,
      point,
    );
    const preCommit = ['before-commit'].includes(point);
    if (point === 'after-commit' || point === 'before-dispatch' || point === 'after-dispatch') {
      assert.equal(fence.committedSeq, 2, `${point}: commit already advanced`);
      assert.equal(fence.pending, null, point);
    } else {
      assert.equal(fence.committedSeq, 1, `${point}: no commit before the commit job`);
      assert.equal(fence.pending?.transactionId, txId, `${point}: pending retained`);
      assert.throws(() => fence.checkGeneration(2), /fenced-pending/, `${point}: admission fenced while pending`);
      assert.throws(() => fence.casReserve('tx-other', run0), /pending-exists/, `${point}: second caller refused`);
    }
    const fresh = await api.queueWorkflow({ workflowId: 'security-seat.yml', ref: 'refs/heads/main' });
    const headNow = await store.readHead(fresh.runId);
    if (point === 'after-head' || point === 'before-queue' || point === 'after-queue' || point === 'before-verify'
      || point === 'after-verify' || point === 'before-commit' || point === 'after-commit'
      || point === 'before-dispatch' || point === 'after-dispatch') {
      assert.equal(headNow.generation, 2, `${point}: HEAD already published`);
    } else {
      assert.equal(headNow.generation, 1, `${point}: HEAD unchanged, no partial admission`);
    }
    const resumed = await store.executeTransaction({ transactionId: txId, mutate: bump });
    assert.equal(resumed.committed, true, point);
    assert.equal(fence.committedSeq, 2, `${point}: resumed commit`);
    assert.equal(fence.pending, null, point);
    assert.throws(() => fence.commit(txId), /pending-mismatch|commit-twice/, `${point}: exactly one commit`);
    const after = await api.queueWorkflow({ workflowId: 'security-seat.yml', ref: 'refs/heads/main' });
    assert.equal((await store.readCommitted(after.runId)).generation, 2, `${point}: committed state readable`);
    void preCommit;
  }
});

test('T6-C2: tampered segment order/count/size/digests, mixed generations, changed epoch and incomplete banks refuse', async () => {
  const { api, fence, store } = setup();
  await genesis(store, api, fence, { uncertainty: ['u'.repeat(30 * 1024)] });
  await store.executeTransaction({ mutate: bump });
  const fresh = async () => (await api.queueWorkflow({ workflowId: 'security-seat.yml', ref: 'refs/heads/main' })).runId;
  const run = await fresh();
  const head = await store.readHead(run);
  assert.equal(head.generation, 2);
  assert.ok(head.segmentCount >= 2, 'state must span multiple segments for the reorder case');
  const put = (name: string, obj: unknown) => sealForTest(api, run, name, obj);
  const seg0 = JSON.parse(await api.readSecret(WRITER_ENV, `SEAT_STATE_${head.bank}_00`, run));

  // reordered chunk digests
  await put('SEAT_STATE_HEAD', { ...head, chunkDigests: [...head.chunkDigests].reverse() });
  await assert.rejects(store.readCommitted(await fresh()), /digest|mixed/, 'reordered');
  // wrong segment count
  await put('SEAT_STATE_HEAD', { ...head, segmentCount: head.segmentCount + 1 });
  await assert.rejects(store.readCommitted(await fresh()), /unavailable|mismatch|count/, 'count+1');
  // oversize chunk with self-consistent digests
  const big = Buffer.alloc(CHUNK_LIMIT_BYTES + 1, 97);
  const bigEnv = JSON.parse(buildEnvelope({ storeEpoch: 1, generation: 3, transactionId: 'tx-big', bank: head.bank, index: 0, count: 1, stateDigest: 'x'.repeat(64), chunk: big }));
  await put(`SEAT_STATE_${head.bank}_00`, bigEnv);
  await put('SEAT_STATE_HEAD', { ...head, generation: 3, transactionId: 'tx-big', segmentCount: 1, totalBytes: big.length, chunkDigests: [bigEnv.chunkDigest], stateDigest: 'x'.repeat(64) });
  await assert.rejects(store.readCommitted(await fresh()), /chunk-limit/, 'oversize chunk');
  // flipped state digest (restore the genuine gen-2 segment first)
  await put(`SEAT_STATE_${head.bank}_00`, seg0);
  await put('SEAT_STATE_HEAD', { ...head, stateDigest: 'f'.repeat(64) });
  await assert.rejects(store.readCommitted(await fresh()), /digest/, 'flipped state digest');
  // mixed-generation segment: bank A gen-1 segment 0 under the gen-2 HEAD
  await put('SEAT_STATE_HEAD', head);
  const a0 = JSON.parse(await api.readSecret(WRITER_ENV, 'SEAT_STATE_A_00', await fresh()));
  await put(`SEAT_STATE_${head.bank}_00`, a0);
  await assert.rejects(store.readCommitted(await fresh()), /mixed-generation/, 'mixed generation');
  // changed epoch
  await put('SEAT_STATE_HEAD', { ...head, storeEpoch: 2 });
  await assert.rejects(store.readCommitted(await fresh()), /mixed-generation|epoch/, 'changed epoch');
  // pointer to an incomplete bank (count beyond written segments)
  await put('SEAT_STATE_HEAD', { ...head, segmentCount: MAX_SEGMENTS, chunkDigests: Array.from({ length: MAX_SEGMENTS }, () => '0'.repeat(64)) });
  await assert.rejects(store.readCommitted(await fresh()), /mixed|unavailable|digest|mismatch|count/, 'incomplete bank');
});

test('T6-C2: valid older HEAD fails the public high-water; forged higher HEAD has no committed fence; stale rerun refuses', async () => {
  const { api, fence, store } = setup();
  const run0 = await genesis(store, api, fence);
  const head1 = await store.readHead(run0);
  assert.equal(head1.generation, 1);
  await store.executeTransaction({ transactionId: 'tx-2', mutate: bump });
  assert.equal(fence.highWater, 2);
  const fresh = async () => (await api.queueWorkflow({ workflowId: 'security-seat.yml', ref: 'refs/heads/main' })).runId;
  const head2 = await store.readHead(await fresh());
  // restore the internally consistent gen-1 HEAD (bank A is preserved)
  await sealForTest(api, run0, 'SEAT_STATE_HEAD', head1);
  const stale = await store.readCommitted(await fresh());
  assert.equal(stale.generation, 1);
  assert.throws(() => fence.checkGeneration(1), /stale-high-water/);
  await assert.rejects(
    store.executeTransaction({ transactionId: 'tx-old', mutate: (s) => { s.generation = 1; s.priorCommittedGeneration = 0; return s; } }),
    /stale-high-water|uncommitted-head|generation-mismatch/,
  );
  fence.cancel('tx-old');
  // forged higher HEAD
  await sealForTest(api, run0, 'SEAT_STATE_HEAD', { ...head2, generation: 99 });
  await assert.rejects(
    store.executeTransaction({ transactionId: 'tx-forged', mutate: bump }),
    /uncommitted-head|generation-mismatch|mixed-generation/,
  );
  fence.cancel('tx-forged');
  // stale queued workflow / rerun
  await sealForTest(api, run0, 'SEAT_STATE_HEAD', head2);
  const r = await store.executeTransaction({ transactionId: 'tx-3', mutate: bump });
  await assert.rejects(api.snapshotStale(r.queuedRunId!, 'run-1'), /stale-rerun/);
});

test('T6-C2: cancelled pending job refuses resume, preserves holds, and a fresh transaction proceeds', async () => {
  const { api, fence, store } = setup();
  await genesis(store, api, fence, {
    reservations: [{ ref: 'res-1', family: 'codex/acct-a', credentialGeneration: 1, capacity: 10, held: 3, status: 'active' }],
    accounting: { authorized: 100, held: 3, spent: 0, released: 97 },
  });
  await assert.rejects(
    store.executeTransaction({ transactionId: 'tx-cancel', mutate: bump, interruptAt: 'after-fence-cas' }),
    InterruptedAt,
  );
  assert.equal(fence.pending?.transactionId, 'tx-cancel');
  fence.cancel('tx-cancel');
  assert.equal(fence.pending, null);
  const runX = await api.queueWorkflow({ workflowId: 'security-seat.yml', ref: 'refs/heads/main' });
  await assert.rejects(
    store.writeNext({ transactionId: 'tx-cancel', next: bump(await store.readCommitted(runX.runId)), runId: runX.runId, runAttempt: 1 }),
    /not-pending-owner/,
  );
  assert.throws(() => fence.commit('tx-cancel'), /pending-mismatch/);
  const ok = await store.executeTransaction({ transactionId: 'tx-fresh', mutate: bump });
  assert.equal(ok.committed, true);
  const run = await api.queueWorkflow({ workflowId: 'security-seat.yml', ref: 'refs/heads/main' });
  const state = await store.readCommitted(run.runId);
  assert.equal(state.reservations[0].held, 3, 'holds preserved');
  assert.equal(state.reservations[0].status, 'active');
});

test('T6-C2: two live independent reservations — settling one preserves the other; affected family fenced, unknown impact fences all', async () => {
  const { api, fence, store } = setup();
  await genesis(store, api, fence, {
    reservations: [
      { ref: 'res-1', family: 'codex/acct-a', credentialGeneration: 1, capacity: 10, held: 3, status: 'active' },
      { ref: 'res-2', family: 'vibe/acct-b', credentialGeneration: 1, capacity: 20, held: 5, status: 'active' },
    ],
    accounting: { authorized: 100, held: 8, spent: 0, released: 92 },
  });
  const settle = (s: CustodyStateV1): CustodyStateV1 => {
    s.generation += 1; s.priorCommittedGeneration = s.generation - 1;
    const r1 = s.reservations.find(r => r.ref === 'res-1')!;
    r1.held = 0; r1.status = 'fenced';
    s.accounting = { authorized: 100, held: 5, spent: 3, released: 92 };
    return s;
  };
  await store.executeTransaction({ transactionId: 'tx-settle', mutate: settle, impact: ['codex/acct-a'] });
  const run = await api.queueWorkflow({ workflowId: 'security-seat.yml', ref: 'refs/heads/main' });
  const state = await store.readCommitted(run.runId);
  const r2 = state.reservations.find(r => r.ref === 'res-2')!;
  assert.equal(r2.status, 'active', 'unaffected reservation keeps its permit path');
  assert.equal(r2.capacity, 20, 'admitted capacity preserved');
  assert.equal(r2.held, 5);
  const proj = JSON.parse(fence.project());
  assert.equal(proj.reservations.find((r: { ref: string }) => r.ref === 'res-1').status, 'fenced');
  assert.equal(proj.reservations.find((r: { ref: string }) => r.ref === 'res-2').status, 'active');
  await store.executeTransaction({ transactionId: 'tx-unknown', mutate: bump, impact: 'unknown' });
  const proj2 = JSON.parse(fence.project());
  assert.ok(proj2.reservations.every((r: { status: string }) => r.status === 'fenced'), 'unknown impact fences all');
});

test('T6-C2: platform rejection before any partial admission leaves HEAD and fence untouched', async () => {
  const { api, fence, store } = setup();
  await genesis(store, api, fence);
  api.failNextPut('lost');
  await assert.rejects(store.executeTransaction({ transactionId: 'tx-reject', mutate: bump }), /lost-ack/);
  const run = await api.queueWorkflow({ workflowId: 'security-seat.yml', ref: 'refs/heads/main' });
  assert.equal((await store.readHead(run.runId)).generation, 1, 'HEAD unchanged after rejected PUT');
  assert.equal(fence.pending?.transactionId, 'tx-reject', 'pending retained');
  assert.equal(fence.committedSeq, 1, 'no commit');
  const resumed = await store.executeTransaction({ transactionId: 'tx-reject', mutate: bump });
  assert.equal(resumed.committed, true);
  assert.equal(fence.committedSeq, 2);
  assert.throws(() => fence.commit('tx-reject'), /pending-mismatch|commit-twice/);
});

test('T6-C2: limits at and above ceilings refuse — 33 secrets, 1,318,912 B aggregate, 384 KiB decoded, 8 KiB HEAD, 16 segments, 128 reservations/16 KiB fence, K≤40 slots', async () => {
  const { api, fence, store } = setup();
  await genesis(store, api, fence);
  const stateNames = [...allowedSecretNames(WRITER_ENV)].filter(n => n.startsWith('SEAT_STATE_'));
  assert.equal(stateNames.length, MAX_STATE_SECRETS);
  assert.equal(MAX_SEGMENTS, 16);
  const key = await api.publicKey(WRITER_ENV);
  await assert.rejects(
    api.putSealed(WRITER_ENV, 'SEAT_STATE_C_00', sealForTest.seal(key, '{}'), { runId: 'run-x', runAttempt: 1, repository: REPOSITORY }),
    /secret-name/, '34th state name refused',
  );
  assert.equal(validateAggregate(AGGREGATE_LIMIT_BYTES, 0), true);
  assert.throws(() => validateAggregate(AGGREGATE_LIMIT_BYTES, 1), /aggregate-limit/);
  assert.throws(() => chunkBuffer(Buffer.alloc(DECODED_LIMIT_BYTES + 1)), /segment-limit/);
  assert.equal(chunkBuffer(Buffer.alloc(DECODED_LIMIT_BYTES)).length, MAX_SEGMENTS);
  assert.throws(() => buildEnvelope({ storeEpoch: 1, generation: 1, transactionId: 't', bank: 'A', index: 0, count: 1, stateDigest: 'd'.repeat(64), chunk: Buffer.alloc(30 * 1024) }), /envelope-limit/);
  assert.ok(Buffer.byteLength(buildEnvelope({ storeEpoch: 1, generation: 1, transactionId: 't', bank: 'A', index: 0, count: 1, stateDigest: 'd'.repeat(64), chunk: Buffer.alloc(CHUNK_LIMIT_BYTES) })) <= ENVELOPE_LIMIT_BYTES);
  assert.throws(() => parseHead('x'.repeat(HEAD_LIMIT_BYTES + 1)), /head-limit/);
  assert.throws(() => parseHead(JSON.stringify({ schemaVersion: 1, storeEpoch: 1, generation: 1, transactionId: 't', bank: 'A', segmentCount: 17, totalBytes: 1, chunkDigests: [], stateDigest: '', previousCommittedGeneration: 0, writerRunId: 'r', writerRunAttempt: 1 })), /segment-count/);
  const bigState = makeGenesisState({ storeEpoch: 1, uncertainty: ['u'.repeat(DECODED_LIMIT_BYTES)] });
  assert.throws(() => serializeState(bigState).length > DECODED_LIMIT_BYTES ? validateState(bigState) : null, /decoded|schema/);
  await assert.rejects(
    store.executeTransaction({ transactionId: 'tx-big', mutate: (s) => { s.generation += 1; s.priorCommittedGeneration = s.generation - 1; s.uncertainty = ['u'.repeat(DECODED_LIMIT_BYTES)]; return s; } }),
    /decoded-limit/,
  );
  for (let i = 0; i < FENCE_MAX_RESERVATIONS; i++) fence.reservations.set(`r${i}`, { family: 'f', credentialGeneration: 1, status: 'active' });
  assert.ok(Buffer.byteLength(fence.project()) <= FENCE_LIMIT_BYTES);
  fence.reservations.set('r-extra', { family: 'f', credentialGeneration: 1, status: 'active' });
  assert.throws(() => fence.project(), /fence-reservation-limit/);
  fence.reservations.clear();
  fence.reservations.set('r-big', { family: 'f'.repeat(FENCE_LIMIT_BYTES), credentialGeneration: 1, status: 'active' });
  assert.throws(() => fence.project(), /fence-limit/);
  assert.throws(() => validateState(makeGenesisState({ storeEpoch: 1, roster: Array.from({ length: 41 }, (_, i) => ({ account: `a${i}`, cli: 'CODEX', slot: `CODEX_${String(i).padStart(2, '0')}` })) })), /slot-limit/);
});

test('T6-C2: canonical/projection read-back is single-environment; wrong-environment read-back cannot pass', async () => {
  const { api, fence, store } = setup();
  await genesis(store, api, fence);
  const result = await store.executeTransaction({ mutate: bump, rotate: { cli: 'codex', slot: '00' } });
  const run = await api.queueWorkflow({ workflowId: 'security-seat.yml', ref: 'refs/heads/main' });
  assert.equal(await api.readSecret('security-seat-maintenance', 'SEAT_CODEX_00', run.runId), 'canonical-codex-00');
  assert.equal(await api.readSecret('security-nightly', 'SEAT_USE_CODEX_00', run.runId), 'projection-codex-00');
  await assert.rejects(api.readSecret('security-nightly', 'SEAT_CODEX_00', run.runId), /unavailable/, 'canonical not visible in nightly');
  await assert.rejects(api.readSecret('security-seat-maintenance', 'SEAT_USE_CODEX_00', run.runId), /unavailable/, 'projection not visible in maintenance');
  await assert.rejects(api.readSecret('security-nightly', 'SEAT_STATE_A_00', run.runId), /writer-native-separation/, 'state not visible outside writer');
  assert.ok(result.trace.includes('verify-canonical') && result.trace.includes('verify-projection'));
});
