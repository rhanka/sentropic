import { describe, expect, it, vi } from 'vitest';
import {
  CLOUD_CODE_LOAD_CODE_ASSIST_URL,
  CLOUD_CODE_TOKEN_URL,
  CLOUD_CODE_USER_AGENT,
  CloudCodeEnrollmentProvider,
} from '../../src/enrollment/cloud-code.js';
import type { ConfigResolver } from '../../src/service/facade.js';

describe('CloudCodeEnrollmentProvider', () => {
  it('starts PKCE enrollment using configResolver to resolve client_id (P0-1)', async () => {
    const mockConfigResolver: ConfigResolver = {
      async resolveConfig(configRef) {
        return { clientId: `resolved-client-for-${configRef}`, clientSecret: 'resolved-secret' };
      },
    };

    const provider = new CloudCodeEnrollmentProvider({
      configResolver: mockConfigResolver,
    });

    const session = await provider.start({
      configRef: 'vault://cloud-code-prod',
      mode: 'portal',
      redirectUri: 'https://sentropic.example.com/oauth/callback',
      ownerScope: 'user_123',
    });

    expect(session.kind).toBe('authorization-url');
    expect(session.url).toContain('client_id=resolved-client-for-vault%3A%2F%2Fcloud-code-prod');
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
    const provider = new CloudCodeEnrollmentProvider({
      configResolver: { async resolveConfig() { return { clientId: 'test-client-id', clientSecret: 'test-secret' }; } },
    });

    const session = await provider.start({
      configRef: 'vault://cloud-code',
      mode: 'portal',
      redirectUri: 'https://example.com/cb',
      ownerScope: 'test',
    });

    await provider.cancel(session.enrollmentId);
    await provider.cancel(session.enrollmentId);

    await expect(
      provider.complete({
        enrollmentId: session.enrollmentId,
        code: 'code',
      }),
    ).rejects.toThrow('cancelled');
  });
});
