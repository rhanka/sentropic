import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import {
  exchangeClaudeCodeAuthorizationCode,
  generateClaudeCodePkcePair,
  parseClaudeCodeAuthorizationInput,
  startClaudeCodeAuthorization,
} from '../../src/services/claude-code-provider-auth';

const base64Url = (buf: Buffer): string => buf.toString('base64url');

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('generateClaudeCodePkcePair', () => {
  it('derives an S256 challenge from the verifier', () => {
    const { codeVerifier, codeChallenge } = generateClaudeCodePkcePair();
    expect(codeVerifier).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(codeChallenge).toBe(base64Url(createHash('sha256').update(codeVerifier).digest()));
  });

  it('returns a fresh verifier on each call', () => {
    expect(generateClaudeCodePkcePair().codeVerifier).not.toBe(
      generateClaudeCodePkcePair().codeVerifier,
    );
  });
});

describe('startClaudeCodeAuthorization', () => {
  it('builds a PKCE authorize URL that matches the returned verifier', () => {
    const start = startClaudeCodeAuthorization();
    const url = new URL(start.authorizeUrl);
    expect(url.origin + url.pathname).toBe('https://claude.ai/oauth/authorize');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('client_id')).toBe('9d1c250a-e61b-44d9-88ed-5944d1962f5e');
    expect(url.searchParams.get('redirect_uri')).toBe(start.redirectUri);
    expect(url.searchParams.get('state')).toBe(start.state);
    expect(url.searchParams.get('code_challenge')).toBe(
      base64Url(createHash('sha256').update(start.codeVerifier).digest()),
    );
    expect(url.searchParams.get('scope')).toContain('user:inference');
  });
});

describe('parseClaudeCodeAuthorizationInput', () => {
  it('splits a code#state paste', () => {
    expect(parseClaudeCodeAuthorizationInput('the-code#the-state')).toEqual({
      authorizationCode: 'the-code',
      state: 'the-state',
    });
  });

  it('accepts a bare code with a null state', () => {
    expect(parseClaudeCodeAuthorizationInput('  the-code  ')).toEqual({
      authorizationCode: 'the-code',
      state: null,
    });
  });

  it('rejects an empty input', () => {
    expect(() => parseClaudeCodeAuthorizationInput('')).toThrow(/authorization code is required/i);
  });
});

describe('exchangeClaudeCodeAuthorizationCode', () => {
  it('POSTs an authorization_code grant and returns tokens', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}'));
      expect(body.grant_type).toBe('authorization_code');
      expect(body.code).toBe('the-code');
      expect(body.code_verifier).toBe('the-verifier');
      expect(body.redirect_uri).toBe('https://console.anthropic.com/oauth/code/callback');
      return new Response(
        JSON.stringify({ access_token: 'at-1', refresh_token: 'rt-1', expires_in: 3600 }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const result = await exchangeClaudeCodeAuthorizationCode({
      authorizationCode: 'the-code',
      codeVerifier: 'the-verifier',
    });
    expect(result.accessToken).toBe('at-1');
    expect(result.refreshToken).toBe('rt-1');
    expect(result.expiresAt).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('throws when the exchange lacks a refresh token', async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ access_token: 'at-1' }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);
    await expect(
      exchangeClaudeCodeAuthorizationCode({ authorizationCode: 'c', codeVerifier: 'v' }),
    ).rejects.toThrow(/refresh token/i);
  });

  it('throws on a non-ok response', async () => {
    const fetchMock = vi.fn(async () => new Response('nope', { status: 400 }));
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);
    await expect(
      exchangeClaudeCodeAuthorizationCode({ authorizationCode: 'c', codeVerifier: 'v' }),
    ).rejects.toThrow(/exchange failed \(400\)/i);
  });
});
