import { createHash } from 'crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  CLOUD_CODE_AUTH_URL,
  CLOUD_CODE_CLIENT_ID,
  CLOUD_CODE_CLIENT_SECRET,
  CLOUD_CODE_LOAD_CODE_ASSIST_URL,
  CLOUD_CODE_TOKEN_URL,
  CLOUD_CODE_USER_AGENT,
  CloudCodeEnrollmentProvider,
} from '../../src/enrollment/cloud-code.js';
import type { ConfigResolver } from '../../src/service/facade.js';

describe('CloudCodeEnrollmentProvider', () => {
  it('matches the captured Antigravity OAuth contract for CLI enrollment', async () => {
    const provider = new CloudCodeEnrollmentProvider({
      configResolver: { async resolveConfig() { return {}; } },
    });

    const session = await provider.start({
      configRef: 'default',
      mode: 'cli',
      redirectUri: 'http://127.0.0.1',
      ownerScope: 'cli:test',
    });

    expect(session.kind).toBe('authorization-url');
    const url = new URL(session.kind === 'authorization-url' ? session.url : '');
    expect(`${url.origin}${url.pathname}`).toBe(CLOUD_CODE_AUTH_URL);
    expect(url.searchParams.get('client_id')).toBe(CLOUD_CODE_CLIENT_ID);
    expect(url.searchParams.get('redirect_uri')).toMatch(
      /^http:\/\/127\.0\.0\.1:\d+\/oauth\/callback$/,
    );
    expect(new Set(url.searchParams.get('scope')?.split(' '))).toEqual(
      new Set([
        'https://www.googleapis.com/auth/cloud-platform',
        'https://www.googleapis.com/auth/userinfo.email',
        'https://www.googleapis.com/auth/userinfo.profile',
        'https://www.googleapis.com/auth/cclog',
        'https://www.googleapis.com/auth/experimentsandconfigs',
        'https://www.googleapis.com/auth/aicode',
        'openid',
      ]),
    );
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(createHash('sha256').update(CLOUD_CODE_CLIENT_SECRET).digest('hex').slice(0, 12)).toBe(
      '1d2f041093fd',
    );

    await provider.cancel(session.enrollmentId);
  });

  it('sends the captured client credential during the default token exchange', async () => {
    const mockFetch = vi.fn(async (_url: string | URL | Request, options?: RequestInit) => {
      const body = new URLSearchParams(String(options?.body));
      expect(body.get('client_id')).toBe(CLOUD_CODE_CLIENT_ID);
      expect(body.get('client_secret')).toBe(CLOUD_CODE_CLIENT_SECRET);
      expect(body.get('redirect_uri')).toBe('https://antigravity.google/oauth-callback');
      expect(body.get('code_verifier')).toBeTruthy();
      return new Response(JSON.stringify({ access_token: 'access', refresh_token: 'refresh' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    const provider = new CloudCodeEnrollmentProvider({
      configResolver: { async resolveConfig() { return {}; } },
      fetchFn: mockFetch as unknown as typeof fetch,
    });
    const session = await provider.start({
      configRef: 'default',
      mode: 'portal',
      redirectUri: 'https://antigravity.google/oauth-callback',
      ownerScope: 'user_123',
    });

    await expect(provider.complete({ enrollmentId: session.enrollmentId, code: 'code' })).resolves
      .toMatchObject({ accessToken: 'access', refreshToken: 'refresh' });
  });

  it('redacts a reflected OAuth client credential from token errors', async () => {
    const clientSecret = `GOCSPX-${'x'.repeat(28)}`;
    const provider = new CloudCodeEnrollmentProvider({
      clientId: 'test-client-id',
      clientSecret,
      fetchFn: vi.fn(async () => new Response(
        JSON.stringify({ error: 'invalid_client', client_secret: clientSecret }),
        { status: 401 },
      )) as unknown as typeof fetch,
    });
    const session = await provider.start({
      mode: 'portal',
      redirectUri: 'https://example.test/oauth/callback',
      ownerScope: 'test',
    });

    const completion = provider.complete({ enrollmentId: session.enrollmentId, code: 'code' });
    await expect(completion).rejects.toThrow('[redacted]');
    await expect(completion).rejects.not.toThrow(clientSecret);
  });

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

  it('falls back to default CLOUD_CODE_CLIENT_ID when configResolver returns empty object', async () => {
    const mockEmptyConfigResolver: ConfigResolver = {
      async resolveConfig() {
        return {};
      },
    };

    const provider = new CloudCodeEnrollmentProvider({
      configResolver: mockEmptyConfigResolver,
    });

    const session = await provider.start({
      configRef: 'default',
      mode: 'portal',
      redirectUri: 'https://sentropic.example.com/oauth/callback',
      ownerScope: 'user_123',
    });

    expect(session.kind).toBe('authorization-url');
    expect(session.url).toContain(
      'client_id=1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com',
    );
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
