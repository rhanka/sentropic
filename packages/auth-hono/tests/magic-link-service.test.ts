import { describe, expect, it } from 'vitest';

import { createAuthMagicLinkService, type AuthHonoPorts, type AuthHonoUserRecord } from '../src/index.js';

const now = new Date('2026-01-01T00:00:00.000Z');
const expiresAt = new Date('2026-01-01T00:10:00.000Z');

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

const createPorts = (overrides: Partial<AuthHonoPorts> = {}): AuthHonoPorts =>
  ({
    accountPolicy: {
      normalizeEmail: (email: string) => email.trim().toLowerCase(),
    },
    clock: {
      now: () => now,
      addSeconds: (date: Date, seconds: number) => new Date(date.getTime() + seconds * 1000),
    },
    emailDelivery: {
      sendMagicLink: async () => undefined,
    },
    magicLinks: {
      create: async (input) => ({
        id: 'magic-link-1',
        tokenHash: input.tokenHash,
        email: input.email,
        userId: input.userId ?? null,
        expiresAt: input.expiresAt,
        used: false,
        createdAt: input.now,
      }),
      findValidByTokenHash: async () => ({
        id: 'magic-link-1',
        tokenHash: 'hash:magic-token',
        email: user.email ?? 'user@example.com',
        userId: user.id,
        expiresAt,
        used: false,
        createdAt: now,
      }),
      markUsed: async () => undefined,
    },
    random: {
      token: () => 'magic-token',
    },
    tokens: {
      hashSecret: (secret: string) => `hash:${secret}`,
    },
    users: {
      findByEmail: async () => user,
      findById: async () => user,
      update: async () => user,
    },
    ...overrides,
  }) as AuthHonoPorts;

describe('createAuthMagicLinkService', () => {
  it('generates, stores, and delivers a magic link URL', async () => {
    const calls: Array<{ email: string; expiresAt: Date; token: string; url: string }> = [];
    const service = createAuthMagicLinkService({
      baseUrl: 'https://app.example.com',
      ports: createPorts({
        emailDelivery: {
          sendMagicLink: async (input) => {
            calls.push(input);
          },
        },
      } as Partial<AuthHonoPorts>),
    });

    const result = await service.requestMagicLink({ email: ' User@Example.COM ' });

    expect(result).toEqual({
      expiresAt,
      success: true,
    });
    expect(calls).toEqual([
      {
        email: 'user@example.com',
        expiresAt,
        token: 'magic-token',
        url: 'https://app.example.com/auth/magic-link/verify?token=magic-token',
      },
    ]);
  });

  it('verifies a magic link token and marks the link as used', async () => {
    let marked:
      | {
          id: string;
          userId: string | null | undefined;
        }
      | null = null;
    const service = createAuthMagicLinkService({
      baseUrl: 'https://app.example.com',
      ports: createPorts({
        magicLinks: {
          findValidByTokenHash: async () => ({
            id: 'magic-link-1',
            tokenHash: 'hash:magic-token',
            email: 'user@example.com',
            userId: user.id,
            expiresAt,
            used: false,
            createdAt: now,
          }),
          markUsed: async (id, userId) => {
            marked = { id, userId };
          },
        },
      } as Partial<AuthHonoPorts>),
    });

    const result = await service.verifyMagicLink({ token: 'magic-token' });

    expect(result).toEqual({
      email: 'user@example.com',
      user,
      valid: true,
    });
    expect(marked).toEqual({
      id: 'magic-link-1',
      userId: user.id,
    });
  });
});
