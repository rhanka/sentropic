import { describe, expect, it, vi } from 'vitest';

import {
  getWebAuthnErrorMessage,
  isPlatformAuthenticatorAvailable,
  isWebAuthnSupported,
  startPasskeyAuthentication,
  startPasskeyRegistration,
} from '../src/index.js';

describe('browser WebAuthn helpers', () => {
  it('reports unsupported browsers without reading the global window', () => {
    expect(isWebAuthnSupported()).toBe(false);
    expect(isWebAuthnSupported({})).toBe(false);
  });

  it('detects PublicKeyCredential support from an injected browser object', () => {
    function PublicKeyCredential() {}

    expect(isWebAuthnSupported({ PublicKeyCredential })).toBe(true);
  });

  it('checks platform authenticator availability through the injected browser object', async () => {
    const isUserVerifyingPlatformAuthenticatorAvailable = vi.fn(async () => true);
    function PublicKeyCredential() {}
    Object.assign(PublicKeyCredential, { isUserVerifyingPlatformAuthenticatorAvailable });

    await expect(isPlatformAuthenticatorAvailable({ PublicKeyCredential })).resolves.toBe(true);
    expect(isUserVerifyingPlatformAuthenticatorAvailable).toHaveBeenCalledOnce();
  });

  it('starts passkey registration through an injectable WebAuthn starter', async () => {
    const startRegistration = vi.fn(async () => ({ id: 'credential-1', response: {} }));
    const options = {
      challenge: 'abc',
      rp: { name: 'Example' },
      user: { id: '1', name: 'a@example.com', displayName: 'A' },
      pubKeyCredParams: [],
    };

    await expect(
      startPasskeyRegistration(options, {
        browser: { PublicKeyCredential: function PublicKeyCredential() {} },
        startRegistration,
      }),
    ).resolves.toEqual({ id: 'credential-1', response: {} });

    expect(startRegistration).toHaveBeenCalledWith({ optionsJSON: options });
  });

  it('starts passkey authentication through an injectable WebAuthn starter', async () => {
    const startAuthentication = vi.fn(async () => ({ id: 'credential-1', response: {} }));
    const options = { challenge: 'abc' };

    await expect(
      startPasskeyAuthentication(options, {
        browser: { PublicKeyCredential: function PublicKeyCredential() {} },
        startAuthentication,
      }),
    ).resolves.toEqual({ id: 'credential-1', response: {} });

    expect(startAuthentication).toHaveBeenCalledWith({ optionsJSON: options });
  });

  it('maps common browser WebAuthn failures to stable package errors', async () => {
    const startAuthentication = vi.fn(async () => {
      throw new DOMException('cancelled', 'NotAllowedError');
    });

    await expect(
      startPasskeyAuthentication(
        { challenge: 'abc' },
        {
          browser: { PublicKeyCredential: function PublicKeyCredential() {} },
          startAuthentication,
        },
      ),
    ).rejects.toMatchObject({
      code: 'passkey_cancelled',
      message: 'Authentication cancelled by user',
      retryable: true,
    });
  });

  it('formats known WebAuthn package errors through optional labels', () => {
    expect(
      getWebAuthnErrorMessage(
        { code: 'passkey_not_supported', message: 'WebAuthn is not supported in this browser' },
        { passkeyNotSupported: 'Use a newer browser' },
      ),
    ).toBe('Use a newer browser');
  });
});
