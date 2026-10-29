import { describe, expect, it } from 'vitest';
import { pgEnabled } from './pg-driver.js';
import { createPgFixture } from './pg-fixture.js';
import { grantFor } from './authority-corpus.js';
describe.skipIf(!pgEnabled)('durable journal consumers', () => {
  it('preserves poison and contiguous delivery across restarts and authorized retry', async () => {
    const fixture = await createPgFixture();
    try {
      const grant = grantFor({ operations: ['read', 'write', 'maintain'] }); const root = await fixture.open(); let bound = await root.bindNew(grant);
      const fence = { fenceId: 'journal', epoch: '1', incarnation: root.incarnation, ownerId: grant.principalId };
      await root.provisionFence(grant, fence);
      await bound.genesis('receipt', '1', 'h1', {}); await bound.genesis('receipt', '2', 'h2', {});
      await bound.journalRead(1, 1, 'consumer');
      await expect(bound.journalCheckpoint('consumer', 0, 2, fence)).rejects.toMatchObject({ code: 'invalid-command' });
      const delivery = await bound.journalRead(0, 2, 'consumer');
      await bound.journalPoison('consumer', delivery.events[0]!.eventId, 'decode failed');
      bound = await (await fixture.open()).bind(grant);
      expect(await bound.journalInspect('consumer')).toMatchObject({ status: 'stalled', cursor: '0', failedEvent: delivery.events[0]!.eventId });
      await bound.journalRetry('consumer', delivery.events[0]!.eventId, fence);
      await expect(bound.journalCheckpoint('consumer', 0, 2, fence)).rejects.toMatchObject({ code: 'invalid-command' });
      await bound.journalRead(0, 2, 'consumer'); await bound.journalCheckpoint('consumer', 0, 2, fence);
      expect(await bound.journalInspect('consumer')).toMatchObject({ status: 'running', cursor: '2', failedEvent: null, lag: '0' });
    } finally { await fixture.close(); }
  });
});
