import { describe, expect, it, vi } from 'vitest';
import { CodexEnrollmentProvider } from '../../src/enrollment/codex.js';

describe('CodexEnrollmentProvider', () => {
  it('starts device flow enrollment and returns device-code session', async () => {
    const mockFetch = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          device_auth_id: 'dev_auth_123',
          user_code: 'ABCD-1234',
          interval: 5,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });

    const provider = new CodexEnrollmentProvider({
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    const session = await provider.start({
      configRef: 'vault://codex',
      mode: 'cli',
      redirectUri: 'http://localhost',
      ownerScope: 'test',
    });

    expect(session.kind).toBe('device-code');
    if (session.kind === 'device-code') {
      expect(session.userCode).toBe('ABCD-1234');
      expect(session.verificationUrl).toContain('codex/device');
    }
  });

  it('polls for completion, handles pending state, and exchanges token on success', async () => {
    let attempts = 0;
    const mockFetch = vi.fn(async (url: string | URL | Request) => {
      const urlStr = url.toString();

      if (urlStr.includes('deviceauth/usercode')) {
        return new Response(
          JSON.stringify({
            device_auth_id: 'dev_auth_456',
            user_code: 'XYZ-789',
            interval: 1,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      if (urlStr.includes('deviceauth/token')) {
        attempts += 1;
        if (attempts === 1) {
          // Pending status 403
          return new Response('Pending', { status: 403 });
        }
        return new Response(
          JSON.stringify({
            authorization_code: 'auth_code_789',
            code_verifier: 'code_verifier_789',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      if (urlStr.includes('oauth/token')) {
        return new Response(
          JSON.stringify({
            access_token: 'codex-access-token',
            refresh_token: 'codex-refresh-token',
            expires_in: 3600,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      return new Response('Not found', { status: 404 });
    });

    const provider = new CodexEnrollmentProvider({
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    const session = await provider.start({
      configRef: 'vault://codex',
      mode: 'cli',
      redirectUri: 'http://localhost',
      ownerScope: 'test',
    });

    const res = await provider.pollForCompletion(session.enrollmentId, 5);
    expect(res.accountId).toMatch(/^acct_codex_/);
    expect(res.label).toContain('Codex Account');
    expect(attempts).toBe(2);
  });
});
