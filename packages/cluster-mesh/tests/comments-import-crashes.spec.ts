import { describe, expect, it } from 'vitest';
import { createCommentsModule } from '../src/comments/index.js';
import { pgEnabled } from './storage/pg-driver.js';
import { commentsHost, importRequest, prepareImport, commitImport } from './storage/comments-host.js';
describe.skipIf(!pgEnabled)('comments bounded import restart and response loss', () => {
  it('resumes each preparation step from a new runtime and recovers one original commit after response loss', async () => {
    const h = await commentsHost();
    try {
      const units = [{ unitId: 'unit', records: [h.annotation('a')] }]; const request = importRequest(h, units);
      const prepared = await h.module.withContext(h.grant, () => prepareImport(h, request, 'restart', units)); let receipt;
      for (let step = 0; step < 100; step++) {
        const reopened = createCommentsModule({ storage: (await h.fixture.open()).adapter(), capacity: h.capacity });
        const result = await reopened.withContext(h.grant, () => reopened.services.commitPreparedImport({ request, prepared, fence: h.fence, limits: { maxRecords: 2, maxAppends: 1, maxEncodedBytes: 8192 } }));
        if (result.state === 'committed') { receipt = result.receipt; break; }
        expect(await h.module.withContext(h.grant, () => h.module.store.getAnnotationHead(h.scope, 'a'))).toBeNull();
      }
      expect(receipt).toBeDefined();
      const recovered = await h.module.withContext(h.grant, () => h.module.services.recoverBatchReceipts({ scope: h.scope, batchId: request.batchId, manifestHash: request.manifest.hash }));
      expect(recovered).toEqual([receipt]);
      expect(await h.module.withContext(h.grant, () => commitImport(h, request, prepared))).toEqual(receipt);
      expect((await h.bound.journalRead(0, 100)).events).toHaveLength(1);
    } finally { await h.fixture.close(); }
  });
});
