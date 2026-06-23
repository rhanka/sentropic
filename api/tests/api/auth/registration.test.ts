import { describe, it, expect, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { app } from '../../../src/app';
import { cleanupAuthData, createTestUser, generateTestVerificationToken } from '../../utils/auth-helper';
import { db } from '../../../src/db/client';
import { authInviteTokens, users } from '../../../src/db/schema';
import { hashInviteToken } from '../../../src/services/auth/invite-store-adapter';

const uuidRegex = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const uniqueEmail = (prefix: string) => `${prefix}-${randomUUID().slice(0, 8)}@example.com`;

describe('Registration API Routes', () => {
  afterEach(async () => {
    await cleanupAuthData();
  });

  describe('POST /api/v1/auth/register/options', () => {
    it('should generate registration options for new user with verification token', async () => {
      const email = uniqueEmail('newuser');
      const verificationToken = await generateTestVerificationToken(email);

      const res = await app.request('/api/v1/auth/register/options', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          verificationToken,
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();

      expect(data.options).toBeDefined();
      expect(uuidRegex.test(data.userId)).toBe(true);
      expect(data.options.user.name).toBe(email);
      expect(data.options.user.displayName).toContain('Newuser');
    });

    it('should reject registration options for new user without verification token', async () => {
      const email = uniqueEmail('newuser');
      const res = await app.request('/api/v1/auth/register/options', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
        }),
      });

      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error.code).toBe('email_verification_required');
    });

    it('should reuse existing verified user identified by email', async () => {
      const email = uniqueEmail('existing');
      await createTestUser({
        email,
        displayName: 'Existing User',
        emailVerified: true,
      });

      const res = await app.request('/api/v1/auth/register/options', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(uuidRegex.test(data.userId)).toBe(true);
    });

    it('should reject registration for existing unverified user', async () => {
      const email = uniqueEmail('existing');
      await createTestUser({
        email,
        displayName: 'Existing User',
        emailVerified: false,
      });

      const res = await app.request('/api/v1/auth/register/options', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
        }),
      });

      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error.code).toBe('email_verification_required');
    });

    it('should reuse legacy user without email when local part matches displayName', async () => {
      const legacyId = randomUUID();
      const localPart = `legacy-${randomUUID().slice(0, 8)}`;
      await db.insert(users).values({
        id: legacyId,
        email: null,
        displayName: localPart,
        role: 'guest',
        emailVerified: true, // Legacy users are considered verified
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const res = await app.request('/api/v1/auth/register/options', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: `${localPart}@example.com`,
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.userId).toBe(legacyId);
    });

    it('should create admin_app user when ADMIN_EMAIL matches and no admin exists', async () => {
      const adminEmail = process.env.ADMIN_EMAIL || 'admin@test.com';
      const verificationToken = await generateTestVerificationToken(adminEmail);
      
      const res = await app.request('/api/v1/auth/register/options', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: adminEmail,
          verificationToken,
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(uuidRegex.test(data.userId)).toBe(true);
    });

    it('should reject empty email', async () => {
      const res = await app.request('/api/v1/auth/register/options', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: '' }),
      });

      expect(res.status).toBe(400);
    });

    it('should reject invalid email', async () => {
      const res = await app.request('/api/v1/auth/register/options', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'invalid-email' }),
      });

      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/v1/auth/register/verify', () => {
    it('should reject verification with invalid credential response', async () => {
      const email = uniqueEmail('test');
      const verificationToken = await generateTestVerificationToken(email);
      
      const res = await app.request('/api/v1/auth/register/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          verificationToken,
          userId: randomUUID(),
          credential: {
            id: 'invalid-credential',
            response: null,
          },
        }),
      });

      expect(res.status).toBe(400);
    });

    it('should reject verification without credential', async () => {
      const email = uniqueEmail('test');
      const verificationToken = await generateTestVerificationToken(email);
      
      const res = await app.request('/api/v1/auth/register/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          verificationToken,
          userId: randomUUID(),
        }),
      });

      expect(res.status).toBe(400);
    });

    it('should reject verification without verification token for new user', async () => {
      const email = uniqueEmail('newuser');
      const res = await app.request('/api/v1/auth/register/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          userId: randomUUID(),
          credential: { id: 'test' },
        }),
      });

      expect(res.status).toBe(400);
    });

    it('should reject verification with invalid userId format', async () => {
      const email = uniqueEmail('test');
      const verificationToken = await generateTestVerificationToken(email);
      
      const res = await app.request('/api/v1/auth/register/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          verificationToken,
          userId: 'not-a-uuid',
          credential: { id: 'test' },
        }),
      });

      expect(res.status).toBe(400);
    });
  });
});

/**
 * BR-39r L4 — invitation-token registration (C3 no account-enumeration).
 * Every invalid invite state (unknown / expired / consumed / email-mismatch) must produce the
 * SAME public behavior as a cold register with no proof: the generic `email_verification_required`
 * (403) — never a distinct `invalid_invite` signal. A valid invite for a new email is proof and
 * yields registration options (the email-code step is skipped).
 */
describe('Registration API — invitation tokens (BR-39r L4, C3 no-enum)', () => {
  const future = () => new Date(Date.now() + 60 * 60 * 1000);
  const past = () => new Date(Date.now() - 60 * 60 * 1000);

  const seedInvite = async (input: {
    token: string;
    email: string;
    expiresAt: Date;
    consumedAt?: Date | null;
  }): Promise<void> => {
    await db.insert(authInviteTokens).values({
      id: randomUUID(),
      tokenHash: hashInviteToken(input.token),
      email: input.email,
      clientId: null,
      expiresAt: input.expiresAt,
      consumedAt: input.consumedAt ?? null,
      consumedByUserId: null,
      createdAt: new Date(),
    });
  };

  afterEach(async () => {
    await db.delete(authInviteTokens);
    await cleanupAuthData();
  });

  const optionsRequest = (email: string, verificationToken?: string) =>
    app.request('/api/v1/auth/register/options', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(verificationToken ? { email, verificationToken } : { email }),
    });

  // The C3 reference: a cold register with no token for a new user.
  const expectGenericFallback = async (res: Response) => {
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.error.code).toBe('email_verification_required');
    expect(data.error.code).not.toBe('invalid_invite');
  };

  it('a VALID invite for a new email yields registration options (email step skipped)', async () => {
    const email = uniqueEmail('invited');
    const token = `sit_${randomUUID()}`;
    await seedInvite({ token, email, expiresAt: future() });

    const res = await optionsRequest(email, token);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(uuidRegex.test(data.userId)).toBe(true);
  });

  it('a VALID invite for an EXISTING-UNVERIFIED user proceeds (the invite stands in for the email code)', async () => {
    const email = uniqueEmail('existing-unverified');
    await createTestUser({ email, displayName: 'Existing Unverified', emailVerified: false });
    const token = `sit_${randomUUID()}`;
    await seedInvite({ token, email, expiresAt: future() });

    const res = await optionsRequest(email, token);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(uuidRegex.test(data.userId)).toBe(true);
  });

  // C3 ORACLE (the gap the previous tests missed): an INVALID `sit_` token for an EXISTING VERIFIED
  // email must be byte-identical (status + body) to the same token for an UNKNOWN email. Before the
  // remediation, the existing-verified user short-circuited to 200 options (account enumeration).
  it('an INVALID invite for an EXISTING-VERIFIED email is indistinguishable from an UNKNOWN email', async () => {
    const existingVerifiedEmail = uniqueEmail('existing-verified');
    await createTestUser({ email: existingVerifiedEmail, displayName: 'Existing Verified', emailVerified: true });

    const invalidToken = `sit_${randomUUID()}`; // unknown/never-seeded → invalid for any email
    const existingRes = await optionsRequest(existingVerifiedEmail, invalidToken);
    const unknownRes = await optionsRequest(uniqueEmail('unknown'), invalidToken);

    expect(existingRes.status).toBe(unknownRes.status);
    expect(existingRes.status).toBe(403);
    const existingBody = await existingRes.json();
    const unknownBody = await unknownRes.json();
    expect(existingBody).toEqual(unknownBody);
    expect(existingBody.error.code).toBe('email_verification_required');
    expect(existingBody.error.code).not.toBe('invalid_invite');
  });

  it('an invite bound to a DIFFERENT email is indistinguishable for existing-verified vs unknown emails', async () => {
    const existingVerifiedEmail = uniqueEmail('existing-verified');
    await createTestUser({ email: existingVerifiedEmail, displayName: 'Existing Verified', emailVerified: true });
    const token = `sit_${randomUUID()}`;
    await seedInvite({ token, email: uniqueEmail('bound-elsewhere'), expiresAt: future() });

    const existingRes = await optionsRequest(existingVerifiedEmail, token);
    const unknownRes = await optionsRequest(uniqueEmail('unknown'), token);

    expect(existingRes.status).toBe(unknownRes.status);
    expect(existingRes.status).toBe(403);
    expect(await existingRes.json()).toEqual(await unknownRes.json());
  });

  it('an UNKNOWN invite token → generic fallback (identical to a cold register)', async () => {
    const email = uniqueEmail('invited');
    const res = await optionsRequest(email, `sit_${randomUUID()}`);
    await expectGenericFallback(res);
  });

  it('an EXPIRED invite → generic fallback', async () => {
    const email = uniqueEmail('invited');
    const token = `sit_${randomUUID()}`;
    await seedInvite({ token, email, expiresAt: past() });
    await expectGenericFallback(await optionsRequest(email, token));
  });

  it('an already-CONSUMED invite → generic fallback', async () => {
    const email = uniqueEmail('invited');
    const token = `sit_${randomUUID()}`;
    await seedInvite({ token, email, expiresAt: future(), consumedAt: new Date() });
    await expectGenericFallback(await optionsRequest(email, token));
  });

  it('an invite bound to a DIFFERENT email → generic fallback (no enumeration)', async () => {
    const requestedEmail = uniqueEmail('invited');
    const token = `sit_${randomUUID()}`;
    await seedInvite({ token, email: uniqueEmail('other'), expiresAt: future() });
    await expectGenericFallback(await optionsRequest(requestedEmail, token));
  });

  it('all invalid invite states are indistinguishable from the no-token cold register', async () => {
    const email = uniqueEmail('invited');
    const coldRegister = await optionsRequest(email);
    const unknownInvite = await optionsRequest(uniqueEmail('invited'), `sit_${randomUUID()}`);

    expect(unknownInvite.status).toBe(coldRegister.status);
    expect((await unknownInvite.json()).error.code).toBe((await coldRegister.json()).error.code);
  });
});
