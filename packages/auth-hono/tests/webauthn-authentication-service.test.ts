import { describe, expect, it } from 'vitest';

import {
  createAuthWebAuthnAuthenticationService,
  type AuthHonoCredentialRecord,
  type AuthHonoPorts,
  type AuthHonoUserRecord,
} from '../src/index.js';

const now = new Date('2026-01-01T00:00:00.000Z');
const expiresAt = new Date('2026-01-01T00:05:00.000Z');

const user: AuthHonoUserRecord = {
  id: 'user-1',
  email: 'user@example.com',
  displayName: 'User',
  role: 'editor',
  emailVerified: true,
  accountStatus: 'active',
  approvalDueAt: null,
  createdAt: now,
  updatedAt: now,
};

const credential: AuthHonoCredentialRecord = {
  id: 'credential-record-1',
  userId: user.id,
  credentialId: 'credential-id',
  publicKey: new Uint8Array([1, 2, 3]),
  counter: 2,
  transports: ['internal'],
  name: 'Laptop',
  deviceType: null,
  backedUp: null,
  lastUsedAt: null,
  createdAt: now,
  revokedAt: null,
};

const createPorts = (overrides: Partial<AuthHonoPorts> = {}): AuthHonoPorts =>
  ({
    users: {
      findById: async () => user,
    },
    credentials: {
      findByCredentialId: async () => credential,
      listForUser: async () => [credential],
      updateCounter: async () => undefined,
    },
    challenges: {
      create: async (input) => ({
        id: 'challenge-1',
        challenge: input.challenge,
        userId: input.userId ?? null,
        type: input.type,
        expiresAt: input.expiresAt,
        used: false,
        createdAt: now,
      }),
      findValid: async (challenge, type) => ({
        id: 'challenge-1',
        challenge,
        userId: null,
        type,
        expiresAt,
        used: false,
        createdAt: now,
      }),
      markUsed: async () => undefined,
    },
    random: {
      token: () => 'authentication-challenge',
    },
    accountPolicy: {
      resolveUserVerification: () => 'preferred',
    },
    clock: {
      now: () => now,
      addSeconds: (date: Date, seconds: number) => new Date(date.getTime() + seconds * 1000),
    },
    ...overrides,
  }) as AuthHonoPorts;

describe('createAuthWebAuthnAuthenticationService', () => {
  it('generates discoverable authentication options without allowCredentials', async () => {
    const service = createAuthWebAuthnAuthenticationService({
      ports: createPorts(),
      rp: {
        expectedOrigins: ['https://app.example.com'],
        id: 'app.example.com',
        name: 'Example App',
      },
    });

    const options = await service.generateAuthenticationOptions({});

    expect(options.challenge).toBe('authentication-challenge');
    expect(options.rpId).toBe('app.example.com');
    expect(options.allowCredentials).toBeUndefined();
    expect(options.userVerification).toBe('preferred');
  });

  it('generates user-scoped authentication options with allowed credentials', async () => {
    const service = createAuthWebAuthnAuthenticationService({
      ports: createPorts(),
      rp: {
        expectedOrigins: ['https://app.example.com'],
        id: 'app.example.com',
        name: 'Example App',
      },
    });

    const options = await service.generateAuthenticationOptions({ userId: user.id });

    expect(options.allowCredentials).toEqual([
      { id: 'credential-id', transports: ['internal'], type: 'public-key' },
    ]);
  });

  it('verifies authentication, updates the counter, and marks the challenge as used', async () => {
    let counterUpdate: unknown = null;
    let markedChallenge: string | null = null;
    const service = createAuthWebAuthnAuthenticationService({
      ports: createPorts({
        credentials: {
          findByCredentialId: async () => credential,
          updateCounter: async (credentialId, counter, lastUsedAt) => {
            counterUpdate = { counter, credentialId, lastUsedAt };
          },
        },
        challenges: {
          findValid: async (challenge, type) => ({
            id: 'challenge-1',
            challenge,
            userId: user.id,
            type,
            expiresAt,
            used: false,
            createdAt: now,
          }),
          markUsed: async (challenge) => {
            markedChallenge = challenge;
          },
        },
      } as Partial<AuthHonoPorts>),
      rp: {
        expectedOrigins: ['https://app.example.com'],
        id: 'app.example.com',
        name: 'Example App',
      },
      verifyAuthenticationResponse: async () => ({
        authenticationInfo: {
          newCounter: 5,
          userVerified: true,
        },
        verified: true,
      }),
    });

    const result = await service.verifyAuthentication({
      credential: {
        id: 'credential-id',
        rawId: 'credential-id',
        response: {
          authenticatorData: 'authenticator-data',
          clientDataJSON: 'client-data',
          signature: 'signature',
        },
        type: 'public-key',
      },
      expectedChallenge: 'authentication-challenge',
    });

    expect(result).toEqual({
      credentialId: 'credential-id',
      userId: user.id,
      verified: true,
    });
    expect(counterUpdate).toEqual({
      counter: 5,
      credentialId: 'credential-id',
      lastUsedAt: now,
    });
    expect(markedChallenge).toBe('authentication-challenge');
  });
});
