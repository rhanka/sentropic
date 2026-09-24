import { describe, expect, it, vi } from 'vitest';
import {
  createGatewayRouter, stubGatewayConfig, PersonalPassthroughCallerAuth,
  type CallerAuthRequestContext, type CallerAuthResult,
} from '../src/index.js';

const paths = ['/v1/messages', '/v1/chat/completions', '/v1/models'];
const cost = { tenantId: 't', principalId: 'p', source: 'test', correlationId: 'r' };
const send = (app: ReturnType<typeof createGatewayRouter>, path: string) => app.request(
  `http://internal${path}`, { method: path.endsWith('models') ? 'GET' : 'POST',
    headers: { 'x-forwarded-host': 'attacker', 'x-forwarded-proto': 'https' },
    ...(!path.endsWith('models') ? { body: JSON.stringify({ model: 'm', messages: [] }) } : {}),
  },
);

describe('request-bound caller authentication', () => {
  it.each([
    { authorization: 'Basic malformed', 'x-api-key': 'token' },
    { authorization: '', 'x-api-key': 'token' },
    { authorization: 'Bearer token', Authorization: 'Bearer other' },
    { authorization: 'Bearer token extra' }, { 'x-api-key': ' ' }, {},
  ])('rejects ambiguous or malformed credentials without verification: %j', async headers => {
    const verify = vi.fn(() => undefined);
    const auth = new PersonalPassthroughCallerAuth({ verifyToken: { verify } });
    expect(await auth.verify(headers as Record<string, string>,
      { method: 'POST', url: 'https://gateway.test/v1/messages', requestId: 'r' })).toMatchObject({ ok: false });
    expect(verify).not.toHaveBeenCalled();
  });
  it.each(paths)('passes actual method and URL without trusting forwarded headers: %s', async path => {
    const verify = vi.fn(async (): Promise<CallerAuthResult> => ({ ok: false }));
    const app = createGatewayRouter({ config: { ...stubGatewayConfig, callerAuth: { verify } },
      resolveTarget: () => undefined, metering: { settle() {} }, requestId: () => 'generated',
    });
    expect((await send(app, path)).status).toBe(401);
    expect(verify.mock.calls[0]).toEqual([expect.any(Object), expect.objectContaining({
      method: path.endsWith('models') ? 'GET' : 'POST', url: `http://internal${path}`,
      requestId: 'generated',
    })]);
  });
  it.each(paths)('passes the trusted external TLS URL including rewritten path: %s', async path => {
    const verify = vi.fn(async (): Promise<CallerAuthResult> => ({ ok: false }));
    const app = createGatewayRouter({ config: { ...stubGatewayConfig, callerAuth: { verify } },
      resolveTarget: () => undefined, metering: { settle() {} },
      publicUrl: req => `https://public.test/gateway${new URL(req.url).pathname}`,
    });
    await send(app, path);
    expect(verify.mock.calls[0]).toEqual([expect.any(Object), expect.objectContaining({
      url: `https://public.test/gateway${path}`,
    })]);
  });
  it.each(paths)('sanitizes verifier outages and prevents account access: %s', async path => {
    const access = vi.fn();
    const app = createGatewayRouter({ config: { ...stubGatewayConfig,
      callerAuth: { async verify() { throw Error('SECRET'); } },
      pool: { ...stubGatewayConfig.pool, snapshotModels: access, select: access },
    }, resolveTarget: access, metering: { settle: access } });
    const response = await send(app, path);
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('SECRET');
    expect(access).not.toHaveBeenCalled();
  });
  it.each(paths)('rejects invalid URL and throwing reconstruction before verification: %s', async path => {
    for (const publicUrl of [() => '/relative', () => 'file:///secret',
      () => undefined as unknown as string, () => { throw Error(); }]) {
      const verify = vi.fn(async (): Promise<CallerAuthResult> => ({ ok: true, cost }));
      const app = createGatewayRouter({ config: { ...stubGatewayConfig, callerAuth: { verify } },
        publicUrl, resolveTarget: () => undefined, metering: { settle() {} },
      });
      expect((await send(app, path)).status).toBe(503);
      expect(verify).not.toHaveBeenCalled();
    }
  });
  it('fails closed without context at runtime and preserves the verifier context', async () => {
    const verify = vi.fn(() => undefined);
    const auth = new PersonalPassthroughCallerAuth({ verifyToken: { verify } });
    await expect(auth.verify({}, undefined as unknown as CallerAuthRequestContext))
      .rejects.toMatchObject({ kind: 'caller-auth-unavailable' });
    expect(verify).not.toHaveBeenCalled();
    const context = { method: 'POST', url: 'https://public.test/v1/messages', requestId: 'r' };
    await auth.verify({ authorization: 'Bearer token' }, context);
    expect(verify).toHaveBeenCalledWith('token', 'Bearer', { authorization: 'Bearer token' }, context);
  });
});
