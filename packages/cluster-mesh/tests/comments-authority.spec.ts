import { describe, expect, it } from 'vitest';
import { createAnnotationRevision, commandIdempotencyKey } from '@sentropic/comments';
import { createPgFixture } from './storage/pg-fixture.js';
import { pgEnabled } from './storage/pg-driver.js';
import { grantFor } from './storage/authority-corpus.js';
import { createCommentsModule, createCommentsPostgresRegistration } from '../src/comments/index.js';
import { conformanceCapacity, conformanceScope, conformanceTarget, conformanceResource, conformanceBody, conformanceProvenance } from '../assets/storage/comments/oracle/conformance.mjs';
describe.skipIf(!pgEnabled)('comments domain authority at publication', () => {
  it('rolls back prepared lifecycle effects when the final domain check denies', async () => {
    const scope = conformanceScope(); let calls = 0;
    const services = { capacity: conformanceCapacity(), capabilities: { check: async () => ++calls === 1 }, resolver: { resolve: async () => 'exact' as const }, clock: { now: () => 1234 } };
    const fixture = await createPgFixture(await createCommentsPostgresRegistration({ services }));
    try {
      const root = await fixture.open(); const grant = grantFor({ scope }); await root.bindNew(grant);
      const module = createCommentsModule({ storage: root.adapter(), capacity: conformanceCapacity() });
      await module.withContext(grant, async () => {
        const record = createAnnotationRevision(null, { scope, annotationId: 'a', primary: conformanceTarget(conformanceResource(scope)), secondary: [], visualAnchors: [], body: conformanceBody('available'), provenance: conformanceProvenance() }, conformanceCapacity());
        await module.store.appendAnnotationRevision(scope, 'a', record, { kind: 'creation', aggregateVersion: 0 });
        await expect(module.services.lifecycle({ scope, objectKind: 'annotation', objectId: 'a', action: 'tombstone', archiveKind: null, reason: null, decisionRef: '', idempotencyKey: commandIdempotencyKey('delete'), expected: { kind: 'creation', aggregateVersion: 0 } })).rejects.toMatchObject({ code: 'denied' });
        expect(calls).toBe(2); expect((await module.store.getAnnotationHead(scope, 'a'))?.hash).toBe(record.hash);
        expect(await module.store.getLifecycleChain(scope, 'annotation', 'a')).toEqual([]);
        expect(await module.store.findCommittedCommand(scope, commandIdempotencyKey('delete'))).toBeNull();
      });
    } finally { await fixture.close(); }
  });
  it('tombstones without purge authority and admits a later independently authorized intention', async () => {
    const scope = conformanceScope(); let purge = false;
    const services = { capacity: conformanceCapacity(), capabilities: { check: async (_principal, capability) => capability !== 'purge' || purge }, resolver: { resolve: async () => 'exact' as const }, clock: { now: () => 1234 } };
    const fixture = await createPgFixture(await createCommentsPostgresRegistration({ services }));
    try {
      const root = await fixture.open(); const grant = grantFor({ scope, operations: ['read', 'write', 'maintain'] }); const bound = await root.bindNew(grant); await bound.configureLifecycle('required');
      const module = createCommentsModule({ storage: root.adapter(), capacity: conformanceCapacity() });
      await module.withContext(grant, async () => {
        const record = createAnnotationRevision(null, { scope, annotationId: 'a', primary: conformanceTarget(conformanceResource(scope)), secondary: [], visualAnchors: [], body: conformanceBody('sensitive'), provenance: conformanceProvenance() }, conformanceCapacity());
        await module.store.appendAnnotationRevision(scope, 'a', record, { kind: 'creation', aggregateVersion: 0 });
        const base = { scope, objectKind: 'annotation' as const, objectId: 'a', archiveKind: null, reason: null, decisionRef: '' };
        const deleted = await module.services.lifecycle({ ...base, action: 'tombstone', idempotencyKey: commandIdempotencyKey('delete'), expected: { kind: 'creation', aggregateVersion: 0 } });
        expect(deleted.intentId).toBeNull();
        await expect(module.store.getAnnotationHead(scope, 'a')).rejects.toMatchObject({ code: 'denied' });
        purge = true;
        const intention = await module.services.lifecycle({ ...base, action: 'purge-intent', idempotencyKey: commandIdempotencyKey('purge'), expected: { kind: 'revision', revisionHash: deleted.hash } });
        expect(intention.intentId).toBeTypeOf('string'); expect((await module.services.completePurge(intention.intentId!)).state).toBe('complete');
      });
    } finally { await fixture.close(); }
  });
});
