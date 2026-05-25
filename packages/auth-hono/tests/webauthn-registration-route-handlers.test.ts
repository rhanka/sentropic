import { describe, expect, it } from 'vitest';

import {
  createAuthRouter,
  createAuthWebAuthnRegistrationRouteHandlers,
  type AuthHonoWebAuthnRegistrationService,
} from '../src/index.js';

const credential = {
  id: 'credential-id',
  rawId: 'credential-id',
  response: {
    attestationObject: 'attestation',
    clientDataJSON: btoa(JSON.stringify({ challenge: 'registration-challenge' })),
    transports: ['internal'],
  },
  type: 'public-key',
} as const;

const service = (
  overrides: Partial<AuthHonoWebAuthnRegistrationService> = {}
): AuthHonoWebAuthnRegistrationService => ({
  generateRegistrationOptions: async () =>
    ({
      challenge: 'registration-challenge',
      excludeCredentials: [],
      pubKeyCredParams: [],
      rp: { id: 'app.example.com', name: 'Example App' },
      timeout: 60000,
      user: { displayName: 'User', id: 'user-handle', name: 'user@example.com' },
    }) as Awaited<ReturnType<AuthHonoWebAuthnRegistrationService['generateRegistrationOptions']>>,
  verifyRegistration: async () => ({ credentialId: 'credential-id', verified: true }),
  ...overrides,
});

const router = (registrationService: AuthHonoWebAuthnRegistrationService) =>
  createAuthRouter({
    handlers: createAuthWebAuthnRegistrationRouteHandlers({
      prepareRegistrationOptions: async (input) => ({
        serviceInput: {
          userDisplayName: 'User',
          userName: input.email,
        },
        userId: 'temp-user-1',
      }),
      resolveRegistrationUser: async (input) => ({ userId: input.userId }),
      service: registrationService,
    }),
    routePrefix: '/api/v1/auth',
  });

describe('createAuthWebAuthnRegistrationRouteHandlers', () => {
  it('creates passkey registration options through the registration service', async () => {
    const calls: unknown[] = [];
    const response = await router(
      service({
        generateRegistrationOptions: async (input) => {
          calls.push(input);
          return {
            challenge: 'registration-challenge',
            excludeCredentials: [],
            pubKeyCredParams: [],
            rp: { id: 'app.example.com', name: 'Example App' },
            timeout: 60000,
            user: { displayName: 'User', id: 'user-handle', name: input.userName },
          } as Awaited<ReturnType<AuthHonoWebAuthnRegistrationService['generateRegistrationOptions']>>;
        },
      })
    ).request('/api/v1/auth/register/options', {
      body: JSON.stringify({ email: 'user@example.com', verificationToken: 'token-1' }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });

    expect(response.status).toBe(200);
    expect(calls).toEqual([{ userDisplayName: 'User', userName: 'user@example.com' }]);
    await expect(response.json()).resolves.toMatchObject({
      options: { challenge: 'registration-challenge' },
      userId: 'temp-user-1',
    });
  });

  it('verifies passkey registration with the challenge from clientDataJSON', async () => {
    const calls: unknown[] = [];
    const response = await router(
      service({
        verifyRegistration: async (input) => {
          calls.push(input);
          return { credentialId: 'credential-id', verified: true };
        },
      })
    ).request('/api/v1/auth/register/verify', {
      body: JSON.stringify({
        credential,
        email: 'user@example.com',
        userId: 'temp-user-1',
        verificationToken: 'token-1',
      }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });

    expect(response.status).toBe(200);
    expect(calls).toEqual([
      {
        credential,
        deviceName: undefined,
        expectedChallenge: 'registration-challenge',
        userId: 'temp-user-1',
      },
    ]);
    await expect(response.json()).resolves.toEqual({
      credentialId: 'credential-id',
      success: true,
      userId: 'temp-user-1',
    });
  });

  it('maps registration service errors to HTTP errors', async () => {
    const response = await router(
      service({
        verifyRegistration: async () => ({
          error: {
            code: 'duplicate_credential',
            message: 'Credential is already registered.',
            status: 409,
          },
          verified: false,
        }),
      })
    ).request('/api/v1/auth/register/verify', {
      body: JSON.stringify({
        credential,
        email: 'user@example.com',
        userId: 'temp-user-1',
        verificationToken: 'token-1',
      }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'duplicate_credential',
        message: 'Credential is already registered.',
      },
    });
  });
});
