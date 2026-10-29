import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { AuthUser } from '../../src/middleware/auth';
import { createDecisionRouter } from '../../src/routes/namespaces/decision-router';
import { decisionRequest } from '../../../packages/llm-mesh/tests/decision-fixtures';
import { decisionWireFixture } from '../../../packages/llm-mesh/tests/decision-wire-fixtures';

const fixture = (role: string | undefined = 'admin_app', profile: 'production' | 'qualification' = 'qualification') => {
  const client = { decide: vi.fn(async () => decisionWireFixture(decisionRequest())) };
  const readiness = vi.fn(async () => ({ productionReady: false, profile }));
  const forCaller = vi.fn(async () => ({ client, readiness }));
  const app = new Hono();
  app.use('*', async (c, next) => {
    if (role) c.set('user', { userId: 'fixture-user', workspaceId: 'fixture-workspace', role } as AuthUser);
    await next();
  });
  app.route('/api/v1/llm-mesh', createDecisionRouter({ profile, forCaller }));
  const post = (body: unknown = decisionRequest()) => app.request('/api/v1/llm-mesh/decision', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  return { app, client, forCaller, readiness, post };
};

describe('Decision HTTP authentication and bounded ingress', () => {
  it('should refuse anonymous callers before service or readiness resolution', async () => {
    const f = fixture('');
    expect((await f.post()).status).toBe(401);
    expect((await f.app.request('/api/v1/llm-mesh/decision')).status).toBe(401);
    expect(f.forCaller).not.toHaveBeenCalled();
  });
  it.each(['guest', 'editor', 'admin_org'])('should refuse %s from the qualification host', async (role) => {
    const f = fixture(role);
    expect((await f.post()).status).toBe(403);
    expect(f.forCaller).not.toHaveBeenCalled();
  });
  it('should return the service envelope and readiness to the verified administrator', async () => {
    const f = fixture();
    expect((await f.post()).status).toBe(200);
    expect(f.client.decide).toHaveBeenCalledOnce();
    const response = await f.app.request('/api/v1/llm-mesh/decision');
    expect(await response.json()).toEqual({ productionReady: false, profile: 'qualification' });
    expect(f.readiness).toHaveBeenCalledOnce();
  });
  it('should refuse workspace denial and sanitize directory outages', async () => {
    const f = fixture();
    f.forCaller.mockResolvedValueOnce(undefined);
    expect((await f.post()).status).toBe(403);
    f.forCaller.mockRejectedValueOnce(new Error('fixture-private-directory-failure'));
    const response = await f.post();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'unavailable' });
    expect(f.client.decide).not.toHaveBeenCalled();
  });
  it('should reject malformed and oversized bodies without resolving any financial ports', async () => {
    const f = fixture();
    const malformed = await f.app.request('/api/v1/llm-mesh/decision', { method: 'POST', body: '{' });
    expect(malformed.status).toBe(400);
    expect((await f.post({ output: 'x'.repeat(256 * 1024) })).status).toBe(413);
    expect(f.forCaller).not.toHaveBeenCalled();
  });
});
