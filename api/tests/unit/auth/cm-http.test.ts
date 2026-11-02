import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { runCmAuthHttp } from '../../../src/routes/namespaces/auth/cm-http';

const harness = vi.hoisted(() => ({ run: vi.fn(), events: [] as string[] }));
vi.mock('../../../src/services/identity/cm-auth-runtime', () => ({
  withAppCmAuth: (operation: (runner: unknown) => Promise<unknown>) => operation({
    request: harness.run,
    complete: async (_flow: string, work: unknown) => ({ committed: true, value: await harness.run(work) }),
  }),
}));
vi.mock('../../../src/services/identity/cm-host-scope', () => ({ assertCmHostHealthy: vi.fn() }));

const request = (handler: Hono, body = '', completion = false) => new Hono().post('/test', c =>
  runCmAuthHttp(c, completion ? 'authentication' : null, () => handler)
).request('/test', { method: 'POST', body });

describe('CM HTTP publication boundary', () => {
  beforeEach(() => {
    harness.events.length = 0;
    harness.run.mockImplementation(async work => {
      try {
        const value = await work({}, { hostTransaction: {} });
        harness.events.push('commit');
        return value;
      } catch (error) { harness.events.push('rollback'); throw error; }
    });
  });

  it.each([false, true])('strips provisional cookies after a handler failure (completion=%s)', async completion => {
    const handler = new Hono().post('/test', c => {
      c.header('set-cookie', 'session=uncommitted-candidate; HttpOnly');
      return c.json({ error: 'temporarily_unavailable', access_token: 'uncommitted-candidate' }, 503);
    });
    const response = await request(handler, '', completion);
    expect(harness.events).toEqual(['rollback']);
    expect(response.status).toBe(503);
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(await response.json()).toEqual({ error: 'temporarily_unavailable' });
  });

  it('commits ordinary OAuth protocol denials with their original response', async () => {
    const response = await request(new Hono().post('/test', c => c.json({ error: 'invalid_grant' }, 400)));
    expect(harness.events).toEqual(['commit']);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'invalid_grant' });
  });

  it('refuses an oversized body before opening a transaction', async () => {
    const response = await request(new Hono(), 'x'.repeat(65_537));
    expect(response.status).toBe(413);
    expect(harness.events).toEqual([]);
  });

  it('bounds registration presentation parsing before any JSON decoder is called', async () => {
    const decode = vi.fn();
    const app = new Hono().post('/test', c => runCmAuthHttp(c, null, () => new Hono(), decode));
    expect((await app.request('/test', { method: 'POST', body: 'x'.repeat(65_537) })).status).toBe(413);
    expect(decode).not.toHaveBeenCalled();
    expect(harness.events).toEqual([]);
  });

  it('publishes no provisional cookie when commit acknowledgement is lost', async () => {
    harness.run.mockImplementation(async work => {
      await work({}, { hostTransaction: {} });
      throw new Error('commit acknowledgement lost');
    });
    const response = await request(new Hono().post('/test', c => {
      c.header('set-cookie', 'session=unconfirmed-candidate');
      return c.json({ sessionToken: 'unconfirmed-candidate' });
    }));
    expect(response.status).toBe(503);
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(await response.text()).not.toContain('unconfirmed-candidate');
  });
});
