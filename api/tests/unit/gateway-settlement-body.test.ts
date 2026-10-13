import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultGatewayBodyBytePool, ensureCheckedGatewayBody, gatewayRequestBodyLimit } from '@sentropic/llm-gateway';
import { settlementModeMiddleware } from '../../src/services/llm-metering/route-settlement';

afterEach(() => vi.restoreAllMocks());
describe('shared bounded settlement ingress', () => {
  it.each(['/v1/messages', '/v1/chat/completions', '/v1/messages/count_tokens', '/responses', '/v1/responses'])(
    'reads %s once in either host order', async path => {
      for (const productOrder of [false, true]) {
        const clone = vi.spyOn(Request.prototype, 'clone');
        const parse = vi.spyOn(JSON, 'parse');
        const app = new Hono();
        if (productOrder) app.use('*', gatewayRequestBodyLimit());
        app.use('*', settlementModeMiddleware());
        app.use('*', gatewayRequestBodyLimit());
        const body = { model: 'fixture', stream: true, opaque: 'é' };
        let owner: Awaited<ReturnType<typeof ensureCheckedGatewayBody>> | undefined;
        app.post(path, async context => {
          owner = await ensureCheckedGatewayBody(context.req.raw);
          expect(owner.body).toEqual(body);
          expect(owner.bytes).toBe(Buffer.byteLength(JSON.stringify(body)));
          expect(defaultGatewayBodyBytePool.stats.reservedBytes).toBe(baseline + owner.bytes);
          expect(context.req.header('x-sentropic-internal-settlement-mode')).toBe(
            path.endsWith('count_tokens') ? undefined : 'stream');
          return context.json({ ok: true });
        });
        const baseline = defaultGatewayBodyBytePool.stats.reservedBytes;
        const response = await app.request(path, { method: 'POST', headers: {
          'content-type': 'application/json', 'x-sentropic-internal-settlement-mode': 'spoof' }, body: JSON.stringify(body) });
        expect(response.status).toBe(200); expect(clone).not.toHaveBeenCalled();
        expect(parse.mock.calls.filter(([text]) => text === JSON.stringify(body))).toHaveLength(1);
        expect(owner!.retainedHolders).toBe(0);
        expect(defaultGatewayBodyBytePool.stats.reservedBytes).toBe(baseline);
        clone.mockRestore(); parse.mockRestore();
      }
    });
  it.each(['/api/v1/gw/v1/messages', '/api/v1/gw/responses'])('reads mounted %s through the trusted prefix', async path => {
    const options = { mountPrefix: '/api/v1/gw' };
    const app = new Hono();
    app.use('*', gatewayRequestBodyLimit(options));
    app.use('*', settlementModeMiddleware(options));
    const body = { model: 'fixture', stream: false };
    app.post(path, async context => {
      const owner = await ensureCheckedGatewayBody(context.req.raw, options);
      expect(owner.body).toEqual(body);
      expect(context.req.header('x-sentropic-internal-settlement-mode')).toBe('generate');
      return context.json({ ok: true });
    });
    const response = await app.request(path, { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    expect(response.status).toBe(200);
  });
});
