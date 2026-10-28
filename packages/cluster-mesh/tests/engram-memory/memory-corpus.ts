import { describe, expect, it } from 'vitest';
import type { CanonicalMemoryStorePort, Result } from '@sentropic/engram/memory-substrate';
import { memoryJcs } from '../../src/engram-memory/codec.js';
import { MEMORY_PINNED_PROFILES } from '../../src/engram-memory/manifest.js';
import type { MemoryCampaignHost } from './memory-pg-host.js';
import { DEADLINE, DIGEST, memoryCaptureRequest, memoryEngine } from './memory-engine.js';
import { assembleMemoryHostBinding, verifyHostBinding } from '../../src/engram-memory/binding.js';
import { openMemoryMaintenance } from '../../src/engram-memory/host-maintenance.js';
import { memoryMaintainGrant } from './pg-host.js';
import { awaitDeadLease, memoryPeer } from './memory-process.js';

export const MEMORY_STAGE_B_PROFILES = [
  'atomic-units-v1', 'immutable-chains-v1', 'immutable-boundaries-v1', 'scope-outbox-v1', 'fenced-writers-v1',
] as const;
export const MEMORY_STAGE_B_CASES = {
  'atomic-units-v1': ['capture-completion', 'completion-conflict', 'rollback', 'crash-before', 'crash-after',
    'C5/9007199254740991', 'C5/9223372036854775807', 'C5/18446744073709551614'],
  'immutable-chains-v1': ['first-proof-reopen', 'destruction-replay/accept', 'destruction-replay/reject'],
  'immutable-boundaries-v1': ['bounded-journal', 'bounded-outbox', 'accepted-snapshot'],
  'scope-outbox-v1': ['checkpoint-resync-snapshot', 'poison-retry', 'authority-refusals'],
  'fenced-writers-v1': ['second-holder', 'store-bijection', 'revocation', 'two-process', 'final-guard', 'C7'],
} as const;
export const memoryCaseInventory: string[] = [];
export const registerMemoryCase = (name: string) => { memoryCaseInventory.push(name.split(':')[0]!); };
export const memoryBlockedCases: { name: string; blockers: string[] }[] = [];
// The behavioral corpus executes only in the make-owned installed consumer.
export const memoryScenario = (open: () => Promise<MemoryCampaignHost>, name: string,
  run: (host: MemoryCampaignHost) => Promise<void>) => {
  registerMemoryCase(name);
  return it(name, async () => {
    const host = await open();
    try { await run(host); } finally { await host.close(); }
  });
};
export const MEMORY_NOW = '2026-10-27T00:00:00.000Z';
export const MEMORY_DIGEST = `sha256:${'a'.repeat(64)}` as const;
export const valueOf = <T>(result: Result<T>): T => {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
};
export const pendingCapture = (candidateId = 'candidate-1'): Parameters<CanonicalMemoryStorePort['commitPending']>[0] => ({
  control: { candidate_id: candidateId, envelope_digest: MEMORY_DIGEST, state: 'pending', created_cursor: '0',
    policy_id: 'policy-memory', policy_version: '1', capture_content_digest: MEMORY_DIGEST, capture_receipt_digest: MEMORY_DIGEST },
  sealed: { candidate_id: candidateId, envelope_ref: `envelope-${candidateId}`, envelope_digest: MEMORY_DIGEST,
    key_ref: `key-${candidateId}`, ciphertext: `ciphertext-${candidateId}` },
  capture_event: { schema_version: 2, event_id: `capture-${candidateId}`, cursor: '0', recorded_at: MEMORY_NOW,
    operation: 'capture', candidate_id: candidateId, to_state: 'pending', authorization_receipt_digest: MEMORY_DIGEST,
    previous_event_digest: MEMORY_DIGEST, event_digest: MEMORY_DIGEST },
});

export const runMemoryCorpus = (open: () => Promise<MemoryCampaignHost>): void => {
  const scenario = (name: string, run: (host: MemoryCampaignHost) => Promise<void>) => memoryScenario(open, name, run);
  describe('memory Stage B: exact read/write binding and separate host maintenance', () => {
    scenario('atomic-units-v1/capture-completion: should negotiate the binding and complete K7 without allocating another cursor', async (h) => {
      expect(h.binding.memoryGrant.operations).toEqual(['read', 'write']);
      expect(h.binding.maintainGrant.operations).toEqual(['read', 'maintain']);
      expect(h.handle.profiles).toEqual(MEMORY_PINNED_PROFILES.filter((claim) => MEMORY_STAGE_B_PROFILES.includes(claim.name as never)));
      expect(h.handle.profiles.map((claim) => claim.name)).toEqual(MEMORY_STAGE_B_PROFILES);
      const backendProfiles = (await h.kernel.bind(h.binding.memoryGrant)).profiles
        .filter((claim) => MEMORY_STAGE_B_PROFILES.includes(claim.profile as never));
      expect(backendProfiles.map((claim) => claim.profile)).toEqual(MEMORY_STAGE_B_PROFILES);
      for (const name of ['checkpoint', 'journalCheckpoint', 'snapshot', 'snapshotRead', 'resync', 'maintainGrant'])
        expect(name in h.handle).toBe(false);
      expect(valueOf(await h.store.readiness()).storage_epoch).toBe('1');
      const facts = await h.pg.tx.run(true, async (session) => ({
        server: (await session.execute({ text: `SELECT version(),current_setting('transaction_isolation') AS isolation,
          current_setting('synchronous_commit') AS synchronous_commit`, values: [] })).rows[0],
        migrations: await h.pg.history.read(session),
      }));
      expect(process.versions.node.split('.')[0]).toBe('24');
      expect(facts.server).toMatchObject({ isolation: 'serializable', synchronous_commit: 'on' });
      console.info('MEMORY_STAGE_B_RUNTIME', JSON.stringify({ node: process.version, arch: process.arch, server: facts.server,
        profiles: h.handle.profiles, backendProfiles, migrations: facts.migrations,
        pgData: 'Compose test-e2-int tmpfs; process/reopen durability only' }));
      const receipt = valueOf(await h.store.commitPending(pendingCapture()));
      expect(receipt.cursor).toBe('1');
      const complete = { candidate_id: 'candidate-1', record_digest: MEMORY_DIGEST };
      valueOf(await h.store.recordCaptureIdempotency!(complete));
      const proof = valueOf(await h.store.readCaptureIdempotency!({ candidate_id: 'candidate-1' }));
      expect(proof).toMatchObject({ record_digest: MEMORY_DIGEST });
      expect(valueOf(await h.store.readJournal({ after: '0', limit: 10 }))).toHaveLength(1);
      expect(h.units.at(-1)?.appends).toEqual([]);
      expect(h.units.at(-1)?.updates[0]?.version).toBe('2');
      const count = h.units.length;
      valueOf(await h.store.recordCaptureIdempotency!(complete));
      expect(h.units).toHaveLength(count);
    });
    scenario('atomic-units-v1/completion-conflict: should preserve the first completed digest', async (h) => {
      valueOf(await h.store.commitPending(pendingCapture()));
      valueOf(await h.store.recordCaptureIdempotency!({ candidate_id: 'candidate-1', record_digest: MEMORY_DIGEST }));
      const first = valueOf(await h.store.readCaptureIdempotency!({ candidate_id: 'candidate-1' }));
      expect(await h.store.recordCaptureIdempotency!({ candidate_id: 'candidate-1', record_digest: `sha256:${'b'.repeat(64)}` }))
        .toMatchObject({ ok: false, error: { code: 'DIGEST_CONFLICT' } });
      expect(valueOf(await h.store.readCaptureIdempotency!({ candidate_id: 'candidate-1' }))).toEqual(first);
    });
    scenario('immutable-chains-v1/first-proof-reopen: should replay original receipt bytes in a new epoch', async (h) => {
      const input = pendingCapture();
      const original = valueOf(await h.store.commitPending(input));
      valueOf(await h.store.recordCaptureIdempotency!({ candidate_id: 'candidate-1', record_digest: MEMORY_DIGEST }));
      const proof = valueOf(await h.store.readCaptureIdempotency!({ candidate_id: 'candidate-1' }));
      await h.reopen();
      expect(valueOf(await h.store.readiness()).storage_epoch).toBe('2');
      expect(valueOf(await h.store.commitPending(input))).toEqual(original);
      expect(valueOf(await h.store.readCaptureIdempotency!({ candidate_id: 'candidate-1' }))).toEqual(proof);
      expect(valueOf(await h.store.readJournal({ after: '0', limit: 10 }))).toHaveLength(1);
    });
    scenario('immutable-boundaries-v1/bounded-journal: should exhaust bounded pages without duplicates', async (h) => {
      for (const id of ['candidate-1', 'candidate-2', 'candidate-3']) valueOf(await h.store.commitPending(pendingCapture(id)));
      let after = '0'; const cursors: string[] = [];
      for (;;) {
        const page = JSON.parse((await h.handle.query('memory-journal-page', memoryJcs({ after, limit: 1 }), h.binding.memoryGrant)).data);
        expect(page.length).toBeLessThanOrEqual(1);
        if (!page.length) break;
        after = JSON.parse(page[0].value.data).cursor;
        cursors.push(after);
      }
      expect(cursors).toEqual(['1', '2', '3']);
      await expect(h.handle.query('memory-journal-page', memoryJcs({ after: '0', limit: 2001 }), h.binding.memoryGrant))
        .rejects.toMatchObject({ code: 'invalid-schema' });
    });
    for (const decision of ['accept', 'reject'] as const) scenario(`immutable-chains-v1/destruction-replay/${decision}: should retain K7 and K8 after admission destroys the envelope`, async (h) => {
      const host = memoryEngine(h, decision);
      const captured = valueOf(await host.engine.capture(memoryCaptureRequest()));
      expect(captured.status).toBe('committed_pending');
      const candidate = { candidate_id: captured.candidate_id! };
      const captureProof = valueOf(await h.store.readCaptureIdempotency!(candidate));
      expect(captureProof.record_digest).toBeDefined();
      const admitted = valueOf(await host.engine.requestAdmission({ ...candidate,
        authorization: { credential: 'credential-memory' }, deadline_at: DEADLINE }));
      expect(admitted.status).toBe(decision === 'accept' ? 'accepted' : 'rejected');
      expect(host.destroyed).toBe(1);
      expect(host.plaintextCount).toBe(0);
      expect(await h.store.readPending({ ...candidate, authorization_receipt_digest: DIGEST }))
        .toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
      const first = valueOf(await h.store.readAdmissionOutcome!(candidate));
      const outcomeKey = JSON.stringify(['memory-admission-outcome-v1', candidate.candidate_id]);
      const storedOutcome = (await h.handle.readAggregate('memory-admission-outcomes', outcomeKey, h.binding.memoryGrant))!;
      await expect(h.handle.transact({ grant: h.binding.memoryGrant, fence: h.fence,
        limits: { maxAppends: 1, maxRecords: 8, maxEncodedBytes: 1048576 } }, (tx) => tx.apply({
        intentHash: 'tampered-admission', guards: [], records: [], appends: [], indexWrites: [], relationships: [], barriers: [], purgeIntents: [],
        updates: [{ ...storedOutcome, version: (BigInt(storedOutcome.version) + 1n).toString(),
          value: memoryJcs({ ...JSON.parse(storedOutcome.value.data), transaction_receipt_digest: `sha256:${'b'.repeat(64)}` }) }],
      }))).rejects.toMatchObject({ code: 'invalid-schema', message: expect.stringContaining('admission first proof is immutable') });
      expect(await h.handle.readAggregate('memory-admission-outcomes', outcomeKey, h.binding.memoryGrant)).toEqual(storedOutcome);
      const replayCapture = valueOf(await host.engine.capture(memoryCaptureRequest()));
      expect(replayCapture).toMatchObject({ status: 'duplicate_exact', candidate_id: captured.candidate_id,
        transaction_receipt_digest: captured.transaction_receipt_digest });
      expect(valueOf(await host.engine.requestAdmission({ ...candidate,
        authorization: { credential: 'credential-memory' }, deadline_at: DEADLINE }))).toEqual(admitted);
      expect(host.destroyed).toBe(1);
      const journal = valueOf(await h.store.readJournal({ after: '0', limit: 10 }));
      expect(journal).toHaveLength(2);
      const original = await h.handle.readCommitResult!(journal.at(-1)!.event_id, h.binding.memoryGrant);
      expect(JSON.parse(original!.data).receipt_digest).toBe(admitted.transaction_receipt_digest);
      if (decision === 'accept') {
        const record = valueOf(await h.store.readRecord({ record_id: first.record_id!, system_as_of: '2', authorization_receipt_digest: DIGEST }));
        expect(record.scope_ref).toBe('memory-stage-b-scope');
      }
      await h.reopen();
      expect(valueOf(await h.store.readCaptureIdempotency!(candidate))).toEqual(captureProof);
      expect(valueOf(await h.store.readAdmissionOutcome!(candidate))).toEqual(first);
      expect(await h.handle.readCommitResult!(journal.at(-1)!.event_id, h.binding.memoryGrant)).toEqual(original);
      expect(valueOf(await h.store.readJournal({ after: '0', limit: 10 }))).toEqual(journal);
      const restarted = memoryEngine(h, decision);
      expect(valueOf(await restarted.engine.capture(memoryCaptureRequest()))).toEqual(replayCapture);
      expect(valueOf(await restarted.engine.requestAdmission({ ...candidate,
        authorization: { credential: 'credential-memory' }, deadline_at: DEADLINE }))).toEqual(admitted);
      expect(restarted.destroyed).toBe(0);
      expect(valueOf(await h.store.readJournal({ after: '0', limit: 10 }))).toEqual(journal);
    });
    scenario('scope-outbox-v1/checkpoint-resync-snapshot: should retain a host snapshot while memory advances', async (h) => {
      valueOf(await h.store.commitPending(pendingCapture()));
      const maintained = await h.kernel.bind(h.binding.maintainGrant);
      const fence = await maintained.journalFence();
      expect(await h.maintenance.checkFence(fence)).toEqual(fence);
      await expect(h.maintenance.checkFence({ ...fence, epoch: '999' })).rejects.toMatchObject({ code: 'denied' });
      const captured = await h.maintenance.resync('stage-b-snapshot', fence);
      valueOf(await h.store.commitPending(pendingCapture('candidate-2')));
      const snapshot = await h.maintenance.snapshot(captured.snapshotRoot, 0, 1);
      expect(snapshot.rows).toHaveLength(1);
      expect(snapshot.rows[0]).toMatchObject({ chainId: 'memory-journal', allocation: '1' });
      await h.maintenance.checkpoint('stage-b-snapshot', '0', captured.journalSeq, fence);
      await expect(h.maintenance.checkpoint('stage-b-snapshot', '0', captured.journalSeq, fence))
        .rejects.toMatchObject({ code: 'cas-conflict' });
      const memory = await h.kernel.bind(h.binding.memoryGrant);
      await expect(memory.journalFence()).rejects.toMatchObject({ code: 'denied' });
      await expect(memory.journalCheckpoint('stage-b-snapshot', '0', '1', fence)).rejects.toMatchObject({ code: 'denied' });
      await expect(memory.journalResync('forbidden', fence)).rejects.toMatchObject({ code: 'denied' });
      await expect(memory.snapshotRead(captured.snapshotRoot, 0, 1)).rejects.toMatchObject({ code: 'denied' });
    });
    scenario('scope-outbox-v1/poison-retry: should refuse checkpoints until the poisoned event is redelivered', async (h) => {
      valueOf(await h.store.commitPending(pendingCapture()));
      const fence = await (await h.kernel.bind(h.binding.maintainGrant)).journalFence();
      const delivery = await h.hostReplay('0', 1, 'stage-b-poison');
      expect(delivery.events).toHaveLength(1);
      const event = delivery.events[0]!;
      await h.maintenance.poison('stage-b-poison', event.eventId, 'decode failure');
      await expect(h.maintenance.checkpoint('stage-b-poison', '0', event.seq, fence)).rejects.toMatchObject({ code: 'invalid-command' });
      await h.maintenance.retry('stage-b-poison', event.eventId, fence);
      await expect(h.maintenance.checkpoint('stage-b-poison', '0', event.seq, fence)).rejects.toMatchObject({ code: 'invalid-command' });
      expect((await h.hostReplay('0', 1, 'stage-b-poison')).events).toEqual(delivery.events);
      await h.maintenance.checkpoint('stage-b-poison', '0', event.seq, fence);
      expect(await (await h.kernel.bind(h.binding.memoryGrant)).journalInspect('stage-b-poison')).toMatchObject({ cursor: event.seq, lag: '0' });
    });
    scenario('scope-outbox-v1/authority-refusals: should refuse absent foreign and revoked host authority independently', async (h) => {
      expect(() => openMemoryMaintenance(undefined!, undefined!)).toThrow(/assembled binding/);
      expect(() => assembleMemoryHostBinding({ driver: h.binding.provider, maintainGrant: undefined, invocationId: 'inv' })).toThrow(/maintain grant/);
      const foreign = assembleMemoryHostBinding({ driver: h.binding.provider, maintainGrant: memoryMaintainGrant('foreign'), invocationId: 'foreign', storeId: h.scopeBinding.store_id });
      await h.kernel.bindNew(foreign.maintainGrant);
      await expect(verifyHostBinding(h.kernel, foreign, h.scopeBinding.scope)).rejects.toMatchObject({ code: 'denied' });
      const neverIssued = assembleMemoryHostBinding({ driver: h.binding.provider,
        maintainGrant: { ...h.binding.maintainGrant, token: 'never-issued' }, invocationId: 'unknown', storeId: h.scopeBinding.store_id });
      await expect(verifyHostBinding(h.kernel, neverIssued, h.scopeBinding.scope)).rejects.toMatchObject({ code: 'denied' });
      const fence = await (await h.kernel.bind(h.binding.maintainGrant)).journalFence();
      await h.kernel.revoke(h.binding.maintainGrant.token);
      for (const operation of [
        () => h.maintenance.checkFence(fence), () => h.maintenance.resync('revoked', fence),
        () => h.maintenance.checkpoint('revoked', '0', '0', fence), () => h.maintenance.snapshot('unknown', 0, 1),
        () => h.hostReplay('0', 1, 'revoked'),
        () => h.maintenance.poison('revoked', 'unknown', 'reason'), () => h.maintenance.retry('revoked', null, fence),
      ]) await expect(operation()).rejects.toMatchObject({ code: 'denied' });
      // The independent read/write authority remains valid.
      expect(valueOf(await h.store.readiness()).storage_epoch).toBe('1');
    });
    scenario('fenced-writers-v1/C7: should deny unknown foreign and copied candidate authority before effects', async (h) => {
      const host = memoryEngine(h);
      expect(await h.store.commitPending(pendingCapture('unknown'))).toMatchObject({ ok: false, error: { code: 'UNAUTHORIZED' } });
      const before = h.units.length;
      expect(await host.engine.capture(memoryCaptureRequest('2', 'foreign-scope'))).toMatchObject({ ok: false, error: { code: 'UNAUTHORIZED' } });
      host.enter(null);
      expect(await host.engine.capture(memoryCaptureRequest('3'))).toMatchObject({ ok: false, error: { code: 'UNAUTHORIZED' } });
      expect(h.units).toHaveLength(before);
      host.enter(host.original);
      const captured = valueOf(await host.engine.capture(memoryCaptureRequest()));
      const count = h.units.length;
      for (const invocation of [{ ...host.original }, { ...host.original, invocationId: 'foreign-invocation' }]) {
        host.enter(invocation);
        expect(await host.engine.requestAdmission({ candidate_id: captured.candidate_id!,
          authorization: { credential: 'credential-memory' }, deadline_at: DEADLINE })).toMatchObject({ ok: false, error: { code: 'UNAUTHORIZED' } });
      }
      expect(h.units).toHaveLength(count);
    });
    scenario('fenced-writers-v1/two-process: should refuse a separate live opener without superseding its owner', async (h) => {
      const peer = await memoryPeer(h.pg.name, 'open');
      expect(peer.code).toBe(3);
      expect(JSON.parse(peer.output)).toMatchObject({ ok: false, code: 'instance-busy' });
      expect(valueOf(await h.store.readiness()).storage_epoch).toBe('1');
      valueOf(await h.store.commitPending(pendingCapture()));
    });
    for (const phase of ['crash-before', 'crash-after']) scenario(`atomic-units-v1/${phase}: should recover one original result after an actual SIGKILL`, async (h) => {
      valueOf(await h.store.close());
      const peer = await memoryPeer(h.pg.name, phase);
      expect(peer.signal).toBe('SIGKILL');
      await awaitDeadLease(h);
      await h.reopen();
      const journal = valueOf(await h.store.readJournal({ after: '0', limit: 10 }));
      if (phase === 'crash-before') {
        expect(journal).toEqual([]);
        expect(await h.handle.readCommitResult!('capture-candidate-crash', h.binding.memoryGrant)).toBeNull();
        expect(valueOf(await h.store.commitPending(pendingCapture())).cursor).toBe('1');
      } else {
        expect(journal).toHaveLength(1);
        const original = valueOf(JSON.parse(peer.output));
        const stored = await h.handle.readCommitResult!('capture-candidate-crash', h.binding.memoryGrant);
        expect(JSON.parse(stored!.data)).toEqual(original);
        expect(valueOf(await h.store.readCaptureIdempotency!({ candidate_id: 'candidate-crash' }))).toMatchObject({ created_cursor: '1' });
        expect(valueOf(await h.store.readiness()).storage_epoch).toBe('3');
        expect(valueOf(await h.store.readJournal({ after: '0', limit: 10 }))).toEqual(journal);
      }
    });
  });
};
