import { describe, expect, it } from 'vitest';
import { createAnnotationRevision } from '@sentropic/comments';
import { createCommentsModule, createCommentsPostgresRegistration, createCommentsPostgresStorage } from '../src/comments/index.js';
import { createPgFixture } from './storage/pg-fixture.js';
import { pgEnabled } from './storage/pg-driver.js';
import { grantFor } from './storage/authority-corpus.js';
import { conformanceCapacity, conformanceScope, conformanceBody, conformanceTarget, conformanceResource, conformanceProvenance } from '../assets/storage/comments/oracle/conformance.mjs';

describe.skipIf(!pgEnabled)('persistent M1 cursor configuration', () => {
  it('requires a host key and resumes exact pages on restarted and replica runtimes', async () => {
    const f = await createPgFixture(await createCommentsPostgresRegistration());
    const capacity = conformanceCapacity(), scope = conformanceScope();
    const open = async (cursorSecret: string) => {
      const root = await createCommentsPostgresStorage({ ...f.options, cursorSecret });
      return { root, module: createCommentsModule({ storage: root.adapter(), capacity }) };
    };
    try {
      await expect(createCommentsPostgresStorage({ ...f.options, cursorSecret: undefined! }))
        .rejects.toMatchObject({ code: 'invalid-command' });
      const first = await open('shared-host-secret');
      const grant = grantFor({ scope });
      await first.root.bindNew(grant);
      const records = [];
      await first.module.withContext(grant, async () => {
        let previous = null;
        for (let revision = 0; revision < 3; revision++) {
          const record = createAnnotationRevision(previous, {
            scope, annotationId: 'a', primary: conformanceTarget(conformanceResource(scope)),
            secondary: [], visualAnchors: [], body: conformanceBody(String(revision)), provenance: conformanceProvenance(),
          }, capacity);
          await first.module.store.appendAnnotationRevision(scope, 'a', record,
            previous ? { kind: 'revision', revisionHash: previous.hash } : { kind: 'creation', aggregateVersion: 0 });
          records.push(record); previous = record;
        }
      });
      const selection = { kind: 'annotation-revisions' as const, annotationId: 'a' };
      const read = (module, cursor) => module.withContext(grant, () =>
        module.store.readChainPage(scope, selection, { limit: 1, cursor }));
      const page = await read(first.module, null);
      expect(page.records).toEqual(records.slice(0, 1));
      expect(page.nextCursor).toEqual(expect.any(String));
      const restarted = await open('shared-host-secret');
      const replica = await open('shared-host-secret');
      const second = await read(restarted.module, page.nextCursor);
      expect(second.records).toEqual(records.slice(1, 2));
      expect(await read(replica.module, page.nextCursor)).toEqual(second);
      expect((await read(replica.module, second.nextCursor)).records).toEqual(records.slice(2));
      expect(await read((await open('different-host-secret')).module, page.nextCursor))
        .toEqual({ outcome: 'incomplete', records: [], nextCursor: null });
    } finally { await f.close(); }
  });
});
