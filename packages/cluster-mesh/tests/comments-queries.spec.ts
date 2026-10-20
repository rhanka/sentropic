import { describe, expect, it } from 'vitest';
import { createAnnotationRevision } from '@sentropic/comments';
import { createPgFixture } from './storage/pg-fixture.js';
import { pgEnabled } from './storage/pg-driver.js';
import { grantFor } from './storage/authority-corpus.js';
import { createCommentsModule, createCommentsPostgresRegistration } from '../src/comments/index.js';
import { commentsObjectKey } from '../src/comments/storage-schema.js';
import { emptyEffects } from '../src/storage/staged-preparation.js';
import { conformanceCapacity, conformanceScope, conformanceTarget, conformanceResource, conformanceBody, conformanceProvenance } from '../assets/storage/comments/oracle/conformance.mjs';
describe.skipIf(!pgEnabled)('registered comments queries and shared host migration history', () => {
  it('indexes complete primary/secondary resource tuples and retains captured heads with current availability', async () => {
    const registration = await createCommentsPostgresRegistration(); const fixture = await createPgFixture(registration);
    try {
      const root = await fixture.open(); const scope = conformanceScope();
      const grant = grantFor({ scope, operations: ['read', 'write', 'maintain'] }); const bound = await root.bindNew(grant);
      const module = createCommentsModule({ storage: root.adapter(), capacity: conformanceCapacity() });
      const primary = conformanceResource(scope, 'same-id'); const secondary = { ...primary, namespace: 'secondary' };
      const other = { ...primary, namespace: 'other' };
      const append = (annotationId: string, resource = primary) => module.store.appendAnnotationRevision(scope, annotationId, createAnnotationRevision(null, { scope, annotationId, primary: conformanceTarget(resource), secondary: [conformanceTarget(secondary)], visualAnchors: [], body: conformanceBody('private body'), provenance: conformanceProvenance() }, conformanceCapacity()), { kind: 'creation', aggregateVersion: 0 });
      await module.withContext(grant, async () => { await append('a'); await append('b', other); });
      const query = (name: string, input: unknown, limit = 100, cursor: string | null = null) => bound.query(name, input, { limit, cursor });
      expect((await query('by-resource', { resource: primary })).records).toHaveLength(1);
      expect((await query('by-resource', { resource: secondary })).records).toHaveLength(2);
      expect((await query('by-resource', { resource: other })).records).toHaveLength(1);
      const first = await query('scope-chain-index', {}, 1); expect(first.nextCursor).toBeTypeOf('string');
      await module.withContext(grant, () => append('c'));
      const next = await query('scope-chain-index', {}, 1, first.nextCursor);
      expect(next.records).toHaveLength(1); expect(next.nextCursor).toBeNull();
      await bound.commitAtomic({ ...emptyEffects(), barriers: [{ boundary: commentsObjectKey('annotation', 'a'), reason: 'tombstoned' }] });
      const headers = await query('retained-headers', { selection: { kind: 'annotation-revisions', annotationId: 'a' } });
      expect(headers.records[0]).toMatchObject({ availability: 'inaccessible', selection: { kind: 'annotation-revisions', annotationId: 'a' } });
      expect(JSON.stringify(headers)).not.toContain('private body');
      await fixture.tx.run(true, async (session) => {
        const receipts = await fixture.options.history.read(session);
        expect(receipts.map((receipt) => receipt.id)).toEqual(fixture.options.assets!.map((asset) => asset.id));
        expect(receipts.every((receipt) => receipt.hostMigrationId === 'neutral-host/001')).toBe(true);
      });
      await fixture.open();
    } finally { await fixture.close(); }
  });
});
