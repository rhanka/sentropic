// Shared lifecycle corpus (L3a v4.1 frozen §10, §16.1): tombstone/purge
// separation, conditional intent atomicity, unconfigured denial, holds,
// shared objects and crash-safe completion. Backend-agnostic: typed codes and
// progress states only, never messages.

import assert from 'node:assert/strict';
import { expectCode, type Awaitable } from './atomic-corpus.js';
import type { AtomicUnit } from '../../src/storage/atomic.js';

export type LifecyclePurgePolicy = 'unconfigured' | 'optional' | 'required';
export interface LifecyclePurgeView {
  readonly state: 'pending' | 'held' | 'complete' | 'failed';
  readonly outcomeId: string | null;
  readonly payloadDisposition: 'retained' | 'erased' | null;
}
export interface LifecyclePurgeEvidence {
  readonly outcomes: readonly { readonly intentId: string; readonly outcomeId: string }[];
  readonly notifications: readonly { readonly intentId: string; readonly outcomeId: string }[];
}

export interface LifecycleCorpusStore {
  appendChain(chainId: string, record: { readonly id: string; readonly bytes: string; readonly hash: string }, expectation: { readonly kind: 'absent'; readonly allocation: string } | { readonly kind: 'head'; readonly hash: string }): Awaitable<{ readonly seq: number; readonly hash: string; readonly replayed: boolean }>;
  readHead(chainId: string): Awaitable<string | null>;
  readRecord(key: string): Awaitable<unknown>;
  readAggregate(key: string): Awaitable<unknown>;
  commitAtomic(unit: AtomicUnit): Awaitable<{ readonly commitId: string }>;
  configureLifecycle(policy: LifecyclePurgePolicy): Awaitable<void>;
  declareCoverage(parent: string, child: string): Awaitable<void>;
  purgeProgress(intentId: string): Awaitable<LifecyclePurgeView>;
  purgeJobIds(): Awaitable<readonly string[]>;
  holdTarget(target: string, reason: string): Awaitable<void>;
  releaseHold(target: string): Awaitable<void>;
  completePurge(intentId: string): Awaitable<LifecyclePurgeView>;
  purgeEvidence(): Awaitable<LifecyclePurgeEvidence>;
  armPurgeFailure(): Awaitable<void>;
  armPurgeResponseFailure(): Awaitable<void>;
  shareBlob(blobId: string, owner: string, bytes: string): Awaitable<void>;
  releaseBlob(blobId: string, owner: string): Awaitable<void>;
  readBlob(blobId: string): Awaitable<string | null>;
}

export interface LifecycleCorpusHooks {
  readonly expectedRecordDisposition?: 'retained' | 'erased';
  rebind(): Awaitable<LifecycleCorpusStore>;
  bindWithoutMaintain(): Awaitable<LifecycleCorpusStore>;
}

const emptyUnit = (): AtomicUnit => ({
  guards: [],
  records: [],
  appends: [],
  updates: [],
  relationships: [],
  barriers: [],
  purgeIntents: [],
  indexWrites: [],
});

const lifecycleAppend = (chainId: string, id: string, hash: string) => ({
  chainId,
  record: { id, bytes: `{"lifecycle":"${id}"}`, hash },
  expectation: { kind: 'absent', allocation: '0' } as const,
});

export const runLifecycleCorpus = async (bound: LifecycleCorpusStore, hooks: LifecycleCorpusHooks): Promise<void> => {
  await bound.configureLifecycle('optional');
  await expectCode(() => bound.commitAtomic({ ...emptyUnit(), appends: [lifecycleAppend('life-forged', 'forged', 'forged-hash')],
    purgeIntents: [{ target: 'life-thread-1', intentId: 'forged-intent', authorizedBy: 'another-principal' }],
  }), 'denied', 'C14: a purge intent cannot forge its verified authorizer');
  assert.equal(await bound.readHead('life-forged'), null, 'C14: a forged purge authorizer publishes no carrier');
  await bound.commitAtomic({
    ...emptyUnit(),
    appends: [lifecycleAppend('life-optional', 'tomb-1', 'hash-tomb-1')],
    barriers: [{ boundary: 'life-thread-1', reason: 'tombstone-1' }],
  });
  assert.deepEqual(
    await bound.purgeJobIds(),
    [],
    'K2b-RED lifecycle: a tombstone without purge policy invents no intent',
  );

  await bound.configureLifecycle('required');
  await expectCode(
    async () =>
      bound.commitAtomic({
        ...emptyUnit(),
        appends: [lifecycleAppend('life-required', 'tomb-2', 'hash-tomb-2')],
        barriers: [{ boundary: 'life-thread-2', reason: 'tombstone-2' }],
      }),
    'invalid-command',
    'K2b-RED lifecycle: a missing required intent fails the whole transaction',
  );
  assert.equal(await bound.readHead('life-required'), null);
  assert.deepEqual(await bound.purgeJobIds(), []);
  await bound.commitAtomic({
    ...emptyUnit(),
    appends: [lifecycleAppend('life-required', 'tomb-2', 'hash-tomb-2')],
    barriers: [{ boundary: 'life-thread-2', reason: 'tombstone-2' }],
    purgeIntents: [{ target: 'life-thread-2', intentId: 'intent-required-1', authorizedBy: 'user-1' }],
  });
  assert.equal((await bound.purgeProgress('intent-required-1')).state, 'pending');
  await expectCode(
    async () =>
      bound.commitAtomic({
        ...emptyUnit(),
        appends: [lifecycleAppend('life-divergent', 'tomb-div', 'hash-tomb-div')],
        purgeIntents: [{ target: 'other-target', intentId: 'intent-required-1', authorizedBy: 'user-1' }],
      }),
    'idempotency-conflict',
    'K2b-RED lifecycle: a reused purge intent with a divergent target conflicts atomically',
  );
  assert.equal(await bound.readHead('life-divergent'), null);

  await bound.configureLifecycle('unconfigured');
  await expectCode(
    async () =>
      bound.commitAtomic({
        ...emptyUnit(),
        appends: [lifecycleAppend('life-unconfigured', 'tomb-3', 'hash-tomb-3')],
        purgeIntents: [{ target: 'life-thread-3', intentId: 'intent-unconfigured-1', authorizedBy: 'user-1' }],
      }),
    'denied',
    'K2b-RED lifecycle: an unconfigured purge denies intents',
  );

  await bound.configureLifecycle('optional');
  const weak = await hooks.bindWithoutMaintain();
  await expectCode(
    async () =>
      weak.commitAtomic({
        ...emptyUnit(),
        appends: [lifecycleAppend('life-noauth', 'tomb-noauth', 'hash-tomb-noauth')],
        purgeIntents: [{ target: 'held-target', intentId: 'intent-noauth-1', authorizedBy: 'user-1' }],
      }),
    'denied',
    'K2b-RED lifecycle: a purge intent without purge authority is denied',
  );

  await bound.appendChain('held-target', { id: 'h1', bytes: '{}', hash: 'hash-held-1' }, { kind: 'absent', allocation: '0' });
  await bound.commitAtomic({
    ...emptyUnit(),
    appends: [lifecycleAppend('life-held', 'tomb-4', 'hash-tomb-4')],
    purgeIntents: [{ target: 'held-target', intentId: 'intent-held-1', authorizedBy: 'user-1' }],
  });
  await bound.holdTarget('held-target', 'legal-hold-1');
  const held = await bound.completePurge('intent-held-1');
  assert.equal(held.state, 'held', 'K2b-RED lifecycle: a held target stalls completion');
  assert.equal(held.outcomeId, null);
  assert.equal((await bound.purgeProgress('intent-held-1')).state, 'held');
  await bound.releaseHold('held-target');
  const done = await bound.completePurge('intent-held-1');
  assert.equal(done.state, 'complete');
  assert.ok(done.outcomeId);
  await expectCode(
    async () => bound.readHead('held-target'),
    'denied',
    'K2b-RED lifecycle: completion leaves physical-disposal evidence on reads',
  );
  const again = await bound.completePurge('intent-held-1');
  assert.equal(
    again.outcomeId,
    done.outcomeId,
    'K2b-RED lifecycle: completion carries exactly one operational outcome',
  );
  const heldRebound = await hooks.rebind();
  const heldRecovered = await heldRebound.purgeProgress('intent-held-1');
  assert.equal(heldRecovered.state, 'complete');
  assert.equal(
    heldRecovered.outcomeId,
    done.outcomeId,
    'K2b-RED lifecycle: disposal and outcome survive restart with the same outcome',
  );
  await expectCode(
    async () => heldRebound.readHead('held-target'),
    'denied',
    'K2b-RED lifecycle: disposal evidence survives restart',
  );

  await bound.commitAtomic({
    ...emptyUnit(),
    appends: [lifecycleAppend('life-ghost', 'tomb-5', 'hash-tomb-5')],
    purgeIntents: [{ target: 'ghost-9', intentId: 'intent-ghost-1', authorizedBy: 'user-1' }],
  });
  const ghost = await bound.completePurge('intent-ghost-1');
  assert.equal(ghost.state, 'failed');
  assert.equal(ghost.outcomeId, null);

  await bound.shareBlob('blob-1', 'owner-a', 'bytes-1');
  await bound.shareBlob('blob-1', 'owner-b', 'bytes-1');
  assert.equal(await bound.readBlob('blob-1'), 'bytes-1');
  await bound.releaseBlob('blob-1', 'owner-a');
  assert.equal(
    await bound.readBlob('blob-1'),
    'bytes-1',
    'K2b-RED lifecycle: releasing one reference keeps a shared object available',
  );
  await bound.releaseBlob('blob-1', 'owner-b');
  assert.equal(await bound.readBlob('blob-1'), null);
  await bound.shareBlob('blob-2', 'owner-a', 'bytes-x');
  await expectCode(
    async () => bound.shareBlob('blob-2', 'owner-b', 'bytes-y'),
    'idempotency-conflict',
    'K2b-RED lifecycle: shared bytes under one identity conflict when divergent',
  );

  await bound.shareBlob('blob-covered', 'owner-a', 'bytes-c');
  await bound.declareCoverage('life-thread-1', 'blob-covered');
  await expectCode(
    async () => bound.readBlob('blob-covered'),
    'denied',
    'K2b-RED lifecycle: a covered shared object throws denied',
  );

  await bound.appendChain('crash-target', { id: 'x1', bytes: '{}', hash: 'hash-crash-1' }, { kind: 'absent', allocation: '0' });
  await bound.commitAtomic({
    ...emptyUnit(),
    appends: [lifecycleAppend('life-crash', 'tomb-6', 'hash-tomb-6')],
    purgeIntents: [{ target: 'crash-target', intentId: 'intent-crash-1', authorizedBy: 'user-1' }],
  });
  const crashed = await bound.completePurge('intent-crash-1');
  assert.equal(crashed.state, 'complete');
  const rebound = await hooks.rebind();
  const recovered = await rebound.purgeProgress('intent-crash-1');
  assert.equal(recovered.state, 'complete');
  assert.equal(
    recovered.outcomeId,
    crashed.outcomeId,
    'K2b-RED lifecycle: completion survives a handle restart with the same outcome',
  );
  const repeated = await rebound.completePurge('intent-crash-1');
  assert.equal(repeated.outcomeId, crashed.outcomeId);
  await expectCode(
    async () => rebound.readHead('crash-target'),
    'denied',
    'K2b-RED lifecycle: completion survives restart with disposal evidence intact',
  );

  await bound.commitAtomic({
    ...emptyUnit(),
    records: [{ key: 'rec-purge-1', bytes: { format: 'utf8', data: 'gone' }, contentHash: 'h-rec-1' }],
    updates: [{ key: 'agg-purge-1', version: 1, value: { format: 'utf8', data: 'aggregate-bytes' } }],
  });
  await bound.commitAtomic({
    ...emptyUnit(),
    appends: [lifecycleAppend('life-rec', 'tomb-rec', 'hash-tomb-rec')],
    purgeIntents: [
      { target: 'rec-purge-1', intentId: 'intent-rec-1', authorizedBy: 'user-1' },
      { target: 'agg-purge-1', intentId: 'intent-agg-1', authorizedBy: 'user-1' },
    ],
  });
  const recJobsBefore = (await bound.purgeJobIds()).length;
  assert.equal((await bound.completePurge('intent-rec-1')).state, 'complete');
  assert.equal((await bound.completePurge('intent-agg-1')).state, 'complete');
  assert.equal((await bound.purgeProgress('intent-rec-1')).payloadDisposition, hooks.expectedRecordDisposition ?? 'retained', hooks.expectedRecordDisposition === 'erased' ? 'C14: record disposition matches the qualified backend' : 'C14: a hidden retained record cannot claim physical erasure');
  assert.equal((await bound.purgeProgress('intent-agg-1')).payloadDisposition, hooks.expectedRecordDisposition ?? 'retained', hooks.expectedRecordDisposition === 'erased' ? 'C14: aggregate disposition matches the qualified backend' : 'C14: a hidden retained aggregate cannot claim physical erasure');
  await expectCode(async () => bound.readRecord('rec-purge-1'), 'denied', 'K2b-RED lifecycle: purged records deny reads');
  await expectCode(async () => bound.readAggregate('agg-purge-1'), 'denied', 'K2b-RED lifecycle: purged aggregates deny reads');
  assert.equal((await bound.purgeJobIds()).length, recJobsBefore);

  await bound.appendChain('interrupt-target', { id: 'i1', bytes: '{}', hash: 'hash-int-1' }, { kind: 'absent', allocation: '0' });
  await bound.commitAtomic({
    ...emptyUnit(),
    appends: [lifecycleAppend('life-int', 'tomb-int', 'hash-tomb-int')],
    purgeIntents: [{ target: 'interrupt-target', intentId: 'intent-int-1', authorizedBy: 'user-1' }],
  });
  await bound.armPurgeFailure();
  await expectCode(
    async () => bound.completePurge('intent-int-1'),
    'invalid-command',
    'K2b-RED lifecycle: an interruption before the outcome leaves no completion',
  );
  assert.equal((await bound.purgeProgress('intent-int-1')).outcomeId, null);
  const resumed = await bound.completePurge('intent-int-1');
  assert.equal(resumed.state, 'complete');
  const resumedAgain = await bound.completePurge('intent-int-1');
  assert.equal(resumedAgain.outcomeId, resumed.outcomeId);
  await expectCode(async () => bound.readHead('interrupt-target'), 'denied', 'K2b-RED lifecycle: resumed completion disposes exactly once');

  await bound.appendChain('response-target', { id: 'response', bytes: '{}', hash: 'response-hash' }, { kind: 'absent', allocation: '0' });
  await bound.commitAtomic({ ...emptyUnit(), appends: [lifecycleAppend('life-response', 'response-tomb', 'response-tomb-hash')], purgeIntents: [{ target: 'response-target', intentId: 'intent-response', authorizedBy: 'user-1' }] });
  await bound.armPurgeResponseFailure();
  await expectCode(() => bound.completePurge('intent-response'), 'invalid-command', 'C14: completion can commit before its response is interrupted');
  const responseRebound = await hooks.rebind();
  const committed = await responseRebound.purgeProgress('intent-response');
  assert.equal(committed.state, 'complete', 'C14: response interruption preserves committed completion');
  assert.equal((await responseRebound.completePurge('intent-response')).outcomeId, committed.outcomeId);
  const evidence = await responseRebound.purgeEvidence();
  for (const intentId of ['intent-held-1', 'intent-crash-1', 'intent-rec-1', 'intent-agg-1', 'intent-int-1', 'intent-response']) {
    assert.equal(evidence.outcomes.filter((entry) => entry.intentId === intentId).length, 1, `C14: ${intentId} has exactly one canonical outcome`);
    assert.equal(evidence.notifications.filter((entry) => entry.intentId === intentId).length, 1, `C14: ${intentId} has exactly one effective notification`);
  }
};
