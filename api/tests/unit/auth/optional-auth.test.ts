import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { authenticate } = vi.hoisted(() => ({ authenticate: vi.fn() }));
vi.mock('../../../src/services/identity/cm-http-principal', () => ({
  authenticateCmHttpRequest: authenticate,
  publishCmAuthenticationRefusal: (result: { body: string; status: number }) =>
    new Response(result.body, { status: result.status }),
}));
vi.mock('../../../src/services/workspace-service', () => ({ ensureWorkspaceForUser: vi.fn() }));
vi.mock('../../../src/services/workspace-access', () => ({}));
import { optionalAuth } from '../../../src/middleware/auth';

describe('public route optional authentication', () => {
  const app = new Hono().use('*', optionalAuth).get('/public', c =>
    c.json({ anonymous: !c.get('user') }));
  beforeEach(() => { authenticate.mockReset(); });

  it.each(['invalid', 'expired'])('continues anonymously with an %s credential', async token => {
    authenticate.mockResolvedValue({ accepted: false, status: 401,
      body: JSON.stringify({ error: { code: 'invalid_session' } }) });
    const response = await app.request('/public', { headers: { authorization: `Bearer ${token}` } });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ anonymous: true });
    expect(authenticate).toHaveBeenCalledWith(expect.any(Request), false);
  });

  it('fails closed when authentication infrastructure is unavailable', async () => {
    authenticate.mockRejectedValue(Object.assign(new Error('database unavailable'), { code: '08006' }));
    const response = await app.request('/public', { headers: { authorization: 'Bearer valid-credential' } });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'Authentication unavailable' });
  });
});
