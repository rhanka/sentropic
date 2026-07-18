import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import {
  ANTIGRAVITY_CLIENT_ID,
  ANTIGRAVITY_MODEL_FLEET,
  buildAntigravityHeaders,
  buildAntigravityRedirectUri,
  exchangeAntigravityAuthorizationCode,
  fetchAntigravityUserInfo,
  generateAntigravityPkcePair,
  loadCodeAssist,
  refreshAntigravityAccessToken,
  startAntigravityAuthorization,
} from '../../src/services/antigravity-provider-auth';

const base64Url = (buf: Buffer): string => buf.toString('base64url');

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('generateAntigravityPkcePair', () => {
  it('derives an S256 challenge from the verifier', () => {
    const { codeVerifier, codeChallenge } = generateAntigravityPkcePair();
    expect(codeVerifier).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(codeChallenge).toBe(base64Url(createHash('sha256').update(codeVerifier).digest()));
  });

  it('returns a fresh verifier on each call', () => {
    expect(generateAntigravityPkcePair().codeVerifier).not.toBe(
      generateAntigravityPkcePair().codeVerifier,
    );
  });
});

describe('startAntigravityAuthorization', () => {
  it('builds a PKCE authorize URL that matches the returned verifier', () => {
    const start = startAntigravityAuthorization({ redirectPort: 8790 });
    const url = new URL(start.authorizeUrl);
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/auth');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('client_id')).toBe(ANTIGRAVITY_CLIENT_ID);
    expect(url.searchParams.get('redirect_uri')).toBe('http://localhost:8790/oauth-callback');
    expect(url.searchParams.get('redirect_uri')).toBe(start.redirectUri);
    expect(url.searchParams.get('state')).toBe(start.state);
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('code_challenge')).toBe(
      base64Url(createHash('sha256').update(start.codeVerifier).digest()),
    );
    const scope = url.searchParams.get('scope') ?? '';
    expect(scope).toContain('https://www.googleapis.com/auth/cloud-platform');
    expect(scope).toContain('https://www.googleapis.com/auth/cclog');
  });
});

describe('buildAntigravityRedirectUri', () => {
  it('uses the loopback oauth-callback path', () => {
    expect(buildAntigravityRedirectUri(9999)).toBe('http://localhost:9999/oauth-callback');
  });
});

describe('exchangeAntigravityAuthorizationCode', () => {
  it('POSTs a form-encoded authorization_code grant and returns tokens', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(String(init?.headers && (init.headers as Record<string, string>)['Content-Type'])).toBe(
        'application/x-www-form-urlencoded',
      );
      const body = new URLSearchParams(String(init?.body ?? ''));
      expect(body.get('grant_type')).toBe('authorization_code');
      expect(body.get('code')).toBe('the-code');
      expect(body.get('code_verifier')).toBe('the-verifier');
      expect(body.get('redirect_uri')).toBe('http://localhost:8790/oauth-callback');
      expect(body.get('client_id')).toBe(ANTIGRAVITY_CLIENT_ID);
      return new Response(
        JSON.stringify({
          access_token: 'ya29-access',
          refresh_token: '1//refresh',
          expires_in: 3599,
          scope: 'https://www.googleapis.com/auth/cloud-platform',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const result = await exchangeAntigravityAuthorizationCode({
      authorizationCode: 'the-code',
      codeVerifier: 'the-verifier',
      redirectPort: 8790,
    });
    expect(result.accessToken).toBe('ya29-access');
    expect(result.refreshToken).toBe('1//refresh');
    expect(result.expiresAt).not.toBeNull();
    expect(result.scope).toBe('https://www.googleapis.com/auth/cloud-platform');
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('throws when the exchange lacks a refresh token', async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ access_token: 'at-1' }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);
    await expect(
      exchangeAntigravityAuthorizationCode({ authorizationCode: 'c', codeVerifier: 'v' }),
    ).rejects.toThrow(/refresh token/i);
  });

  it('throws on a non-ok response', async () => {
    const fetchMock = vi.fn(async () => new Response('nope', { status: 400 }));
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);
    await expect(
      exchangeAntigravityAuthorizationCode({ authorizationCode: 'c', codeVerifier: 'v' }),
    ).rejects.toThrow(/exchange failed \(400\)/i);
  });
});

describe('refreshAntigravityAccessToken', () => {
  it('mints a fresh access token from the stored refresh token (fix 2b)', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = new URLSearchParams(String(init?.body ?? ''));
      expect(body.get('grant_type')).toBe('refresh_token');
      expect(body.get('refresh_token')).toBe('1//stored-refresh');
      expect(body.get('client_id')).toBe(ANTIGRAVITY_CLIENT_ID);
      // Google refresh responses usually omit a new refresh_token.
      return new Response(
        JSON.stringify({ access_token: 'ya29-fresh', expires_in: 3599 }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const result = await refreshAntigravityAccessToken({ refreshToken: '1//stored-refresh' });
    expect(result.accessToken).toBe('ya29-fresh');
    // Stored refresh token is retained when the response omits one.
    expect(result.refreshToken).toBe('1//stored-refresh');
    expect(result.expiresAt).not.toBeNull();
  });

  it('throws on a non-ok refresh response', async () => {
    const fetchMock = vi.fn(async () => new Response('invalid_grant', { status: 400 }));
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);
    await expect(
      refreshAntigravityAccessToken({ refreshToken: 'x' }),
    ).rejects.toThrow(/token refresh failed \(400\)/i);
  });

  it('requires a refresh token', async () => {
    await expect(refreshAntigravityAccessToken({ refreshToken: '   ' })).rejects.toThrow(
      /refresh token is required/i,
    );
  });
});

describe('loadCodeAssist', () => {
  it('discovers the bound project and sends Antigravity headers (fix 2c)', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string>;
      expect(headers['Authorization']).toBe('Bearer ya29-access');
      expect(headers['User-Agent']).toBe('antigravity/0.1.0');
      expect(headers['Client-Metadata']).toContain('ANTIGRAVITY');
      return new Response(
        JSON.stringify({ cloudaicompanionProject: 'proj-123', currentTier: { id: 'free-tier' } }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const result = await loadCodeAssist({ accessToken: 'ya29-access' });
    expect(result.project).toBe('proj-123');
    expect(result.tier).toBe('free-tier');
  });

  it('returns a null project when the backend omits it', async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({}), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);
    const result = await loadCodeAssist({ accessToken: 'ya29-access' });
    expect(result.project).toBeNull();
  });
});

describe('fetchAntigravityUserInfo', () => {
  it('returns the account email/sub for labelling', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ sub: '108', email: 'user@example.com', name: 'User' }), {
          status: 200,
        }),
    );
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);
    const info = await fetchAntigravityUserInfo({ accessToken: 'ya29-access' });
    expect(info.email).toBe('user@example.com');
    expect(info.sub).toBe('108');
  });
});

describe('buildAntigravityHeaders / fleet', () => {
  it('carries the bearer plus the Antigravity identity headers', () => {
    const headers = buildAntigravityHeaders({ accessToken: 'ya29-access' });
    expect(headers.Authorization).toBe('Bearer ya29-access');
    expect(headers['User-Agent']).toBe('antigravity/0.1.0');
    expect(headers['X-Goog-Api-Client']).toContain('antigravity/0.1.0');
    expect(headers['Client-Metadata']).toContain('"ideType":"ANTIGRAVITY"');
  });

  it('exposes the unified multi-model fleet', () => {
    expect(ANTIGRAVITY_MODEL_FLEET).toContain('claude-sonnet-4-6');
    expect(ANTIGRAVITY_MODEL_FLEET).toContain('gpt-oss-120b-medium');
    expect(ANTIGRAVITY_MODEL_FLEET).toContain('gemini-3-pro-high');
  });
});
