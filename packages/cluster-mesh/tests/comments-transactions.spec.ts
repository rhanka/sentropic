import { describe, expect, it } from 'vitest';
import { createAnnotationRevision, commandIdempotencyKey } from '@sentropic/comments';
import { createPgFixture } from './storage/pg-fixture.js';
import { pgEnabled } from './storage/pg-driver.js';
import { grantFor } from './storage/authority-corpus.js';
import { createCommentsModule, createCommentsPostgresRegistration } from '../src/comments/index.js';
import { conformanceCapacity, conformanceScope, conformanceTarget, conformanceResource, conformanceBody, conformanceProvenance } from '../assets/storage/comments/oracle/conformance.mjs';
describe.skipIf(!pgEnabled)('comments transaction lifetime and final domain authorization', () => {
  it('revalidates installed commands at the enclosing root publication and closes captured handles', async () => {
    const scope = conformanceScope(); let allowed = true;
    const services = { capacity: conformanceCapacity(), capabilities: { check: async () => allowed }, resolver: { resolve: async () => 'exact' as const }, clock: { now: () => 1234 } };
    const fixture = await createPgFixture(await createCommentsPostgresRegistration({ services }));
    try {
      const root = await fixture.open(); const grant = grantFor({ scope }); await root.bindNew(grant);
      const module = createCommentsModule({ storage: root.adapter(), capacity: conformanceCapacity() });
      const handle = await module.withContext(grant, () => Promise.resolve(module.store.transaction()));
      await expect(handle.run(async () => null)).rejects.toMatchObject({ code: 'denied' });
      await module.withContext(grant, async () => {
        const record = createAnnotationRevision(null, { scope, annotationId: 'a', primary: conformanceTarget(conformanceResource(scope)), secondary: [], visualAnchors: [], body: conformanceBody('available'), provenance: conformanceProvenance() }, conformanceCapacity());
        await module.store.appendAnnotationRevision(scope, 'a', record, { kind: 'creation', aggregateVersion: 0 });
        await expect(module.store.transaction().run(async () => {
          await module.services.lifecycle({ scope, objectKind: 'annotation', objectId: 'a', action: 'tombstone', archiveKind: null, reason: null, decisionRef: '', idempotencyKey: commandIdempotencyKey('delete'), expected: { kind: 'creation', aggregateVersion: 0 } });
          allowed = false;
        })).rejects.toMatchObject({ code: 'denied' });
        expect((await module.store.getAnnotationHead(scope, 'a'))?.hash).toBe(record.hash);
        expect(await module.store.getLifecycleChain(scope, 'annotation', 'a')).toEqual([]);
      });
    } finally { await fixture.close(); }
  });
});
