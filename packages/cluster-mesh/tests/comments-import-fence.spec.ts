import { describe, expect, it } from 'vitest';
import { commentsImportBindingDigest, createCommentsFragment } from '../src/comments/index.js';
import { pgEnabled } from './storage/pg-driver.js';
import { commentsHost, importRequest } from './storage/comments-host.js';
import { conformanceResource } from '../assets/storage/comments/oracle/conformance.mjs';
describe.skipIf(!pgEnabled)('comments fragment retry authority', () => {
  it('refuses an identical acknowledgement retry after the writer fence is superseded', async () => {
    const h = await commentsHost();
    try {
      await h.module.withContext(h.grant, async () => {
        const record = h.annotation('a'); const request = importRequest(h, [{ unitId: 'unit', records: [record] }]);
        const binding = { version: 'comments-transport-v1' as const, operationId: 'retry', request, unitIds: ['unit'], sourceBoundary: 'frozen', targets: [conformanceResource(h.scope)], capabilities: ['revise' as const] };
        const fragment = createCommentsFragment({ scope: h.scope, operationId: 'retry', bindingDigest: commentsImportBindingDigest(binding), unitId: 'unit', ordinal: '0', predecessorHash: null, terminal: null }, [record]);
        await h.module.services.prepareImportFragment({ binding, fragment, fence: h.fence });
        await h.root.provisionFence(h.grant, { ...h.fence, epoch: '2' });
        await expect(h.module.services.prepareImportFragment({ binding, fragment, fence: h.fence })).rejects.toMatchObject({ code: 'invalid-command' });
        expect(await h.module.store.getAnnotationHead(h.scope, 'a')).toBeNull();
      });
    } finally { await h.fixture.close(); }
  });
});
