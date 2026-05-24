import { describe, expect, it, vi } from 'vitest';

import {
  assertAuthUiTransport,
  createAuthUiError,
  createDefaultAuthUiBranding,
  createDefaultAuthUiLabels,
  normalizeAuthEmail,
  type AuthUiTransport,
} from '../src/index.js';

const createTransport = (): AuthUiTransport => ({
  requestEmailCode: vi.fn(async () => ({ ok: true, value: { delivery: 'email' } })),
  verifyEmailCode: vi.fn(async () => ({ ok: true, value: { verificationToken: 'verify-token' } })),
  verifyMagicLink: vi.fn(async () => ({ ok: true, value: { user: { id: 'user-1', email: 'a@example.com' } } })),
  createPasskeyRegistrationOptions: vi.fn(async () => ({
    ok: true,
    value: { userId: 'user-1', options: { challenge: 'abc', rp: { name: 'Example' }, user: { id: '1', name: 'a@example.com', displayName: 'A' }, pubKeyCredParams: [] } },
  })),
  verifyPasskeyRegistration: vi.fn(async () => ({ ok: true, value: { user: { id: 'user-1', email: 'a@example.com' } } })),
  createPasskeyAuthenticationOptions: vi.fn(async () => ({ ok: true, value: { options: { challenge: 'abc' } } })),
  verifyPasskeyAuthentication: vi.fn(async () => ({ ok: true, value: { user: { id: 'user-1', email: 'a@example.com' } } })),
  refreshSession: vi.fn(async () => ({ ok: true, value: { user: { id: 'user-1', email: 'a@example.com' } } })),
  logout: vi.fn(async () => ({ ok: true, value: undefined })),
  listCredentials: vi.fn(async () => ({ ok: true, value: { credentials: [] } })),
  renameCredential: vi.fn(async () => ({ ok: true, value: { id: 'credential-1', credentialId: 'public-id', deviceName: 'Laptop', uv: true, createdAt: '2026-05-24T00:00:00.000Z', lastUsedAt: null } })),
  revokeCredential: vi.fn(async () => ({ ok: true, value: undefined })),
});

describe('auth UI contracts', () => {
  it('validates the full host transport shape', () => {
    const transport = createTransport();
    expect(assertAuthUiTransport(transport)).toBe(transport);
  });

  it('rejects incomplete transports before components call them', () => {
    expect(() =>
      assertAuthUiTransport({
        requestEmailCode: async () => ({ ok: true, value: { delivery: 'email' } }),
      }),
    ).toThrow('verifyEmailCode');
  });

  it('normalizes email before host transports receive it', () => {
    expect(normalizeAuthEmail('  USER@Example.COM  ')).toBe('user@example.com');
  });

  it('merges default labels without hardcoding a product name', () => {
    const labels = createDefaultAuthUiLabels({
      loginTitle: 'Sign in to Example',
      registerTitle: 'Create Example account',
    });

    expect(labels.loginButton).toBe('Sign in with passkey');
    expect(labels.loginTitle).toBe('Sign in to Example');
    expect(labels.registerTitle).toBe('Create Example account');
    expect(JSON.stringify(createDefaultAuthUiLabels())).not.toContain('Sentropic');
  });

  it('merges branding tokens while keeping consumers in control of product copy', () => {
    const branding = createDefaultAuthUiBranding({
      productName: 'Example Admin',
      primaryColor: '#0f766e',
    });

    expect(branding.productName).toBe('Example Admin');
    expect(branding.primaryColor).toBe('#0f766e');
    expect(branding.logoAlt).toBe('Example Admin');
  });

  it('creates structured errors for recoverable auth UI states', () => {
    const error = createAuthUiError('passkey_cancelled', 'Authentication cancelled by user', {
      retryable: true,
      cause: new DOMException('cancelled', 'NotAllowedError'),
    });

    expect(error.code).toBe('passkey_cancelled');
    expect(error.retryable).toBe(true);
    expect(error.cause).toBeInstanceOf(DOMException);
    expect(error.message).toBe('Authentication cancelled by user');
  });
});
