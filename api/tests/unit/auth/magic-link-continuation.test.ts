import { createOAuthHmacStateCodec, type OauthClientRecord } from '@sentropic/auth-hono';
import { describe, expect, it, vi } from 'vitest';

import {
  consumeMagicLinkContinuation,
  resolveMagicLinkContinuation,
} from '../../../src/services/auth/magic-link-continuation';

const codec = createOAuthHmacStateCodec({ secret: 'unit-test-secret-0123456789abcdef' });
const now = new Date('2026-06-01T12:00:00.000Z');

const makeClient = (overrides: Partial<OauthClientRecord> = {}): OauthClientRecord => ({
  id: 'client-1',
  clientId: 'keynote-feedbacks',
  clientSecretHash: null,
  name: 'Keynote Feedbacks',
  redirectUris: ['https://dev-mtl-keynote-2026.sent-tech.ca/sondage/callback'],
  allowedScopes: ['openid', 'profile', 'email'],
  grantTypes: ['authorization_code'],
  responseTypes: ['code'],
  tokenEndpointAuthMethod: 'none',
  dpopBoundAccessTokens: false,
  requirePkce: true,
  tenantId: null,
  ownerUserId: null,
  magicLinkSignIn: true,
  createdAt: now,
  updatedAt: now,
  ...overrides,
});

const sealValidContinuation = (clientId = 'keynote-feedbacks', expiresAt = '2026-06-01T12:10:00.000Z') =>
  codec.seal({
    clientId,
    codeChallenge: 'challenge-123',
    codeChallengeMethod: 'S256',
    createdAt: now.toISOString(),
    dpopJkt: null,
    expiresAt,
    nonce: 'nonce-1',
    redirectUri: 'https://dev-mtl-keynote-2026.sent-tech.ca/sondage/callback',
    scope: 'openid email',
    state: 'state-1',
    tenantId: null,
  });

describe('resolveMagicLinkContinuation', () => {
  it('accepts a valid sealed OAuth continue token for a magicLinkSignIn client', async () => {
    const continuation = await sealValidContinuation();
    const result = await resolveMagicLinkContinuation({
      continuation,
      oauthAuthorizePath: '/api/v1/auth/oauth/authorize',
      stateCodec: codec,
      findClient: async () => makeClient(),
      now,
    });

    expect(result).toEqual({
      ok: true,
      continuationUrl: `/api/v1/auth/oauth/authorize?continue=${encodeURIComponent(continuation)}`,
      expiresAt: new Date('2026-06-01T12:10:00.000Z'),
    });
  });

  it('rejects a sealed continue token for a client without magicLinkSignIn', async () => {
    const continuation = await sealValidContinuation('design-system');
    const result = await resolveMagicLinkContinuation({
      continuation,
      oauthAuthorizePath: '/api/v1/auth/oauth/authorize',
      stateCodec: codec,
      findClient: async () => makeClient({ clientId: 'design-system', magicLinkSignIn: false }),
      now,
    });

    expect(result).toMatchObject({ ok: false, code: 'invalid_continuation' });
  });

  it('rejects a sealed continue token for a passkey-fresh ACR client', async () => {
    const continuation = await sealValidContinuation();
    const result = await resolveMagicLinkContinuation({
      continuation,
      oauthAuthorizePath: '/api/v1/auth/oauth/authorize',
      stateCodec: codec,
      findClient: async () => makeClient({ requiredAcr: 'urn:sentropic:loa:passkey-fresh' }),
      now,
    });

    expect(result).toMatchObject({ ok: false, code: 'invalid_continuation' });
  });

  it('rejects tampered or expired continue tokens', async () => {
    const expired = await sealValidContinuation('keynote-feedbacks', '2026-06-01T11:59:00.000Z');
    for (const token of ['tampered.sig', expired]) {
      const result = await resolveMagicLinkContinuation({
        continuation: token,
        oauthAuthorizePath: '/api/v1/auth/oauth/authorize',
        stateCodec: codec,
        findClient: async () => makeClient(),
        now,
      });
      expect(result).toMatchObject({ ok: false, code: 'invalid_continuation' });
    }
  });

  it('accepts allowed relative returnUrl paths and rejects external/unsafe returnUrls', async () => {
    const continuation = await sealValidContinuation();
    for (const safe of [
      '/auth/signed-in',
      '/auth/oauth/consent?state=abc',
      `/oauth/authorize?continue=${encodeURIComponent(continuation)}`,
    ]) {
      const result = await resolveMagicLinkContinuation({
        returnUrl: safe,
        oauthAuthorizePath: '/api/v1/auth/oauth/authorize',
        stateCodec: codec,
        findClient: async () => makeClient(),
        now,
      });
      expect(result.ok).toBe(true);
    }

    for (const unsafe of [
      'https://evil.example/steal',
      '//evil.example/steal',
      '/\\evil.example',
      'javascript:alert(1)',
      '/evil/path',
      '/oauth/authorize?client_id=keynote-feedbacks',
      '/auth/signed-in#frag',
    ]) {
      const result = await resolveMagicLinkContinuation({
        returnUrl: unsafe,
        oauthAuthorizePath: '/api/v1/auth/oauth/authorize',
        stateCodec: codec,
        findClient: async () => makeClient(),
        now,
      });
      expect(result).toMatchObject({ ok: false, code: 'invalid_continuation' });
    }
  });
});

describe('consumeMagicLinkContinuation', () => {
  it('distinguishes valid, expired, and missing continuations', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [{ continuation_url: '/api/v1/auth/oauth/authorize?continue=c1', expires_at: '2026-06-01T12:05:00.000Z' }],
      })
      .mockResolvedValueOnce({
        rows: [{ continuation_url: '/api/v1/auth/oauth/authorize?continue=c2', expires_at: '2026-06-01T11:59:00.000Z' }],
      })
      .mockResolvedValueOnce({ rows: [] });

    await expect(consumeMagicLinkContinuation({ query }, 'hash-1', now)).resolves.toEqual({
      status: 'ok',
      continuationUrl: '/api/v1/auth/oauth/authorize?continue=c1',
    });
    await expect(consumeMagicLinkContinuation({ query }, 'hash-2', now)).resolves.toEqual({
      status: 'expired',
    });
    await expect(consumeMagicLinkContinuation({ query }, 'hash-3', now)).resolves.toEqual({
      status: 'missing',
    });
  });
});
