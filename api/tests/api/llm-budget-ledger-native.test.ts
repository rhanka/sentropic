import { expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { withNativeLedger } from './native-ledger-fixture';
it('joins opaque HTTP response, physical observation and exactly one priced financial row by server request ID', async () => {
  await withNativeLedger({}, async h => {
    const response = await h.router.request('/v1/messages', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(h.request.body) });
    expect(response.status).toBe(200); expect(response.headers.get('x-sentropic-request-id')).toBe(h.requestId);
    await Promise.all(h.writes);
    const financial = await h.financial(), observation = await h.observation();
    expect(await h.ledger()).toHaveLength(2);
    expect(financial.idempotency_key).toBe(h.requestId); expect(observation.response_id).toBe(h.requestId);
    expect(observation.idempotency_key).not.toBe(h.requestId); expect(observation.idempotency_key).not.toBe(h.cost.correlationId);
    expect(observation.cost_micro_usd).toBeNull(); expect(Number(financial.cost_micro_usd)).toBe(1490);
    expect(financial.pricing_version).toBe(h.pricingId);
    expect(await h.rows(sql`SELECT reserved_micro_usd, spent_micro_usd FROM control.budgets WHERE tenant_id = ${h.cost.tenantId}`))
      .toEqual([{ reserved_micro_usd: '0', spent_micro_usd: '1490' }]);
  });
});
