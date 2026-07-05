import { describe, expect, it } from 'vitest';

import {
  createAuthWebAuthnRegistrationService,
  type AuthHonoPorts,
  type AuthHonoUserRecord,
} from '../src/index.js';

/**
 * BR-39r L4 — pre-persist hook ordering (atomic single-use invite consume).
 * The hook MUST run AFTER WebAuthn verification but BEFORE `credentials.create`; if it throws,
 * NO credential row is created (no orphan), guaranteeing single-use.
 */

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

const credentialInput = {
  credential: {
    id: 'new-credential',
    rawId: 'new-credential',
    response: { attestationObject: 'a', clientDataJSON: 'c', transports: ['internal'] },
    type: 'public-key' as const,
  },
  deviceName: 'Laptop',
  expectedChallenge: 'registration-challenge',
  userId: user.id,
};

const createPorts = (recordCreate: () => void): AuthHonoPorts =>
  ({
    users: { findById: async () => user },
    credentials: {
      findByCredentialId: async () => null,
      create: async (input) => {
        recordCreate();
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
      markUsed: async () => undefined,
    },
    clock: { now: () => now, addSeconds: (d: Date, s: number) => new Date(d.getTime() + s * 1000) },
  }) as unknown as AuthHonoPorts;

const verifiedResponse = async () => ({
  registrationInfo: {
    credential: { counter: 1, id: 'new-credential', publicKey: new Uint8Array([1, 2, 3]) },
    credentialBackedUp: false,
    credentialDeviceType: 'singleDevice' as const,
    userVerified: true,
  },
  verified: true as const,
});

describe('webauthn registration beforePersist hook (BR-39r L4)', () => {
  it('runs beforePersist AFTER verification and BEFORE the credential is created', async () => {
    const events: string[] = [];
    const service = createAuthWebAuthnRegistrationService({
      ports: createPorts(() => events.push('persist')),
      rp: { expectedOrigins: ['https://app.example.com'], id: 'app.example.com', name: 'App' },
      verifyRegistrationResponse: async () => {
        events.push('verify');
        return verifiedResponse();
      },
    });

    const result = await service.verifyRegistration({
      ...credentialInput,
      beforePersist: async () => {
        events.push('consume');
      },
    });

    expect(result).toEqual({ credentialId: 'new-credential', verified: true });
    expect(events).toEqual(['verify', 'consume', 'persist']);
  });

  it('does NOT create a credential when beforePersist throws (no orphan, single-use)', async () => {
    let persisted = 0;
    const service = createAuthWebAuthnRegistrationService({
      ports: createPorts(() => {
        persisted += 1;
      }),
      rp: { expectedOrigins: ['https://app.example.com'], id: 'app.example.com', name: 'App' },
      verifyRegistrationResponse: verifiedResponse,
    });

    await expect(
      service.verifyRegistration({
        ...credentialInput,
        beforePersist: async () => {
          throw new Error('invite_consume_failed');
        },
      }),
    ).rejects.toThrow('invite_consume_failed');

    expect(persisted).toBe(0);
  });

  it('persists normally when no beforePersist hook is supplied (back-compat)', async () => {
    let persisted = 0;
    const service = createAuthWebAuthnRegistrationService({
      ports: createPorts(() => {
        persisted += 1;
      }),
      rp: { expectedOrigins: ['https://app.example.com'], id: 'app.example.com', name: 'App' },
      verifyRegistrationResponse: verifiedResponse,
    });

    const result = await service.verifyRegistration(credentialInput);

    expect(result).toEqual({ credentialId: 'new-credential', verified: true });
    expect(persisted).toBe(1);
  });
});
