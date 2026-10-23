import { describe, expect, it } from 'vitest';
import { createAnnotationRevision } from '@sentropic/comments';
import { createCommentsModule, createCommentsPostgresRegistration } from '../src/comments/index.js';
import { validateCommentsFragment, commentsUnitPayloadDigest } from '../src/comments/fragment-codec.js';
import { createPgFixture } from './storage/pg-fixture.js';
import { pgEnabled } from './storage/pg-driver.js';
import { grantFor } from './storage/authority-corpus.js';
import { conformanceCapacity, conformanceScope, conformanceTarget, conformanceResource, conformanceBody, conformanceProvenance } from '../assets/storage/comments/oracle/conformance.mjs';
describe.skipIf(!pgEnabled)('retained authorized comments transport export', () => {
  it('freezes exact heads and returns advancing whole fragments with a verifiable terminal', async () => {
    const capacity = conformanceCapacity(); const scope = conformanceScope(); const authority = { allowed: true };
    const registration = await createCommentsPostgresRegistration({ services: { capacity, capabilities: { check: async () => authority.allowed }, resolver: { resolve: async () => 'exact' }, clock: { now: () => 1717000000123 } } });
    const fixture = await createPgFixture(registration);
    try {
      const root = await fixture.open(); const grant = grantFor({ scope, operations: ['read', 'write', 'maintain'] }); await root.bindNew(grant);
      const module = createCommentsModule({ storage: root.adapter(), capacity });
      await module.withContext(grant, async () => {
        const records = []; let previous = null;
        for (let revision = 0; revision < 28; revision++) {
          const record = createAnnotationRevision(previous, { scope, annotationId: 'long', primary: conformanceTarget(conformanceResource(scope)), secondary: [], visualAnchors: [],
            body: conformanceBody(`${revision}: ${'🦊'.repeat(12000)}`), provenance: conformanceProvenance() }, capacity);
          await module.store.appendAnnotationRevision(scope, 'long', record, previous ? { kind: 'revision', revisionHash: previous.hash } : { kind: 'creation', aggregateVersion: 0 });
          records.push(record); previous = record;
        }
        expect(Buffer.byteLength(JSON.stringify(records))).toBeGreaterThan(1048576);
        const reader = grantFor({ scope, token: 'export-reader', operations: ['read'] }); await root.bindNew(reader);
        await module.withContext(reader, async () => {
        const selection = { scope, exportId: 'export-long', selections: [{ kind: 'annotation-revisions' as const, annotationId: 'long' }] };
        let preparation = await module.services.prepareExportBoundary(selection);
        for (let step = 0; preparation.state !== 'prepared' && step < 100; step++) {
          expect(preparation.work.records).toBeLessThanOrEqual(50);
          preparation = await module.services.prepareExportBoundary(selection, preparation.continuation);
        }
        expect(preparation.state).toBe('prepared'); const boundary = preparation.boundary;
        expect(boundary.unitRoot).toEqual({ unitId: selection.exportId, records: '28', payloadDigest: commentsUnitPayloadDigest(selection.exportId, records) });
        const newer = createAnnotationRevision(previous, { scope, annotationId: 'long', primary: conformanceTarget(conformanceResource(scope)), secondary: [], visualAnchors: [], body: conformanceBody('after snapshot'), provenance: conformanceProvenance() }, capacity);
        await module.withContext(grant, () => module.store.appendAnnotationRevision(scope, 'long', newer, { kind: 'revision', revisionHash: previous.hash }));
        const first = await module.services.readExportFragments(boundary.request, null, 1);
        expect(await module.services.readExportFragments(boundary.request, null, 1)).toEqual(first);
        const collected = []; let page = first; let lastDigest = null; let ordinal = 0; let terminal = null; const cursors = new Set();
        for (let pages = 0; pages < 100; pages++) {
          expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThanOrEqual(1048576);
          for (const fragment of page.fragments) {
            validateCommentsFragment(fragment); expect(fragment.manifest.ordinal).toBe(String(ordinal++)); expect(fragment.manifest.predecessorHash).toBe(lastDigest);
            lastDigest = fragment.digest; collected.push(...fragment.payload); if (fragment.manifest.terminal) terminal = fragment;
          }
          if (page.nextCursor === null) break;
          expect(cursors.has(page.nextCursor)).toBe(false); cursors.add(page.nextCursor);
          page = await module.services.readExportFragments(boundary.request, page.nextCursor, 1);
        }
        expect(collected).toEqual(records); expect(terminal.manifest.terminal.unitRoots).toEqual([boundary.unitRoot]);
        const canonical = await module.services.continueExport(boundary.request, null, 2);
        expect(canonical.page.records).toEqual(records.slice(0, 2)); expect(canonical.nextCursor).not.toBeNull();
        authority.allowed = false;
        await expect(module.services.readExportFragments(boundary.request, first.nextCursor, 1)).rejects.toMatchObject({ code: 'denied' });
        });
      });
    } finally { await fixture.close(); }
  });
});
