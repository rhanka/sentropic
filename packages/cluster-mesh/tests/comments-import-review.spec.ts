import { describe, expect, it } from 'vitest';
import { createReviewEvent, hashRecord } from '@sentropic/comments';
import type { ReviewEventRecord } from '@sentropic/comments';
import { pgEnabled } from './storage/pg-driver.js';
import { commentsHost, importRequest, prepareImport, commitImport } from './storage/comments-host.js';
describe.skipIf(!pgEnabled)('frozen review state invariants during coherent comments import', () => {
  it('refuses a valid hash claiming validation without an actual prior submission', async () => {
    const h = await commentsHost();
    try {
      const annotation = h.annotation('a'); const envelope = { scope: h.scope, annotationId: 'a', action: 'validate' as const, revisionHash: annotation.hash, referencesEventHash: null,
        actor: { principal: 'historical-human' }, decision: { principal: 'historical-human', outcome: 'accept' as const }, proposal: null, executor: null, link: { sequence: 1, previousHash: null } };
      const review = { kind: 'review-event' as const, ...envelope, hash: hashRecord('review-event', envelope) }; const units = [{ unitId: 'unit', records: [annotation, review] }]; const request = importRequest(h, units);
      await h.module.withContext(h.grant, async () => {
        const prepared = await prepareImport(h, request, 'forged-validation', units);
        await expect(commitImport(h, request, prepared)).rejects.toThrow();
        expect(await h.module.store.getAnnotationHead(h.scope, 'a')).toBeNull();
      });
    } finally { await h.fixture.close(); }
  });
  it('retains older open contests across withdrawal, resubmission and resolution of a later contest', async () => {
    const h = await commentsHost();
    try {
      const annotation = h.annotation('a'); const events: ReviewEventRecord[] = [];
      const add = (action: ReviewEventRecord['action'], referencesEventHash: string | null = null) => {
        const event = createReviewEvent(events, { scope: h.scope, annotationId: 'a', action, revisionHash: annotation.hash, referencesEventHash, actor: { principal: 'historical-human' },
          decision: action === 'validate' || action === 'resolve-contest' ? { principal: 'historical-human', outcome: 'accept' } : null, proposal: null, executor: null }, h.capacity);
        events.push(event); return event;
      };
      add('submit'); const validation = add('validate'); add('contest', validation.hash); add('withdraw'); add('submit'); const secondValidation = add('validate'); const secondContest = add('contest', secondValidation.hash); add('resolve-contest', secondContest.hash);
      const validUnits = [{ unitId: 'unit', records: [annotation, ...events] }]; const request = importRequest(h, validUnits);
      await h.module.withContext(h.grant, async () => { await commitImport(h, request, await prepareImport(h, request, 'valid-history', validUnits)); });
      expect((await h.bound.journalRead(0, 100)).events).toHaveLength(1);
    } finally { await h.fixture.close(); }
  });
});
