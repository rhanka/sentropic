import { describe, it, expect, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { app } from '../../../src/app';
import { cleanupAuthData, createTestUser, generateTestVerificationToken } from '../../utils/auth-helper';
import { db } from '../../../src/db/client';
import { users } from '../../../src/db/schema';

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
      expect(data.error).toBe('Email verification required');
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
      expect(data.error).toBe('Email verification required');
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
