import { describe, expect, it } from 'vitest';
import { createLifecycleEvent, commandIdempotencyKey } from '@sentropic/comments';
import { pgEnabled } from './storage/pg-driver.js';
import { commentsHost, importRequest, prepareImport, commitImport } from './storage/comments-host.js';
describe.skipIf(!pgEnabled)('imported lifecycle coherence and later actual disposition', () => {
  it('publishes historical post-tombstone events without executing a claimed physical purge', async () => {
    const h = await commentsHost();
    try {
      await h.module.withContext(h.grant, async () => {
        const input = { scope: h.scope, objectKind: 'annotation' as const, objectId: 'a', archiveKind: null, reason: null, actor: { principal: 'historical-admin' } };
        const tombstone = createLifecycleEvent([], { ...input, action: 'tombstone' }, h.capacity);
        const intent = createLifecycleEvent([tombstone], { ...input, action: 'purge-intent' }, h.capacity);
        const outcome = createLifecycleEvent([tombstone, intent], { ...input, action: 'purge-outcome' }, h.capacity);
        const units = [{ unitId: 'historical-unit', records: [h.annotation('a'), tombstone, intent, outcome] }]; const request = importRequest(h, units);
        const prepared = await prepareImport(h, request, 'historical', units); await commitImport(h, request, prepared);
        await expect(h.module.store.getAnnotationHead(h.scope, 'a')).rejects.toMatchObject({ code: 'denied' });
        expect((await h.bound.purgeRead('jobs', { limit: 100 })).records).toHaveLength(0);
        expect((await h.bound.journalRead(0, 100)).events).toHaveLength(1);
      });
    } finally { await h.fixture.close(); }
  });
  it('allows a later authorized actual purge of an imported tombstone', async () => {
    const h = await commentsHost();
    try {
      await h.bound.configureLifecycle('optional');
      await h.module.withContext(h.grant, async () => {
        const tombstone = createLifecycleEvent([], { scope: h.scope, objectKind: 'annotation', objectId: 'a', action: 'tombstone', archiveKind: null, reason: null, actor: { principal: 'historical-admin' } }, h.capacity);
        const units = [{ unitId: 'historical-unit', records: [h.annotation('a', null, 'retained-import-content'), tombstone] }]; const request = importRequest(h, units);
        await commitImport(h, request, await prepareImport(h, request, 'historical', units));
        const result = await h.module.services.lifecycle({ scope: h.scope, objectKind: 'annotation', objectId: 'a', action: 'purge-intent', archiveKind: null, reason: null,
          decisionRef: '', idempotencyKey: commandIdempotencyKey('later-actual-intent'), expected: { kind: 'revision', revisionHash: tombstone.hash } });
        expect(result.intentId).toBeTypeOf('string'); expect((await h.module.services.completePurge(result.intentId!)).state).toBe('complete');
        await h.fixture.tx.run(true, async (session) => {
          const payloads = (await session.execute({ text: `SELECT convert_from(bytes,'UTF8') AS bytes FROM "${h.fixture.name}".payloads WHERE bytes IS NOT NULL`, values: [] })).rows;
          expect(payloads.some((row) => String(row.bytes).includes('retained-import-content'))).toBe(false);
        });
      });
    } finally { await h.fixture.close(); }
  });
});
