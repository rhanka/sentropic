import { describe, expect, it } from 'vitest';

import {
  createAuthRouter,
  createAuthWebAuthnAuthenticationRouteHandlers,
  type AuthHonoWebAuthnAuthenticationService,
} from '../src/index.js';

const credential = {
  id: 'credential-id',
  rawId: 'credential-id',
  response: {
    authenticatorData: 'authenticator-data',
    clientDataJSON: btoa(JSON.stringify({ challenge: 'authentication-challenge' })),
    signature: 'signature',
  },
  type: 'public-key',
} as const;

const service = (
  overrides: Partial<AuthHonoWebAuthnAuthenticationService> = {}
): AuthHonoWebAuthnAuthenticationService => ({
  generateAuthenticationOptions: async () =>
    ({
      challenge: 'authentication-challenge',
      rpId: 'app.example.com',
      timeout: 300000,
      userVerification: 'preferred',
    }) as Awaited<ReturnType<AuthHonoWebAuthnAuthenticationService['generateAuthenticationOptions']>>,
  verifyAuthentication: async () => ({
    credentialId: 'credential-id',
    userId: 'user-1',
    verified: true,
  }),
  ...overrides,
});

const router = (authenticationService: AuthHonoWebAuthnAuthenticationService) =>
  createAuthRouter({
    handlers: createAuthWebAuthnAuthenticationRouteHandlers({
      resolveAuthenticationOptions: async (input) => ({
        userId: input.email ? 'user-1' : undefined,
      }),
      service: authenticationService,
    }),
    routePrefix: '/api/v1/auth',
  });

describe('createAuthWebAuthnAuthenticationRouteHandlers', () => {
  it('creates user-scoped passkey authentication options through the service', async () => {
    const calls: unknown[] = [];
    const response = await router(
      service({
        generateAuthenticationOptions: async (input) => {
          calls.push(input);
          return {
            challenge: 'authentication-challenge',
            rpId: 'app.example.com',
            timeout: 300000,
            userVerification: 'preferred',
          } as Awaited<ReturnType<AuthHonoWebAuthnAuthenticationService['generateAuthenticationOptions']>>;
        },
      })
    ).request('/api/v1/auth/login/options', {
      body: JSON.stringify({ email: 'user@example.com' }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });

    expect(response.status).toBe(200);
    expect(calls).toEqual([{ userId: 'user-1' }]);
    await expect(response.json()).resolves.toEqual({
      options: {
        challenge: 'authentication-challenge',
        rpId: 'app.example.com',
        timeout: 300000,
        userVerification: 'preferred',
      },
    });
  });

  it('verifies passkey authentication with the challenge from clientDataJSON', async () => {
    const calls: unknown[] = [];
    const response = await router(
      service({
        verifyAuthentication: async (input) => {
          calls.push(input);
          return {
            credentialId: 'credential-id',
            userId: 'user-1',
            verified: true,
          };
        },
      })
    ).request('/api/v1/auth/login/verify', {
      body: JSON.stringify({ credential }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });

    expect(response.status).toBe(200);
    expect(calls).toEqual([{ credential, expectedChallenge: 'authentication-challenge' }]);
    await expect(response.json()).resolves.toEqual({
      credentialId: 'credential-id',
      success: true,
      userId: 'user-1',
    });
  });

  it('maps authentication service errors to HTTP errors', async () => {
    const response = await router(
      service({
        verifyAuthentication: async () => ({
          error: {
            code: 'credential_not_found',
            message: 'Credential was not found.',
            status: 401,
          },
          verified: false,
        }),
      })
    ).request('/api/v1/auth/login/verify', {
      body: JSON.stringify({ credential }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'credential_not_found',
        message: 'Credential was not found.',
      },
    });
  });
});
