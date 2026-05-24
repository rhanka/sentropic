import { describe, expect, it } from 'vitest';

import {
  AUTH_HONO_AUTH_UI_METHODS,
  AUTH_HONO_REQUIRED_PORTS,
  AUTH_HONO_ROUTE_MAP,
} from '../src/index.js';

describe('@sentropic/auth-hono contracts', () => {
  it('tracks the BR-39a AuthUiTransport method surface', () => {
    expect(AUTH_HONO_AUTH_UI_METHODS).toEqual([
      'requestEmailCode',
      'verifyEmailCode',
      'verifyMagicLink',
      'createPasskeyRegistrationOptions',
      'verifyPasskeyRegistration',
      'createPasskeyAuthenticationOptions',
      'verifyPasskeyAuthentication',
      'refreshSession',
      'logout',
      'listCredentials',
      'renameCredential',
      'revokeCredential',
    ]);
  });

  it('maps AuthUiTransport methods to stable Hono route contracts', () => {
    expect(AUTH_HONO_ROUTE_MAP.requestEmailCode).toEqual({
      method: 'POST',
      path: '/email/verify-request',
    });
    expect(AUTH_HONO_ROUTE_MAP.verifyPasskeyRegistration).toEqual({
      method: 'POST',
      path: '/register/verify',
    });
    expect(AUTH_HONO_ROUTE_MAP.renameCredential).toEqual({
      method: 'PUT',
      path: '/credentials/:id',
    });
  });

  it('declares the required adapter ports for app-owned infrastructure', () => {
    expect(AUTH_HONO_REQUIRED_PORTS).toEqual([
      'users',
      'credentials',
      'challenges',
      'sessions',
      'emailVerification',
      'magicLinks',
      'emailDelivery',
      'cookies',
      'tokens',
      'auditLog',
      'clock',
      'random',
      'accountPolicy',
    ]);
  });
});
