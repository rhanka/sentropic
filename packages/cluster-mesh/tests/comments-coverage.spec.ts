import { describe, expect, it } from 'vitest';
import { createThreadStructureRevision, createCommentRevision } from '@sentropic/comments';
import { createPgFixture } from './storage/pg-fixture.js';
import { pgEnabled } from './storage/pg-driver.js';
import { grantFor } from './storage/authority-corpus.js';
import { emptyEffects } from '../src/storage/staged-preparation.js';
import { createCommentsModule } from '../src/comments/index.js';
import { commentsObjectKey } from '../src/comments/storage-schema.js';
import { conformanceCapacity, conformanceScope, conformanceTarget, conformanceResource, conformanceBody, conformanceProvenance } from '../assets/storage/comments/oracle/conformance.mjs';
describe.skipIf(!pgEnabled)('comments dependent availability on the current scope root', () => {
  it('denies all children with one thread barrier beyond the normal atomic record limit', async () => {
    const fixture = await createPgFixture({ limits: { maxRecords: 2, maxAppends: 2, maxEncodedBytes: 524288 } });
    try {
      const root = await fixture.open(); const module = createCommentsModule({ storage: root.adapter(), capacity: conformanceCapacity() });
      const scope = conformanceScope(); const grant = grantFor({ scope }); const bound = await root.bindNew(grant);
      await module.withContext(grant, async () => {
        const thread = createThreadStructureRevision(null, { scope, threadId: 'thread', trigger: 'initial-registration', primary: conformanceTarget(conformanceResource(scope)), annotationId: null, provenance: conformanceProvenance() }, conformanceCapacity());
        await module.store.appendThreadStructureRevision(scope, 'thread', thread, { kind: 'creation', aggregateVersion: 0 });
        for (let i = 0; i < 5; i++) {
          const comment = createCommentRevision(null, { scope, threadId: 'thread', commentId: `child-${i}`, parentCommentId: null, structureRevision: { id: 'thread', hash: thread.hash }, annotationPin: null, body: conformanceBody('sensitive'), provenance: conformanceProvenance() }, conformanceCapacity());
          await module.store.appendCommentRevision(scope, comment.commentId, comment, { kind: 'creation', aggregateVersion: 0 });
        }
        const first = await module.store.readChainPage(scope, { kind: 'thread-structure-revisions', threadId: 'thread' }, { limit: 1, cursor: null });
        expect(first.records).toHaveLength(1);
        await bound.commitAtomic({ ...emptyEffects(), barriers: [{ boundary: commentsObjectKey('thread', 'thread'), reason: 'authorized-tombstone' }] });
        for (let i = 0; i < 5; i++) {
          await expect(module.store.getCommentHead(scope, `child-${i}`)).rejects.toMatchObject({ code: 'denied' });
          await expect(module.store.getCommentChain(scope, `child-${i}`)).rejects.toMatchObject({ code: 'denied' });
          expect(await module.store.readChainPage(scope, { kind: 'comment-revisions', commentId: `child-${i}` }, { limit: 1, cursor: null })).toEqual({ outcome: 'inaccessible', records: [], nextCursor: null });
        }
        await expect(module.store.getThreadStructureHead(scope, 'thread')).rejects.toMatchObject({ code: 'denied' });
      });
    } finally { await fixture.close(); }
  });
});
