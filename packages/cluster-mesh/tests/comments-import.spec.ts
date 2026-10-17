import { describe, expect, it } from 'vitest';
import { createAnnotationRevision, createLifecycleEvent, hashRecord, commandIdempotencyKey, commandPayloadDigest } from '@sentropic/comments';
import type { CanonicalChainRecord } from '@sentropic/comments';
import { createPgFixture } from './storage/pg-fixture.js';
import { pgEnabled } from './storage/pg-driver.js';
import { grantFor } from './storage/authority-corpus.js';
import { createCommentsModule, createCommentsPostgresRegistration } from '../src/comments/index.js';
import { createCommentsFragment, commentsUnitPayloadDigest } from '../src/comments/fragment-codec.js';
import { commentsImportBindingDigest, commentsAdmissibleManifestDigest } from '../src/comments/binding-codec.js';
import { conformanceCapacity, conformanceScope, conformanceTarget, conformanceResource, conformanceBody, conformanceProvenance } from '../assets/storage/comments/oracle/conformance.mjs';
const scenario = async (tombstone = false, transform: (records: CanonicalChainRecord[]) => CanonicalChainRecord[] = (records) => records) => {
  const scope = conformanceScope(); const capacity = conformanceCapacity();
  const input = { scope, annotationId: 'a', primary: conformanceTarget(conformanceResource(scope)), secondary: [], visualAnchors: [], body: conformanceBody('first'), provenance: conformanceProvenance() };
  const first = createAnnotationRevision(null, input, capacity); const second = createAnnotationRevision(first, { ...input, body: conformanceBody('second') }, capacity);
  const records = transform(tombstone ? [first, createLifecycleEvent([], { scope, objectKind: 'annotation', objectId: 'a', action: 'tombstone', archiveKind: null, reason: null, actor: { principal: 'historical-admin' } }, capacity)] : [first, second]);
  const unitId = 'source-unit'; const payloadDigest = commentsUnitPayloadDigest(unitId, records);
  const units = [{ unitId, unitKind: 'annotation' as const, dependsOnUnitIds: [], manifestDigest: commandPayloadDigest({ unitId }), payloadDigest }];
  const envelope = { scope, importId: 'manifest', sourceUnitCount: 1, admissibleManifestDigest: commentsAdmissibleManifestDigest(units), mappingVersion: 'mapping-v1' };
  const request = { scope, batchId: 'batch', manifest: { kind: 'import-manifest' as const, ...envelope, hash: hashRecord('import-manifest', envelope) }, units, expectedMappingVersion: 'mapping-v1', idempotencyKey: commandIdempotencyKey('batch') };
  const binding = { version: 'comments-transport-v1' as const, operationId: 'operation', request, unitIds: [unitId], sourceBoundary: 'frozen-source', targets: [conformanceResource(scope)], capabilities: ['revise' as const, 'tombstone' as const] };
  const bindingDigest = commentsImportBindingDigest(binding);
  const authority = { allowed: true };
  const services = { capacity, capabilities: { check: async () => authority.allowed }, resolver: { resolve: async () => 'exact' as const }, clock: { now: () => 1717000000123 } };
  const fixture = await createPgFixture(await createCommentsPostgresRegistration({ services }));
  const root = await fixture.open(); const grant = grantFor({ scope, operations: ['read', 'write', 'maintain'] }); const bound = await root.bindNew(grant);
  const fence = { fenceId: 'import', epoch: '1' }; await root.provisionFence(grant, fence);
  const module = createCommentsModule({ storage: root.adapter(), capacity });
  const fragment = (ordinal: number, predecessorHash: string | null, payload = records.slice(ordinal, ordinal + 1)) => createCommentsFragment({ scope, operationId: binding.operationId, bindingDigest, unitId, ordinal: String(ordinal), predecessorHash, terminal: null }, payload);
  const terminal = (ordinal: number, predecessorHash: string) => createCommentsFragment({ scope, operationId: binding.operationId, bindingDigest, unitId: null, ordinal: String(ordinal), predecessorHash,
    terminal: { fragmentCount: String(ordinal + 1), unitRoots: [{ unitId, records: String(records.length), payloadDigest }] } }, []);
  return { fixture, root, grant, bound, module, scope, records, request, binding, bindingDigest, fence, fragment, terminal, authority };
};
const prepareAll = async (s: Awaited<ReturnType<typeof scenario>>) => {
  const first = s.fragment(0, null); await s.module.services.prepareImportFragment({ binding: s.binding, fragment: first, fence: s.fence });
  const second = s.fragment(1, first.digest); await s.module.services.prepareImportFragment({ binding: s.binding, fragment: second, fence: s.fence });
  return (await s.module.services.prepareImportFragment({ binding: s.binding, fragment: s.terminal(2, second.digest), fence: s.fence })).prepared!;
};
const commitAll = async (s: Awaited<ReturnType<typeof scenario>>, prepared: Awaited<ReturnType<typeof prepareAll>>) => {
  for (let step = 0; step < 100; step++) {
    const result = await s.module.services.commitPreparedImport({ request: s.request, prepared, fence: s.fence, limits: { maxRecords: 2, maxAppends: 1, maxEncodedBytes: 8192 } });
    if (result.state === 'committed') return result.receipt;
  }
  throw new Error('bounded preparation did not advance');
};
describe.skipIf(!pgEnabled)('coherent comments import and complete receipt recovery', () => {
  it.each([false, true])('publishes history/receipts and imported tombstone coverage together (tombstone=%s)', async (tombstone) => {
    const s = await scenario(tombstone);
    try {
      await s.module.withContext(s.grant, async () => {
        const first = s.fragment(0, null); const ack = await s.module.services.prepareImportFragment({ binding: s.binding, fragment: first, fence: s.fence });
        expect(await s.module.services.prepareImportFragment({ binding: s.binding, fragment: first, fence: s.fence })).toEqual(ack);
        expect(await s.module.store.getAnnotationHead(s.scope, 'a')).toBeNull();
        expect((await s.bound.query('scope-chain-index', {}, { limit: 100 })).records).toHaveLength(0);
        const second = s.fragment(1, first.digest); await s.module.services.prepareImportFragment({ binding: s.binding, fragment: second, fence: s.fence });
        const final = await s.module.services.prepareImportFragment({ binding: s.binding, fragment: s.terminal(2, second.digest), fence: s.fence });
        expect(final.prepared).not.toBeNull(); let result;
        for (let step = 0; step < 100; step++) {
          result = await s.module.services.commitPreparedImport({ request: s.request, prepared: final.prepared!, fence: s.fence, limits: { maxRecords: 2, maxAppends: 1, maxEncodedBytes: 8192 } });
          if (result.state === 'committed') break;
          expect(result.work.items).toBeLessThanOrEqual(2); expect(await s.module.store.getAnnotationHead(s.scope, 'a')).toBeNull();
        }
        expect(result.state).toBe('committed'); const receipt = result.receipt;
        expect(receipt.canonical.unitOutcomes[0]).toMatchObject({ outcome: 'committed', unitId: 'source-unit', receipt: { manifestHash: s.request.manifest.hash, issuedAt: 1717000000123 } });
        const reopened = createCommentsModule({ storage: (await s.fixture.open()).adapter(), capacity: conformanceCapacity() });
        expect(await reopened.withContext(s.grant, () => reopened.services.recoverBatchReceipts({ scope: s.scope, batchId: 'batch', manifestHash: s.request.manifest.hash }))).toEqual([receipt]);
        if (tombstone) {
          await expect(s.module.store.getAnnotationHead(s.scope, 'a')).rejects.toMatchObject({ code: 'denied' });
          expect((await s.module.store.readChainPage(s.scope, { kind: 'annotation-revisions', annotationId: 'a' }, { limit: 100, cursor: null })).outcome).toBe('inaccessible');
        } else expect((await s.module.store.getAnnotationChain(s.scope, 'a')).map((record) => record.hash)).toEqual(s.records.map((record) => record.hash));
        expect((await s.bound.journalRead(0, 100)).events).toHaveLength(1);
      });
    } finally { await s.fixture.close(); }
  });
  it('refuses a truncated terminal payload root without canonical visibility', async () => {
    const s = await scenario();
    try {
      await s.module.withContext(s.grant, async () => {
        const first = s.fragment(0, null); await s.module.services.prepareImportFragment({ binding: s.binding, fragment: first, fence: s.fence });
        await expect(s.module.services.prepareImportFragment({ binding: s.binding, fragment: s.terminal(1, first.digest), fence: s.fence }))
          .rejects.toMatchObject({ condition: 'incomplete', code: 'unavailable' });
        expect(await s.module.store.getAnnotationHead(s.scope, 'a')).toBeNull();
      });
    } finally { await s.fixture.close(); }
  });
  it('refuses a self-consistent hash with a false canonical sequence before publication', async () => {
    const s = await scenario(false, (records) => {
      let previousHash: string | null = null;
      return records.map((record, index) => {
        if (!('link' in record)) return record;
        const { kind, hash: _hash, ...envelope } = record; const changed = { ...envelope, link: { previousHash, sequence: index + 7 } };
        previousHash = hashRecord(kind, changed);
        return { kind, ...changed, hash: previousHash } as CanonicalChainRecord;
      });
    });
    try {
      await s.module.withContext(s.grant, async () => {
        const prepared = await prepareAll(s);
        await expect(commitAll(s, prepared)).rejects.toMatchObject({ condition: 'conflict', code: 'idempotency-conflict' });
        expect(await s.module.store.getAnnotationHead(s.scope, 'a')).toBeNull();
      });
    } finally { await s.fixture.close(); }
  });
  it('refuses records outside the authorized resource inventory', async () => {
    const s = await scenario();
    try {
      await s.module.withContext(s.grant, async () => {
        const binding = { ...s.binding, targets: [{ ...s.binding.targets[0], id: 'different-authorized-resource' }] };
        const bindingDigest = commentsImportBindingDigest(binding);
        const fragment = createCommentsFragment({ ...s.fragment(0, null).manifest, bindingDigest }, [s.records[0]]);
        await expect(s.module.services.prepareImportFragment({ binding, fragment, fence: s.fence }))
          .rejects.toMatchObject({ condition: 'denied', code: 'denied' });
        expect(await s.module.store.getAnnotationHead(s.scope, 'a')).toBeNull();
      });
    } finally { await s.fixture.close(); }
  });
  it('rechecks domain authority after the terminal fragment and before every bounded step', async () => {
    const s = await scenario();
    try {
      await s.module.withContext(s.grant, async () => {
        const prepared = await prepareAll(s); s.authority.allowed = false;
        await expect(commitAll(s, prepared)).rejects.toMatchObject({ code: 'denied' });
        expect(await s.module.store.getAnnotationHead(s.scope, 'a')).toBeNull();
      });
    } finally { await s.fixture.close(); }
  });
});
