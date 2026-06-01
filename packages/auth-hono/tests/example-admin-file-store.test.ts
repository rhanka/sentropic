import { describe, expect, it } from 'vitest';

import {
  createAuthEmailVerificationService,
  type AuthHonoAccountPolicyPort,
  type AuthHonoClockPort,
  type AuthHonoCookiePort,
  type AuthHonoCredentialPort,
  type AuthHonoChallengePort,
  type AuthHonoEmailDeliveryPort,
  type AuthHonoEmailVerificationPort,
  type AuthHonoEmailVerificationRecord,
  type AuthHonoMagicLinkPort,
  type AuthHonoPorts,
  type AuthHonoRandomPort,
  type AuthHonoSessionPort,
  type AuthHonoTokenPort,
  type AuthHonoAuditLogPort,
  type AuthHonoUserPort,
} from '../src/index.js';

/**
 * Lot 4 — Consumer-adapter proof.
 *
 * Wires the package services with a complete in-memory `AuthHonoPorts` bundle
 * (no Drizzle / no Postgres / no real network) to prove the package is
 * consumable by DB-less hosts such as `spa-transpose-cv`'s `/admin/auth/*`
 * flow. Ports that the exercised flow does not touch are stubbed with
 * throwing implementations; expanding the test to passkey/magic-link/session
 * flows is a follow-up consumers can copy-paste from this scaffolding.
 */

const fixedNow = new Date('2026-05-30T12:00:00.000Z');

const createMemoryPorts = (sendCalls: Array<{ email: string; code: string }>): AuthHonoPorts => {
  const codes = new Map<string, AuthHonoEmailVerificationRecord>();
  let counter = 0;

  const accountPolicy: AuthHonoAccountPolicyPort = {
    normalizeEmail: (email) => email.trim().toLowerCase(),
    deriveDisplayName: (email) => email.split('@')[0] ?? email,
    roleForNewUser: () => 'guest',
    statusForNewUser: () => ({ accountStatus: 'active', approvalDueAt: null }),
    canAuthenticate: () => ({ allowed: true }),
    resolveSessionRole: (user) => user.role,
  };

  const clock: AuthHonoClockPort = {
    now: () => fixedNow,
    addSeconds: (date, seconds) => new Date(date.getTime() + seconds * 1000),
  };

  const random: AuthHonoRandomPort = {
    uuid: () => `uuid-${++counter}`,
    bytes: (length) => new Uint8Array(length),
    numericCode: (length) => '1'.repeat(length),
    token: (bytes) => `token-${bytes}-${++counter}`,
  };

  const tokens: AuthHonoTokenPort = {
    hashSecret: (secret) => `hash(${secret})`,
    signSessionToken: async () => 'session-token-stub',
    verifySessionToken: async () => null,
    signVerificationToken: async ({ email }) => `verif-${email}`,
  };

  const emailDelivery: AuthHonoEmailDeliveryPort = {
    sendVerificationCode: async ({ code, email }) => {
      sendCalls.push({ code, email });
    },
    sendMagicLink: async () => {
      // not exercised in this proof
    },
  };

  const emailVerification: AuthHonoEmailVerificationPort = {
    countRecent: async (email, since) =>
      Array.from(codes.values()).filter((r) => r.email === email && r.createdAt >= since).length,
    createCode: async ({ codeHash, email, expiresAt, now }) => {
      const record: AuthHonoEmailVerificationRecord = {
        codeHash,
        createdAt: now,
        email,
        expiresAt,
        id: `code-${++counter}`,
        used: false,
        verificationToken: null,
      };
      codes.set(record.id, record);
      return record;
    },
    findLatestValidCode: async (email, codeHash, now) => {
      const matches = Array.from(codes.values()).filter(
        (r) => r.email === email && r.codeHash === codeHash && !r.used && r.expiresAt > now
      );
      return matches.length > 0 ? matches[matches.length - 1] : null;
    },
    markUsedWithVerificationToken: async (id, verificationToken) => {
      const r = codes.get(id);
      if (r) {
        codes.set(id, { ...r, used: true, verificationToken });
      }
    },
    verifyToken: async (email, verificationToken) =>
      Array.from(codes.values()).some(
        (r) => r.email === email && r.verificationToken === verificationToken
      ),
  };

  const notImplemented = (label: string) => () => {
    throw new Error(`memory ports: ${label} not exercised in this consumer proof`);
  };

  const users = {
    findByEmail: notImplemented('users.findByEmail'),
    findById: notImplemented('users.findById'),
    create: notImplemented('users.create'),
    update: notImplemented('users.update'),
    countAdmins: notImplemented('users.countAdmins'),
  } as unknown as AuthHonoUserPort;

  const credentials = {} as AuthHonoCredentialPort;
  const challenges = {} as AuthHonoChallengePort;
  const sessions = {} as AuthHonoSessionPort;
  const magicLinks = {} as AuthHonoMagicLinkPort;
  const cookies = {} as AuthHonoCookiePort;
  const auditLog = { log: async () => undefined } as AuthHonoAuditLogPort;

  return {
    accountPolicy,
    auditLog,
    challenges,
    clock,
    cookies,
    credentials,
    emailDelivery,
    emailVerification,
    magicLinks,
    random,
    sessions,
    tokens,
    users,
  };
};

describe('consumer proof — DB-less email verification e2e with memory ports', () => {
  it('mounts the email verification service with a memory-only AuthHonoPorts bundle', async () => {
    const sendCalls: Array<{ email: string; code: string }> = [];
    const service = createAuthEmailVerificationService({ ports: createMemoryPorts(sendCalls) });

    const requestResult = await service.requestEmailCode({ email: 'Admin@Example.COM' });
    expect(requestResult.success).toBe(true);
    expect(sendCalls).toEqual([{ code: '111111', email: 'admin@example.com' }]);

    const verifyResult = await service.verifyEmailCode({
      code: '111111',
      email: 'admin@example.com',
    });
    expect(verifyResult.valid).toBe(true);
    if (verifyResult.valid) {
      expect(verifyResult.verificationToken).toBe('verif-admin@example.com');
    }
  });

  it('rate-limits requests per the window policy', async () => {
    const sendCalls: Array<{ email: string; code: string }> = [];
    const ports = createMemoryPorts(sendCalls);
    const service = createAuthEmailVerificationService({
      maxRequestsPerWindow: 1,
      ports,
    });

    const first = await service.requestEmailCode({ email: 'user@example.com' });
    expect(first.success).toBe(true);

    const second = await service.requestEmailCode({ email: 'user@example.com' });
    expect(second.success).toBe(false);
    if (!second.success) {
      expect(second.error.code).toBe('rate_limited');
      expect(second.error.status).toBe(429);
    }
  });

  it('rejects verify when the code does not exist', async () => {
    const service = createAuthEmailVerificationService({ ports: createMemoryPorts([]) });
    const result = await service.verifyEmailCode({ code: '999999', email: 'noone@example.com' });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error.status).toBe(400);
    }
  });
});
