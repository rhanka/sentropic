import { describe, expect, it } from 'vitest';
import { pgEnabled } from './storage/pg-driver.js';
import { commentsHost, importRequest, prepareImport, commitImport } from './storage/comments-host.js';
describe.skipIf(!pgEnabled)('comments coherent groups and cumulative batch receipts', () => {
  it('commits independent units of one frozen request without changing its command binding', async () => {
    const h = await commentsHost();
    try {
      await h.module.withContext(h.grant, async () => {
        const units = [{ unitId: 'unit-a', records: [h.annotation('a')] }, { unitId: 'unit-b', records: [h.annotation('b')] }]; const request = importRequest(h, units);
        const a = await prepareImport(h, request, 'operation-a', [units[0]]); const first = await commitImport(h, request, a);
        const b = await prepareImport(h, request, 'operation-b', [units[1]]); const second = await commitImport(h, request, b);
        expect(first.canonical.snapshot.receiptCount).toBe(1); expect(second.canonical.snapshot.receiptCount).toBe(2);
        expect(first.canonical.snapshot.hash).not.toBe(second.canonical.snapshot.hash);
        expect(await commitImport(h, request, a)).toEqual(first);
        expect(await h.module.services.recoverBatchReceipts({ scope: h.scope, batchId: request.batchId, manifestHash: request.manifest.hash })).toEqual([first, second]);
        await expect(prepareImport(h, request, 'operation-duplicate', [units[0]]))
          .rejects.toMatchObject({ condition: 'conflict', code: 'idempotency-conflict' });
        expect((await h.bound.journalRead(0, 100)).events).toHaveLength(2);
      });
    } finally { await h.fixture.close(); }
  });
});
