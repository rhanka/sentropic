import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import { createRemoteEvidenceRouter } from '../../../src/routes/auth/remote-evidence';

const body = { version: 'remote-action-v1', kind: 'evidence-request',
  actionId: 'AAAAAAAAAAAAAAAAAAAAAA', targetDigest: 'a'.repeat(64), operation: 'input',
  payloadDigest: 'b'.repeat(64), nonceId: 'nonce', sid: 'login', sessionVersion: 1,
  sessionCredential: 'private-credential' };
function setup(role: 'auth-idp' | 'product' = 'auth-idp', allowed = true) {
  const issue = vi.fn(async () => 'compact.signed.evidence');
  const authenticateWorkload = vi.fn(async () => allowed ? { workload: 'app-authorization' } : null);
  const app = new Hono().route('/api/v1/auth/session/remote-action-evidence',
    createRemoteEvidenceRouter({ role, expectedWorkload: 'app-authorization', authenticateWorkload, issue }));
  const send = (value = JSON.stringify(body), headers = {}) => app.request(
    'https://idp/api/v1/auth/session/remote-action-evidence', { method: 'POST',
      headers: { 'content-type': 'application/json', ...headers }, body: value });
  return { send, issue, authenticateWorkload };
}
describe('RC1 internal evidence boundary', () => {
  it('should return 426 for an unsupported version and 400 for an invalid kind', async () => {
    expect((await setup().send(JSON.stringify({ ...body, version: 'remote-action-v2' }))).status).toBe(426);
    expect((await setup().send(JSON.stringify({ ...body, kind: 'other' }))).status).toBe(400);
  });
  it('should keep the issuing route isolated in the actual application roots', async () => {
    const { app: product } = await import('../../../src/app');
    const { createIdpApp } = await import('../../../../apps/auth-idp/idp-app');
    const path = 'https://idp/api/v1/auth/session/remote-action-evidence';
    const request = { method: 'POST', headers: { 'content-type': 'application/json' }, body: 'invalid' };
    expect((await product.request(path, request)).status).toBe(403);
    expect((await createIdpApp().request(path, request)).status).toBe(401);
  });
  it('should issue evidence only on the authenticated internal IdP route', async () => {
    const { send, issue, authenticateWorkload } = setup();
    const result = await send();
    expect(result.status).toBe(200);
    expect(await result.text()).toBe('compact.signed.evidence');
    expect(result.headers.get('cache-control')).toBe('no-store');
    expect(issue).toHaveBeenCalledWith(body);
    expect(authenticateWorkload).toHaveBeenCalledWith(expect.any(Request));
  });
  it('should refuse product-role issuance before reading the body', async () => {
    const { send, issue, authenticateWorkload } = setup('product');
    expect((await send('invalid')).status).toBe(403);
    expect(issue).not.toHaveBeenCalled();
    expect(authenticateWorkload).not.toHaveBeenCalled();
  });
  it('should authenticate workload before body parsing', async () => {
    const { send, issue } = setup('auth-idp', false);
    expect((await send('invalid')).status).toBe(401);
    expect(issue).not.toHaveBeenCalled();
  });
  it.each([{ origin: 'https://app' }, { cookie: 'session=browser' }])
    ('should refuse browser requests %j', async (headers) => {
      expect((await setup().send(JSON.stringify(body), headers)).status).toBe(403);
    });
  it.each(['{"actionId":"x","actionId":"y"}', JSON.stringify({ ...body, sub: 'forged' }),
    'x'.repeat(8193)])('should reject ambiguous, asserted-identity or oversized bodies', async (value) => {
      const { send, issue } = setup();
      expect([400, 413]).toContain((await send(value)).status);
      expect(issue).not.toHaveBeenCalled();
    });
  it('should return content-free errors without reflecting credentials', async () => {
    const { send, issue } = setup();
    issue.mockRejectedValue(new Error('private-credential'));
    const result = await send();
    expect(result.status).toBe(503);
    expect(await result.text()).not.toContain('private-credential');
    expect(result.headers.get('cache-control')).toBe('no-store');
  });
});
