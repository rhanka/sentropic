import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_SLOTS, REPOSITORY, SEAT_STATE_HEAD, SyntheticEnvironmentApi, allowedSecretNames,
  canonicalProjectionRoundtrip, sealSecret, openSealed, slotSecretNames, stateBankNames,
} from '../src/seat-environment-custody.ts';

const setup = () => {
  const api = new SyntheticEnvironmentApi({ repository: REPOSITORY });
  api.provision('security-seat-maintenance', 'SEAT_CODEX_00', 'synthetic-canonical-coded-value');
  return api;
};

test('T5-C2: synthetic canonical → projection → newly queued N+1 run reads the fresh snapshot; the original run is stale', async () => {
  const api = setup();
  const result = await canonicalProjectionRoundtrip(api, {
    cli: 'codex', slot: '00', writerRunId: 'run-1', writerRunAttempt: 1,
  });
  assert.equal(result.nPlusOne, true);
  assert.equal(result.originalRunStale, true);
  const first = await api.snapshot('run-1');
  const second = await api.snapshot(result.queuedRunId);
  assert.equal(first['security-nightly']?.['SEAT_USE_CODEX_00'], undefined);
  assert.equal(second['security-nightly']?.['SEAT_USE_CODEX_00'], 'synthetic-projection-codex-00');
  assert.equal(second['security-seat-maintenance']?.['SEAT_CODEX_00'], 'synthetic-canonical-coded-value');
});

test('T5-C2: same-run dependents, stale reruns, wrong repository/environment/generation and writer/native co-residence refuse', async () => {
  const api = setup();
  await assert.rejects(
    canonicalProjectionRoundtrip(api, { cli: 'codex', slot: '00', writerRunId: 'run-1', writerRunAttempt: 1, sameRun: true }),
    /same-run/);
  const r = await canonicalProjectionRoundtrip(api, { cli: 'codex', slot: '00', writerRunId: 'run-1', writerRunAttempt: 1 });
  await assert.rejects(api.snapshotStale(r.queuedRunId, 'run-1'), /stale-rerun/);
  await assert.rejects(
    api.putSealed('security-seat-writer', 'SEAT_STATE_HEAD', sealSecret(await api.publicKey('security-seat-writer'), 'x'),
      { runId: 'run-9', runAttempt: 1, repository: 'rhanka/other' }), /repository/);
  await assert.rejects(
    api.putSealed('security-nightly', 'SEAT_STATE_HEAD', sealSecret(await api.publicKey('security-nightly'), 'x'),
      { runId: 'run-9', runAttempt: 1, repository: REPOSITORY }), /environment-not-writer/);
  await assert.rejects(
    api.putSealed('security-seat-writer', 'ARBITRARY_NAME', sealSecret(await api.publicKey('security-seat-writer'), 'x'),
      { runId: 'run-9', runAttempt: 1, repository: REPOSITORY }), /secret-name/);
  await assert.rejects(api.readSecret('security-nightly', 'SEAT_STATE_A_00', 'run-9'), /writer-native-separation/);
  await assert.rejects(
    canonicalProjectionRoundtrip(api, { cli: 'codex', slot: '00', writerRunId: 'run-1', writerRunAttempt: 1, wrongGeneration: true }),
    /generation/);
});

test('T5-C2/T6-C2: ambiguous sealed PUT retries only identical bytes; a lost acknowledgement stays pending', async () => {
  const api = setup();
  const env = 'security-seat-maintenance'; const name = 'SEAT_CODEX_00';
  const key = await api.publicKey(env);
  const envelope = sealSecret(key.pem, key.keyId, 'synthetic-v2');
  api.failNextPut('ambiguous');
  await assert.rejects(
    api.putSealed(env, name, envelope, { runId: 'run-2', runAttempt: 1, repository: REPOSITORY }), /ambiguous-ack/);
  const retry = await api.putSealed(env, name, envelope, { runId: 'run-2', runAttempt: 1, repository: REPOSITORY });
  assert.equal(retry.acknowledged, true);
  const other = sealSecret(key.pem, key.keyId, 'synthetic-v3');
  api.failNextPut('ambiguous');
  await assert.rejects(
    api.putSealed(env, name, other, { runId: 'run-3', runAttempt: 1, repository: REPOSITORY }), /ambiguous-ack/);
  await assert.rejects(
    api.putSealed(env, name, sealSecret(key.pem, key.keyId, 'synthetic-v4'), { runId: 'run-3', runAttempt: 1, repository: REPOSITORY }),
    /ambiguous-mismatch/);
  api.failNextPut('lost');
  await assert.rejects(
    api.putSealed(env, name, other, { runId: 'run-4', runAttempt: 1, repository: REPOSITORY }), /lost-ack/);
  assert.equal(api.pendingAcknowledgements(), 1);
});

test('T5-C2: refresh-bearing projections refuse; canonical-before-projection ordering is enforced', async () => {
  const api = setup();
  await assert.rejects(
    canonicalProjectionRoundtrip(api, { cli: 'vibe', slot: '01', writerRunId: 'run-1', writerRunAttempt: 1, refreshBearing: true }),
    /refresh-bearing/);
  await assert.rejects(
    canonicalProjectionRoundtrip(api, { cli: 'vibe', slot: '01', writerRunId: 'run-1', writerRunAttempt: 1, projectionFirst: true }),
    /canonical-before-projection/);
});

test('T6-C1: all twelve reader-token copies rotate under one epoch; a missed copy fences the role', async () => {
  const api = setup();
  const first = await api.rotateReaderToken(2);
  assert.equal(first.updated.length, 12);
  assert.deepEqual(first.missed, []);
  const run = await api.queueWorkflow({ workflowId: 'security-daily.yml', ref: 'refs/heads/main', afterRunId: 'run-1' });
  const snap = await api.snapshot(run.runId);
  for (const env of ['security-daily-control', 'security-nightly', 'security-seat-writer', 'security-seat-admission',
    'security-seat-dispatch', 'security-report-publish', 'security-repair-publish', 'security-repair-merge',
    'security-review-attest', 'security-source-acquire', 'security-ci-status', 'security-promotion-control']) {
    assert.equal(snap[env]?.['SECURITY_CONTROL_READER_TOKEN'], 'reader-token-epoch-2', env);
  }
  await assert.rejects(api.snapshotWithEpoch(run.runId, 1), /reader-token-stale/);
  const missed = await api.rotateReaderToken(3, ['security-ci-status']);
  assert.deepEqual(missed.missed, ['security-ci-status']);
  await assert.rejects(api.verifyReaderCopies(run.runId), /reader-copy-missed/);
});

test('T6-C1: fixed literal secret-name inventory and slot ceilings (K≤40; maintenance 2K≤80; nightly ≤42)', () => {
  const banks = stateBankNames();
  assert.equal(banks.length, 32);
  assert.ok(banks.includes('SEAT_STATE_A_00') && banks.includes('SEAT_STATE_B_15'));
  assert.equal(SEAT_STATE_HEAD, 'SEAT_STATE_HEAD');
  assert.equal(MAX_SLOTS, 40);
  const slots = slotSecretNames(MAX_SLOTS);
  assert.equal(slots.canonical.length, MAX_SLOTS);
  assert.equal(slots.candidate.length, MAX_SLOTS);
  assert.equal(slots.projection.length, MAX_SLOTS);
  assert.ok(slots.canonical.every(n => /^SEAT_[A-Z]+_\d{2}$/.test(n)));
  assert.ok(slots.projection.every(n => /^SEAT_USE_[A-Z]+_\d{2}$/.test(n)));
  assert.equal(allowedSecretNames('security-seat-maintenance').size, 2 * MAX_SLOTS);
  assert.ok(allowedSecretNames('security-seat-writer').size <= 37);
  assert.throws(() => slotSecretNames(MAX_SLOTS + 1), /slot-ceiling/);
});

test('sealed envelopes are bound to the environment key and tamper-evident', async () => {
  const api = setup();
  const key = await api.publicKey('security-seat-maintenance');
  const envelope = sealSecret(key.pem, key.keyId, 'payload');
  assert.equal(openSealed(api.privateKeyPem('security-seat-maintenance'), envelope), 'payload');
  const other = await api.publicKey('security-nightly');
  assert.throws(() => openSealed(api.privateKeyPem('security-nightly'), envelope), /key/);
  const tampered = { ...envelope, ciphertext: envelope.ciphertext.slice(0, -4) + 'AAAA' };
  assert.throws(() => openSealed(api.privateKeyPem('security-seat-maintenance'), tampered), /digest|decrypt/);
  assert.throws(() => sealSecret(key.pem, 'other-key-id', 'x'), /key-id/);
  assert.ok(other.keyId !== key.keyId);
});
