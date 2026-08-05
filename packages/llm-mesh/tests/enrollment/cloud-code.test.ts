import { describe, expect, it, vi } from 'vitest';
import {
  CLOUD_CODE_LOAD_CODE_ASSIST_URL,
  CLOUD_CODE_TOKEN_URL,
  CLOUD_CODE_USER_AGENT,
  CloudCodeEnrollmentProvider,
} from '../../src/enrollment/cloud-code.js';

describe('CloudCodeEnrollmentProvider', () => {
  it('starts PKCE enrollment and returns an authorization-url session', async () => {
    const provider = new CloudCodeEnrollmentProvider({
      clientId: 'test-client-id',
      clientSecret: 'test-client-secret',
    });

    const session = await provider.start({
      configRef: 'vault://cloud-code',
      mode: 'portal',
      redirectUri: 'https://sentropic.example.com/oauth/callback',
      ownerScope: 'user_123',
    });

    expect(session.kind).toBe('authorization-url');
    expect(session.enrollmentId).toMatch(/^enr_cc_/);
    expect(session.url).toContain('accounts.google.com');
    expect(session.url).toContain('client_id=test-client-id');
    expect(session.url).toContain('code_challenge_method=S256');
    expect(session.url).toContain('state=');
  });

  it('completes enrollment with token exchange and resolves Cloud Code metadata', async () => {
    const mockFetch = vi.fn(async (url: string | URL | Request, options?: RequestInit) => {
      const urlStr = url.toString();
      if (urlStr.includes('oauth2.googleapis.com/token')) {
        return new Response(
          JSON.stringify({
            access_token: 'test-access-token',
            refresh_token: 'test-refresh-token',
            expires_in: 3600,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      if (urlStr.includes('loadCodeAssist')) {
        expect(options?.headers).toMatchObject({
          Authorization: 'Bearer test-access-token',
          'User-Agent': CLOUD_CODE_USER_AGENT,
        });
        return new Response(
          JSON.stringify({
            cloudaicompanionProject: 'sentropic-cloud-code-proj',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      return new Response('Not found', { status: 404 });
    });

    const provider = new CloudCodeEnrollmentProvider({
      clientId: 'test-client-id',
      clientSecret: 'test-client-secret',
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    const session = await provider.start({
      configRef: 'vault://cloud-code',
      mode: 'portal',
      redirectUri: 'https://sentropic.example.com/oauth/callback',
      ownerScope: 'user_123',
    });

    const cred = await provider.complete({
      enrollmentId: session.enrollmentId,
      code: 'test-auth-code',
    });

    expect(cred.accessToken).toBe('test-access-token');
    expect(cred.refreshToken).toBe('test-refresh-token');

    const meta = await provider.resolve(cred);
    expect(meta.cloudaicompanionProject).toBe('sentropic-cloud-code-proj');
    expect(meta.cloudCodeUserAgentVersion).toBe('1.1.10');
  });

  it('handles cancel idempotently', async () => {
    const provider = new CloudCodeEnrollmentProvider();

    const session = await provider.start({
      configRef: 'vault://cloud-code',
      mode: 'portal',
      redirectUri: 'https://example.com/cb',
      ownerScope: 'test',
    });

    await provider.cancel(session.enrollmentId);
    await provider.cancel(session.enrollmentId); // idempotent second call

    await expect(
      provider.complete({
        enrollmentId: session.enrollmentId,
        code: 'code',
      }),
    ).rejects.toThrow('cancelled');
  });
});
