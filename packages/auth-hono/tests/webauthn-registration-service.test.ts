import { describe, expect, it } from 'vitest';

import {
  createAuthWebAuthnRegistrationService,
  type AuthHonoPorts,
  type AuthHonoUserRecord,
} from '../src/index.js';

const now = new Date('2026-01-01T00:00:00.000Z');
const expiresAt = new Date('2026-01-01T00:05:00.000Z');

const user: AuthHonoUserRecord = {
  id: 'user-1',
  email: 'user@example.com',
  displayName: 'User',
  role: 'admin_app',
  emailVerified: true,
  accountStatus: 'active',
  approvalDueAt: null,
  createdAt: now,
  updatedAt: now,
};

const createPorts = (overrides: Partial<AuthHonoPorts> = {}): AuthHonoPorts =>
  ({
    users: {
      findById: async () => user,
    },
    credentials: {
      findByCredentialId: async () => null,
      listForUser: async () => [
        {
          id: 'credential-1',
          userId: user.id,
          credentialId: 'existing-credential',
          publicKey: 'public-key',
          counter: 0,
          transports: ['usb'],
          name: 'Security Key',
          deviceType: null,
          backedUp: null,
          lastUsedAt: null,
          createdAt: now,
          revokedAt: null,
        },
      ],
      create: async (input) => ({
        id: 'credential-2',
        userId: input.userId,
        credentialId: input.credentialId,
        publicKey: input.publicKey,
        counter: input.counter,
        transports: input.transports ?? null,
        name: input.name ?? null,
        deviceType: input.deviceType ?? null,
        backedUp: input.backedUp ?? null,
        lastUsedAt: null,
        createdAt: now,
        revokedAt: null,
      }),
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
        userId: user.id,
        type,
        expiresAt,
        used: false,
        createdAt: now,
      }),
      markUsed: async () => undefined,
    },
    random: {
      token: () => 'registration-challenge',
    },
    accountPolicy: {
      resolveUserVerification: () => 'required',
    },
    clock: {
      now: () => now,
      addSeconds: (date: Date, seconds: number) => new Date(date.getTime() + seconds * 1000),
    },
    ...overrides,
  }) as AuthHonoPorts;

describe('createAuthWebAuthnRegistrationService', () => {
  it('generates registration options with stored challenge and excluded credentials', async () => {
    const service = createAuthWebAuthnRegistrationService({
      ports: createPorts(),
      rp: {
        expectedOrigins: ['https://app.example.com'],
        id: 'app.example.com',
        name: 'Example App',
      },
    });

    const options = await service.generateRegistrationOptions({
      userDisplayName: 'User',
      userId: user.id,
      userName: 'user@example.com',
    });

    expect(options.challenge).toBe('registration-challenge');
    expect(options.rp).toEqual({ id: 'app.example.com', name: 'Example App' });
    expect(options.excludeCredentials).toEqual([
      { id: 'existing-credential', transports: ['usb'], type: 'public-key' },
    ]);
    expect(options.authenticatorSelection?.userVerification).toBe('required');
  });

  it('verifies registration and stores the credential through ports', async () => {
    let createdCredential: unknown = null;
    let markedChallenge: string | null = null;
    const service = createAuthWebAuthnRegistrationService({
      ports: createPorts({
        credentials: {
          findByCredentialId: async () => null,
          create: async (input) => {
            createdCredential = input;
            return {
              id: 'credential-2',
              userId: input.userId,
              credentialId: input.credentialId,
              publicKey: input.publicKey,
              counter: input.counter,
              transports: input.transports ?? null,
              name: input.name ?? null,
              deviceType: input.deviceType ?? null,
              backedUp: input.backedUp ?? null,
              lastUsedAt: null,
              createdAt: now,
              revokedAt: null,
            };
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
      verifyRegistrationResponse: async () => ({
        registrationInfo: {
          credential: {
            counter: 4,
            id: 'new-credential',
            publicKey: new Uint8Array([1, 2, 3]),
          },
          credentialBackedUp: false,
          credentialDeviceType: 'singleDevice',
          userVerified: true,
        },
        verified: true,
      }),
    });

    const result = await service.verifyRegistration({
      credential: {
        id: 'new-credential',
        rawId: 'new-credential',
        response: {
          attestationObject: 'attestation',
          clientDataJSON: 'client-data',
          transports: ['internal'],
        },
        type: 'public-key',
      },
      deviceName: 'Laptop',
      expectedChallenge: 'registration-challenge',
      userId: user.id,
    });

    expect(result).toEqual({
      credentialId: 'new-credential',
      verified: true,
    });
    expect(createdCredential).toEqual({
      backedUp: false,
      counter: 4,
      credentialId: 'new-credential',
      deviceType: 'singleDevice',
      name: 'Laptop',
      publicKey: new Uint8Array([1, 2, 3]),
      transports: ['internal'],
      userId: user.id,
    });
    expect(markedChallenge).toBe('registration-challenge');
  });
});
