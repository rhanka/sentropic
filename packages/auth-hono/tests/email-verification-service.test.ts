import { describe, expect, it } from 'vitest';

import { createAuthEmailVerificationService, type AuthHonoPorts } from '../src/index.js';

const now = new Date('2026-01-01T00:00:00.000Z');
const expiresAt = new Date('2026-01-01T00:10:00.000Z');

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
      sendVerificationCode: async () => undefined,
    },
    emailVerification: {
      countRecent: async () => 0,
      createCode: async (input) => ({
        id: 'email-code-1',
        email: input.email,
        codeHash: input.codeHash,
        verificationToken: null,
        expiresAt: input.expiresAt,
        used: false,
        createdAt: input.now,
      }),
      findLatestValidCode: async () => ({
        id: 'email-code-1',
        email: 'user@example.com',
        codeHash: 'hash:123456',
        verificationToken: null,
        expiresAt,
        used: false,
        createdAt: now,
      }),
      markUsedWithVerificationToken: async () => undefined,
    },
    random: {
      numericCode: () => '123456',
    },
    tokens: {
      hashSecret: (secret: string) => `hash:${secret}`,
      signVerificationToken: async () => 'verification-token',
    },
    ...overrides,
  }) as AuthHonoPorts;

describe('createAuthEmailVerificationService', () => {
  it('generates, stores, and delivers a normalized email code', async () => {
    const calls: Array<{ code: string; email: string; expiresAt: Date }> = [];
    const service = createAuthEmailVerificationService({
      ports: createPorts({
        emailDelivery: {
          sendVerificationCode: async (input) => {
            calls.push(input);
          },
        },
      } as Partial<AuthHonoPorts>),
    });

    const result = await service.requestEmailCode({ email: ' User@Example.COM ' });

    expect(result).toEqual({
      expiresAt,
      success: true,
    });
    expect(calls).toEqual([
      {
        code: '123456',
        email: 'user@example.com',
        expiresAt,
      },
    ]);
  });

  it('returns rate_limited when recent code requests exceed policy', async () => {
    const service = createAuthEmailVerificationService({
      ports: createPorts({
        emailVerification: {
          countRecent: async () => 3,
        },
      } as Partial<AuthHonoPorts>),
    });

    await expect(service.requestEmailCode({ email: 'user@example.com' })).resolves.toEqual({
      error: {
        code: 'rate_limited',
        message: 'Too many verification code requests.',
        status: 429,
      },
      success: false,
    });
  });

  it('verifies a code and returns a validation token', async () => {
    let marked:
      | {
          id: string;
          verificationToken: string;
        }
      | null = null;
    const service = createAuthEmailVerificationService({
      ports: createPorts({
        emailVerification: {
          findLatestValidCode: async () => ({
            id: 'email-code-1',
            email: 'user@example.com',
            codeHash: 'hash:123456',
            verificationToken: null,
            expiresAt,
            used: false,
            createdAt: now,
          }),
          markUsedWithVerificationToken: async (id, verificationToken) => {
            marked = { id, verificationToken };
          },
        },
      } as Partial<AuthHonoPorts>),
    });

    const result = await service.verifyEmailCode({ code: '123456', email: 'user@example.com' });

    expect(result).toEqual({
      valid: true,
      verificationToken: 'verification-token',
    });
    expect(marked).toEqual({
      id: 'email-code-1',
      verificationToken: 'verification-token',
    });
  });
});
