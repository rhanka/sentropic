import assert from 'node:assert/strict';
import { describe, expect, it, vi } from 'vitest';
import { commentsHost } from './storage/comments-host.js';
import { pgEnabled } from './storage/pg-driver.js';
import * as exportControl from '../src/comments/export-control.js';

const rootProbe = async () => {
  const h = await commentsHost();
  try {
    await h.module.withContext(h.grant, async () => {
      const first = h.annotation('a');
      await h.module.store.appendAnnotationRevision(h.scope, 'a', first, { kind: 'creation', aggregateVersion: 0 });
      const selection = { scope: h.scope, exportId: 'retained-root',
        selections: [{ kind: 'annotation-revisions' as const, annotationId: 'a' }] };
      const prepared = await h.module.services.prepareExportBoundary(selection);
      assert.equal(prepared.state, 'prepared');
      if (prepared.state !== 'prepared') throw new Error('fixture export did not finish');
      await h.module.store.appendAnnotationRevision(h.scope, 'a', h.annotation('a', first, 'newer'),
        { kind: 'revision', revisionHash: first.hash });
      await assert.doesNotReject(async () => {
        const result = await h.module.services.continueExport(prepared.boundary.request, null, 100);
        assert.deepEqual(result.page.records, [first], 'CM export root probe: reopen exact retained bytes');
        assert.equal(result.nextCursor, null);
      }, 'CM export root probe: reopen exact retained bytes');
    });
  } finally { await h.fixture.close(); }
};

describe.skipIf(!pgEnabled)('recorded export boundary mutation', () => {
  it('should kill substitution of the captured root during readback', async () => {
    await rootProbe();
    const original = exportControl.readCommentsExport;
    const mutant = vi.spyOn(exportControl, 'readCommentsExport').mockImplementation(async (...args) => {
      const state = await original(...args);
      return state ? { ...state, root: null } : null;
    });
    try { await expect(rootProbe()).rejects.toThrow('CM export root probe: reopen exact retained bytes'); }
    finally { mutant.mockRestore(); }
  });
});
