import { describe, expect, it } from 'vitest';
import { createLifecycleEvent, createOperationAuditEvent } from '@sentropic/comments';
import { pgEnabled } from './storage/pg-driver.js';
import { commentsHost } from './storage/comments-host.js';
describe.skipIf(!pgEnabled)('operational comments readback audience', () => {
  it.each(['personal-lifecycle', 'restricted-audit'])('does not expose another audience through read/export (%s)', async (kind) => {
    const h = await commentsHost();
    try {
      await h.module.withContext(h.grant, async () => {
        const annotation = h.annotation('a'); await h.module.store.appendAnnotationRevision(h.scope, 'a', annotation, { kind: 'creation', aggregateVersion: 0 });
        const subjectId = JSON.stringify(['comments-object', 'annotation', 'a']);
        const selection = kind === 'personal-lifecycle' ? { kind: 'lifecycle-events' as const, objectKind: 'annotation' as const, objectId: 'a' } : { kind: 'operation-audit-events' as const, subject: 'archive' as const, subjectId };
        if (kind === 'personal-lifecycle') await h.module.store.appendLifecycleEvent(h.scope, 'annotation', 'a', createLifecycleEvent([], { scope: h.scope, objectKind: 'annotation', objectId: 'a', action: 'archive', archiveKind: 'personal', reason: 'private preference', actor: { principal: 'other-audience' } }, h.capacity), { kind: 'creation', aggregateVersion: 0 });
        else await h.module.store.appendOperationAuditEvent(h.scope, 'archive', subjectId, createOperationAuditEvent([], { scope: h.scope, subject: 'archive', subjectId, operation: 'archive', principal: 'other-audience', audience: ['other-audience'], detail: { private: 'preference' } }, h.capacity), { kind: 'creation', aggregateVersion: 0 });
        await expect(h.module.services.read({ scope: h.scope, selection })).rejects.toMatchObject({ code: 'denied' });
        await expect(h.module.services.prepareExportBoundary({ scope: h.scope, exportId: 'private', selections: [selection] })).rejects.toMatchObject({ code: 'denied' });
        expect(await h.module.store.getAnnotationHead(h.scope, 'a')).toEqual(annotation);
      });
    } finally { await h.fixture.close(); }
  });
});
