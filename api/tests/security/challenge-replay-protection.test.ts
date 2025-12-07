import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { app } from '../../src/app';
import { createAuthenticatedUser, cleanupAuthData, generateTestVerificationToken } from '../utils/auth-helper';

describe('Challenge Replay Protection Tests', () => {
  let user: any;

  beforeAll(async () => {
    user = await createAuthenticatedUser();
  });

  afterAll(async () => {
    await cleanupAuthData();
  });

  describe('WebAuthn Challenge Uniqueness', () => {
    it('should generate unique challenges for different users', async () => {
      const challengeIds = [];
      
      // Generate challenges for different users
      for (let i = 0; i < 5; i++) {
        const email = `test-unique-${i}@example.com`;
        const verificationToken = await generateTestVerificationToken(email);
        
        const challengeResponse = await app.request('/api/v1/auth/register/options', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            email,
            verificationToken,
          })
        });

        expect(challengeResponse.status).toBe(200);
        const challengeData = await challengeResponse.json();
        
        // Use challenge string (base64url) as unique identifier
          challengeIds.push(challengeData.options?.challenge || challengeData.challenge);
        
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      
      expect(challengeIds.length).toBe(5);
      const uniqueChallengeIds = new Set(challengeIds);
      expect(uniqueChallengeIds.size).toBe(5);
    });

    it('should generate unique challenges for the same user at different times', async () => {
      const challengeIds = [];
      
      for (let i = 0; i < 3; i++) {
        const challengeResponse = await app.request('/api/v1/auth/login/options', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            email: user.email,
          })
        });

        expect(challengeResponse.status).toBe(200);
        const challengeData = await challengeResponse.json();
        
        // Use challenge string (base64url) as unique identifier
          challengeIds.push(challengeData.options?.challenge || challengeData.challenge);
        
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      
      expect(challengeIds.length).toBe(3);
      const uniqueChallengeIds = new Set(challengeIds);
      expect(uniqueChallengeIds.size).toBe(3);
    });
  });

  describe('Challenge Validation', () => {
    it('should reject malformed challenges', async () => {
      const authResponse = await app.request('/api/v1/auth/login/verify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          credential: {
            id: 'test-credential-id',
            rawId: 'test-raw-id',
            response: {
              authenticatorData: 'test-auth-data',
              clientDataJSON: 'invalid-base64',
              signature: 'test-signature',
              userHandle: 'test-user-handle'
            },
            type: 'public-key'
          }
        })
      });

      expect(authResponse.status).toBe(400);
    });
  });
});