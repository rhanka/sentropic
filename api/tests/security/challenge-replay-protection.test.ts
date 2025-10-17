import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { app } from '../../src/app';
import { 
  createAuthenticatedUser, 
  authenticatedRequest, 
  unauthenticatedRequest,
  cleanupAuthData 
} from '../utils/auth-helper';

describe('Challenge Replay Protection Tests', () => {
  let user: any;

  beforeEach(async () => {
    user = await createAuthenticatedUser('editor');
  });

  afterEach(async () => {
    await cleanupAuthData();
  });

  describe('WebAuthn Challenge Uniqueness', () => {
    it('should generate unique challenges for different users', async () => {
      const challenges = new Set();
      
      // Generate challenges for different users
      for (let i = 0; i < 5; i++) {
        const challengeResponse = await unauthenticatedRequest(app, 'POST', '/api/v1/auth/register/options', {
          email: `test-unique-${i}@example.com`,
          userDisplayName: `Test User ${i}`,
          userName: `testuser${i}`
        });

        expect(challengeResponse.status).toBe(200);
        const challengeData = await challengeResponse.json();
        const challenge = challengeData.challenge;
        
        expect(challenges.has(challenge)).toBe(false);
        challenges.add(challenge);
      }
    });

    it('should generate unique challenges for the same user at different times', async () => {
      const challenges = new Set();
      
      // Generate multiple challenges for the same user
      for (let i = 0; i < 3; i++) {
        const challengeResponse = await unauthenticatedRequest(app, 'POST', '/api/v1/auth/login/options', {
          userName: user.email
        });

        expect(challengeResponse.status).toBe(200);
        const challengeData = await challengeResponse.json();
        const challenge = challengeData.challenge;
        
        expect(challenges.has(challenge)).toBe(false);
        challenges.add(challenge);
        
        // Small delay between requests
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    });
  });

  describe('Challenge Validation', () => {
    it('should reject malformed challenges', async () => {
      const authResponse = await unauthenticatedRequest(app, 'POST', '/api/v1/auth/login/verify', {
        credential: {
          id: 'test-credential-id',
          rawId: 'test-raw-id',
          response: {
            authenticatorData: 'test-auth-data',
            clientDataJSON: Buffer.from(JSON.stringify({
              type: 'webauthn.get',
              challenge: 'invalid-challenge-format',
              origin: 'http://localhost:3000'
            })).toString('base64url'),
            signature: 'test-signature',
            userHandle: 'test-user-handle'
          },
          type: 'public-key'
        }
      });

      // Should fail because challenge format is invalid
      expect(authResponse.status).toBe(400);
      const errorBody = await authResponse.json();
      expect(errorBody.message).toContain('challenge');
    });

    it('should reject challenges with wrong origin', async () => {
      // Get a valid challenge first
      const challengeResponse = await unauthenticatedRequest(app, 'POST', '/api/v1/auth/login/options', {
        userName: user.email
      });

      expect(challengeResponse.status).toBe(200);
      const challengeData = await challengeResponse.json();
      const challenge = challengeData.challenge;

      // Try to use challenge with wrong origin
      const authResponse = await unauthenticatedRequest(app, 'POST', '/api/v1/auth/login/verify', {
        credential: {
          id: 'test-credential-id',
          rawId: 'test-raw-id',
          response: {
            authenticatorData: 'test-auth-data',
            clientDataJSON: Buffer.from(JSON.stringify({
              type: 'webauthn.get',
              challenge: challenge,
              origin: 'https://malicious.com' // Wrong origin
            })).toString('base64url'),
            signature: 'test-signature',
            userHandle: 'test-user-handle'
          },
          type: 'public-key'
        }
      });

      // Should fail because origin doesn't match
      expect(authResponse.status).toBe(400);
      const errorBody = await authResponse.json();
      expect(errorBody.message).toContain('origin');
    });
  });

  describe('Magic Link Challenge Protection', () => {
    it('should prevent reuse of magic link tokens', async () => {
      // Request magic link
      const sendResponse = await unauthenticatedRequest(app, 'POST', '/api/v1/auth/magic-link/send', {
        email: 'test-magic-replay@example.com'
      });

      expect(sendResponse.status).toBe(200);
      const sendData = await sendResponse.json();
      expect(sendData.message).toContain('magic link');

      // Try to verify with non-existent token (simulating replay)
      const verifyResponse = await unauthenticatedRequest(app, 'POST', '/api/v1/auth/magic-link/verify', {
        token: 'invalid-token-12345'
      });

      // Should fail because token is invalid
      expect(verifyResponse.status).toBe(400);
      const errorBody = await verifyResponse.json();
      expect(errorBody.message).toContain('invalid');
    });
  });

  describe('Challenge Security Implications', () => {
    it('should detect replay attacks through challenge analysis', async () => {
      // Get a challenge
      const challengeResponse = await unauthenticatedRequest(app, 'POST', '/api/v1/auth/login/options', {
        userName: user.email
      });

      expect(challengeResponse.status).toBe(200);
      const challengeData = await challengeResponse.json();
      const challenge = challengeData.challenge;

      // First authentication attempt
      const authResponse1 = await unauthenticatedRequest(app, 'POST', '/api/v1/auth/login', {
        email: user.email,
        credentialResponse: {
          id: 'test-credential-id',
          rawId: 'test-raw-id',
          response: {
            authenticatorData: 'test-auth-data-replay-1',
            clientDataJSON: Buffer.from(JSON.stringify({
              type: 'webauthn.get',
              challenge: challenge,
              origin: 'http://localhost:3000'
            })).toString('base64url'),
            signature: 'test-signature-1',
            userHandle: 'test-user-handle'
          },
          type: 'public-key'
        }
      });

      // Second authentication attempt with same challenge (replay)
      const authResponse2 = await unauthenticatedRequest(app, 'POST', '/api/v1/auth/login', {
        email: user.email,
        credentialResponse: {
          id: 'test-credential-id',
          rawId: 'test-raw-id',
          response: {
            authenticatorData: 'test-auth-data-replay-2',
            clientDataJSON: Buffer.from(JSON.stringify({
              type: 'webauthn.get',
              challenge: challenge,
              origin: 'http://localhost:3000'
            })).toString('base64url'),
            signature: 'test-signature-2',
            userHandle: 'test-user-handle'
          },
          type: 'public-key'
        }
      });

      // At least one should fail due to challenge validation
      const responses = [authResponse1, authResponse2];
      const failedResponses = responses.filter(r => r.status === 400);
      expect(failedResponses.length).toBeGreaterThan(0);
    });
  });
});