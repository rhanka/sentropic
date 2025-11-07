import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  generateChallenge,
  verifyChallenge,
  markChallengeUsed,
  purgeExpiredChallenges,
} from '../../../src/services/challenge-manager';
import { db } from '../../../src/db/client';
import { webauthnChallenges, users } from '../../../src/db/schema';
import { eq } from 'drizzle-orm';

describe('Challenge Manager Service', () => {
  // Clean up challenges after each test
  afterEach(async () => {
    await db.delete(webauthnChallenges);
  });

  describe('generateChallenge', () => {
    it('should generate a valid registration challenge', async () => {
      const challenge = await generateChallenge({
        type: 'registration',
        ttlSeconds: 60,
      });

      expect(challenge).toBeDefined();
      expect(challenge.challenge).toBeDefined();
      expect(challenge.challenge.length).toBeGreaterThan(20); // base64url
      expect(challenge.type).toBe('registration');
      expect(challenge.used).toBe(false);
      expect(challenge.userId).toBeNull();
      
      // Should expire in ~60 seconds
      const expiresIn = challenge.expiresAt.getTime() - Date.now();
      expect(expiresIn).toBeGreaterThan(55000);
      expect(expiresIn).toBeLessThan(65000);
    });

    it('should generate authentication challenge with userId', async () => {
      const userId = crypto.randomUUID();
      await db.insert(users).values({
        id: userId,
        email: `test-${userId}@example.com`,
        displayName: 'Test User',
        role: 'editor',
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      const challenge = await generateChallenge({
        userId,
        type: 'authentication',
        ttlSeconds: 300,
      });

      expect(challenge.userId).toBe(userId);
      expect(challenge.type).toBe('authentication');
      
      // Should expire in ~300 seconds
      const expiresIn = challenge.expiresAt.getTime() - Date.now();
      expect(expiresIn).toBeGreaterThan(295000);
      expect(expiresIn).toBeLessThan(305000);
    });

    it('should use default TTL if not specified', async () => {
      const regChallenge = await generateChallenge({ type: 'registration' });
      // Should expire in ~300 seconds (5 minutes)
      const expiresIn = regChallenge.expiresAt.getTime() - Date.now();
      expect(expiresIn).toBeGreaterThan(295000);
      expect(expiresIn).toBeLessThan(305000);

      const authChallenge = await generateChallenge({ type: 'authentication' });
      const authExpiresIn = authChallenge.expiresAt.getTime() - Date.now();
      expect(authExpiresIn).toBeGreaterThan(295000);
      expect(authExpiresIn).toBeLessThan(305000);
    });
  });

  describe('verifyChallenge', () => {
    it('should verify valid challenge', async () => {
      const challenge = await generateChallenge({ type: 'registration' });
      
      const isValid = await verifyChallenge(
        challenge.challenge,
        undefined,
        'registration'
      );

      expect(isValid).toBe(true);
    });

    it('should reject non-existent challenge', async () => {
      const isValid = await verifyChallenge(
        'non-existent-challenge',
        undefined,
        'registration'
      );

      expect(isValid).toBe(false);
    });

    it('should reject expired challenge', async () => {
      // Create challenge that expires immediately
      const challenge = await generateChallenge({
        type: 'registration',
        ttlSeconds: -1, // Already expired
      });

      const isValid = await verifyChallenge(
        challenge.challenge,
        undefined,
        'registration'
      );

      expect(isValid).toBe(false);
    });

    it('should reject used challenge', async () => {
      const challenge = await generateChallenge({ type: 'registration' });
      
      // Mark as used
      await markChallengeUsed(challenge.challenge);
      
      const isValid = await verifyChallenge(
        challenge.challenge,
        undefined,
        'registration'
      );

      expect(isValid).toBe(false);
    });

    it('should reject challenge with wrong type', async () => {
      const challenge = await generateChallenge({ type: 'registration' });
      
      const isValid = await verifyChallenge(
        challenge.challenge,
        undefined,
        'authentication' // Wrong type
      );

      expect(isValid).toBe(false);
    });

    it('should reject challenge with wrong userId', async () => {
      const userId = crypto.randomUUID();
      await db.insert(users).values({
        id: userId,
        email: `test-${userId}@example.com`,
        displayName: 'Test User',
        role: 'editor',
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      const challenge = await generateChallenge({
        userId,
        type: 'authentication',
      });
      
      const isValid = await verifyChallenge(
        challenge.challenge,
        crypto.randomUUID(), // Different user ID
        'authentication'
      );

      expect(isValid).toBe(false);
    });
  });

  describe('markChallengeUsed', () => {
    it('should mark challenge as used', async () => {
      const challenge = await generateChallenge({ type: 'registration' });
      
      await markChallengeUsed(challenge.challenge);
      
      // Verify it's marked as used in DB
      const [record] = await db
        .select()
        .from(webauthnChallenges)
        .where(eq(webauthnChallenges.challenge, challenge.challenge))
        .limit(1);
      
      expect(record.used).toBe(true);
    });
  });

  describe('purgeExpiredChallenges', () => {
    it('should purge expired challenges', async () => {
      // Create expired challenge
      await generateChallenge({ type: 'registration', ttlSeconds: -60 });
      
      // Create valid challenge
      const valid = await generateChallenge({ type: 'registration', ttlSeconds: 60 });
      
      const purgedCount = await purgeExpiredChallenges();
      
      expect(purgedCount).toBe(1);
      
      // Valid challenge should still exist
      const [stillExists] = await db
        .select()
        .from(webauthnChallenges)
        .where(eq(webauthnChallenges.id, valid.id))
        .limit(1);
      
      expect(stillExists).toBeDefined();
    });

    it('should return 0 if no expired challenges', async () => {
      // Create only valid challenges
      await generateChallenge({ type: 'registration' });
      await generateChallenge({ type: 'authentication' });
      
      const purgedCount = await purgeExpiredChallenges();
      
      expect(purgedCount).toBe(0);
    });
  });
});

