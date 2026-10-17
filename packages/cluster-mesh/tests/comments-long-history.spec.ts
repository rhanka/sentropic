import { describe, expect, it } from 'vitest';
import { pgEnabled } from './storage/pg-driver.js';
import { commentsHost, importRequest, prepareImport, commitImport } from './storage/comments-host.js';
describe.skipIf(!pgEnabled)('comments long-history round trip on independent Postgres stores', () => {
  it('imports every record of a fragmented history above 512 KiB and one MiB with one publication', async () => {
    const source = await commentsHost(); const destination = await commentsHost();
    try {
      const records = []; let previous = null;
      await source.module.withContext(source.grant, async () => {
        for (let revision = 0; revision < 14; revision++) {
          const record = source.annotation('long', previous, `${revision}:${'🦊"\\'.repeat(10000)}`);
          await source.module.store.appendAnnotationRevision(source.scope, 'long', record, previous ? { kind: 'revision', revisionHash: previous.hash } : { kind: 'creation', aggregateVersion: 0 });
          records.push(record); previous = record;
        }
      });
      expect(Buffer.byteLength(JSON.stringify(records))).toBeGreaterThan(1048576);
      const chunks = []; let terminal = null;
      await source.module.withContext(source.grant, async () => {
        const selection = { scope: source.scope, exportId: 'source-unit', selections: [{ kind: 'annotation-revisions' as const, annotationId: 'long' }] };
        let prep = await source.module.services.prepareExportBoundary(selection);
        for (let step = 0; prep.state !== 'prepared' && step < 100; step++) prep = await source.module.services.prepareExportBoundary(selection, prep.continuation);
        expect(prep.state).toBe('prepared'); let cursor = null;
        do {
          const page = await source.module.services.readExportFragments(prep.boundary.request, cursor, 1);
          for (const fragment of page.fragments) { if (fragment.manifest.terminal) terminal = fragment.manifest.terminal; else chunks.push(fragment.payload); }
          cursor = page.nextCursor;
        } while (cursor !== null);
      });
      expect(chunks.length).toBeGreaterThan(2); expect(terminal.unitRoots[0].records).toBe('14');
      await destination.module.withContext(destination.grant, async () => {
        const units = [{ unitId: 'source-unit', records }]; const request = importRequest(destination, units);
        const prepared = await prepareImport(destination, request, 'round-trip', units, chunks);
        expect(await destination.module.store.getAnnotationHead(destination.scope, 'long')).toBeNull();
        const receipt = await commitImport(destination, request, prepared);
        expect(receipt.units).toEqual(terminal.unitRoots);
        expect(await destination.module.store.getAnnotationChain(destination.scope, 'long')).toEqual(records);
        expect((await destination.bound.journalRead(0, 100)).events).toHaveLength(1);
      });
    } finally { await source.fixture.close(); await destination.fixture.close(); }
  });
});
