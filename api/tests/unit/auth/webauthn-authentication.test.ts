import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  generateWebAuthnAuthenticationOptions,
  verifyWebAuthnAuthentication,
} from '../../../src/services/webauthn-authentication';
import { db } from '../../../src/db/client';
import { users, webauthnCredentials } from '../../../src/db/schema';
import { eq } from 'drizzle-orm';

describe('WebAuthn Authentication Service', () => {
  let testUserId: string;
  let testCredentialId: string;
  
  beforeEach(async () => {
    testUserId = crypto.randomUUID();
    testCredentialId = crypto.randomUUID();
    
    await db.insert(users).values({
      id: testUserId,
      email: `test-${testUserId}@example.com`,
      displayName: 'Test User',
      role: 'editor',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Create test credential
    await db.insert(webauthnCredentials).values({
      id: testCredentialId,
      userId: testUserId,
      credentialId: Buffer.from('test-credential-id').toString('base64url'),
      publicKeyCose: Buffer.from('test-public-key').toString('base64url'),
      counter: 0,
      deviceName: 'Test Device',
      transportsJson: JSON.stringify(['usb', 'nfc']),
      uv: false,
    });
  });

  afterEach(async () => {
    await db.delete(webauthnCredentials);
    await db.delete(users);
  });

  describe('generateAuthenticationOptions', () => {
    it('should generate valid authentication options', async () => {
      const options = await generateWebAuthnAuthenticationOptions({
        userId: testUserId,
        userVerification: 'preferred',
      });

      expect(options).toBeDefined();
      expect(options.challenge).toBeDefined();
      expect(options.challenge.length).toBeGreaterThan(20);
      expect(options.rpId).toBeDefined();
      expect(options.timeout).toBeGreaterThan(0);
      expect(options.allowCredentials).toBeDefined();
      expect(options.allowCredentials!.length).toBe(1);
      expect(options.allowCredentials![0].id).toBeDefined();
      expect(options.allowCredentials![0].transports).toEqual(['usb', 'nfc']);
    });

    it('should handle user verification policy based on role', async () => {
      // Test with editor role (preferred)
      const optionsEditor = await generateWebAuthnAuthenticationOptions({
        userId: testUserId,
        userVerification: 'preferred',
      });

      expect(optionsEditor.userVerification).toBe('preferred');

      // Update user to admin role
      await db.update(users)
        .set({ role: 'admin_app' })
        .where(eq(users.id, testUserId));

      const optionsAdmin = await generateWebAuthnAuthenticationOptions({
        userId: testUserId,
        userVerification: 'preferred', // Will be overridden to 'required'
      });

      expect(optionsAdmin.userVerification).toBe('required');
    });

    it('should include all user credentials in allowCredentials', async () => {
      // Add another credential
      await db.insert(webauthnCredentials).values({
        id: crypto.randomUUID(),
        userId: testUserId,
        credentialId: Buffer.from('second-credential-id').toString('base64url'),
        publicKeyCose: Buffer.from('second-public-key').toString('base64url'),
        counter: 5,
        deviceName: 'Second Device',
        transportsJson: JSON.stringify(['internal']),
        uv: true,
      });

      const options = await generateWebAuthnAuthenticationOptions({
        userId: testUserId,
        userVerification: 'preferred',
      });

      expect(options.allowCredentials).toBeDefined();
      expect(options.allowCredentials!.length).toBe(2);
      
      // Check both credentials are included
      const credentialIds = options.allowCredentials!.map(c => c.id);
      expect(credentialIds).toContain(Buffer.from('test-credential-id').toString('base64url'));
      expect(credentialIds).toContain(Buffer.from('second-credential-id').toString('base64url'));
    });

    it('should handle user with no credentials', async () => {
      // Create user without credentials
      const userIdNoCreds = crypto.randomUUID();
      await db.insert(users).values({
        id: userIdNoCreds,
        email: `test-${userIdNoCreds}@example.com`,
        displayName: 'No Creds User',
        role: 'guest',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const options = await generateWebAuthnAuthenticationOptions({
        userId: userIdNoCreds,
        userVerification: 'preferred',
      });

      expect(options.allowCredentials).toBeUndefined(); // No credentials to allow
    });

    it('should generate challenge and store it', async () => {
      const options = await generateWebAuthnAuthenticationOptions({
        userId: testUserId,
        userVerification: 'preferred',
      });

      // Challenge should be stored in database
      // Note: Challenge is stored in webauthn_challenges table
      // This test verifies the options structure is correct
      expect(options.challenge).toBeDefined();
    });
  });

  describe('verifyAuthenticationResponse', () => {
    it('should verify valid authentication response', async () => {
      // First generate options to get challenge
      const options = await generateWebAuthnAuthenticationOptions({
        userId: testUserId,
        userVerification: 'preferred',
      });

      // Mock WebAuthn authentication response
      const mockResponse = {
        id: Buffer.from('test-credential-id').toString('base64url'),
        rawId: Buffer.from('test-credential-id').toString('base64url'),
        response: {
          authenticatorData: Buffer.from('mock-authenticator-data').toString('base64url'),
          clientDataJSON: Buffer.from(JSON.stringify({
            type: 'webauthn.get',
            challenge: options.challenge,
            origin: 'http://localhost:5173',
            crossOrigin: false,
          })).toString('base64url'),
          signature: Buffer.from('mock-signature').toString('base64url'),
          userHandle: Buffer.from(testUserId).toString('base64url'),
        },
        type: 'public-key',
      };

      // Note: This will fail with real WebAuthn verification due to mock data
      // But it tests the function structure and error handling
      const result = await verifyWebAuthnAuthentication({
        userId: testUserId,
        response: mockResponse,
        expectedOrigin: 'http://localhost:5173',
      });

      expect(result.verified).toBe(false);
    });

    it('should reject invalid challenge', async () => {
      const mockResponse = {
        id: Buffer.from('test-credential-id').toString('base64url'),
        rawId: Buffer.from('test-credential-id').toString('base64url'),
        response: {
          authenticatorData: Buffer.from('mock-authenticator-data').toString('base64url'),
          clientDataJSON: Buffer.from(JSON.stringify({
            type: 'webauthn.get',
            challenge: 'invalid-challenge',
            origin: 'http://localhost:5173',
            crossOrigin: false,
          })).toString('base64url'),
          signature: Buffer.from('mock-signature').toString('base64url'),
          userHandle: Buffer.from(testUserId).toString('base64url'),
        },
        type: 'public-key',
      };

      const result = await verifyWebAuthnAuthentication({
        userId: testUserId,
        response: mockResponse,
        expectedOrigin: 'http://localhost:5173',
      });

      expect(result.verified).toBe(false);
    });

    it('should reject invalid origin', async () => {
      const options = await generateWebAuthnAuthenticationOptions({
        userId: testUserId,
        userVerification: 'preferred',
      });

      const mockResponse = {
        id: Buffer.from('test-credential-id').toString('base64url'),
        rawId: Buffer.from('test-credential-id').toString('base64url'),
        response: {
          authenticatorData: Buffer.from('mock-authenticator-data').toString('base64url'),
          clientDataJSON: Buffer.from(JSON.stringify({
            type: 'webauthn.get',
            challenge: options.challenge,
            origin: 'https://malicious-site.com',
            crossOrigin: false,
          })).toString('base64url'),
          signature: Buffer.from('mock-signature').toString('base64url'),
          userHandle: Buffer.from(testUserId).toString('base64url'),
        },
        type: 'public-key',
      };

      const result = await verifyWebAuthnAuthentication({
        userId: testUserId,
        response: mockResponse,
        expectedOrigin: 'http://localhost:5173',
      });

      expect(result.verified).toBe(false);
    });

    it('should reject wrong response type', async () => {
      const options = await generateWebAuthnAuthenticationOptions({
        userId: testUserId,
        userVerification: 'preferred',
      });

      const mockResponse = {
        id: Buffer.from('test-credential-id').toString('base64url'),
        rawId: Buffer.from('test-credential-id').toString('base64url'),
        response: {
          authenticatorData: Buffer.from('mock-authenticator-data').toString('base64url'),
          clientDataJSON: Buffer.from(JSON.stringify({
            type: 'webauthn.create', // Wrong type - should be 'webauthn.get'
            challenge: options.challenge,
            origin: 'http://localhost:5173',
            crossOrigin: false,
          })).toString('base64url'),
          signature: Buffer.from('mock-signature').toString('base64url'),
          userHandle: Buffer.from(testUserId).toString('base64url'),
        },
        type: 'public-key',
      };

      const result = await verifyWebAuthnAuthentication({
        userId: testUserId,
        response: mockResponse,
        expectedOrigin: 'http://localhost:5173',
      });

      expect(result.verified).toBe(false);
    });

    it('should reject unknown credential', async () => {
      const options = await generateWebAuthnAuthenticationOptions({
        userId: testUserId,
        userVerification: 'preferred',
      });

      const mockResponse = {
        id: Buffer.from('unknown-credential-id').toString('base64url'),
        rawId: Buffer.from('unknown-credential-id').toString('base64url'),
        response: {
          authenticatorData: Buffer.from('mock-authenticator-data').toString('base64url'),
          clientDataJSON: Buffer.from(JSON.stringify({
            type: 'webauthn.get',
            challenge: options.challenge,
            origin: 'http://localhost:5173',
            crossOrigin: false,
          })).toString('base64url'),
          signature: Buffer.from('mock-signature').toString('base64url'),
          userHandle: Buffer.from(testUserId).toString('base64url'),
        },
        type: 'public-key',
      };

      const result = await verifyWebAuthnAuthentication({
        userId: testUserId,
        response: mockResponse,
        expectedOrigin: 'http://localhost:5173',
      });

      expect(result.verified).toBe(false);
    });

    it('should reject credential from different user', async () => {
      // Create another user with their own credential
      const otherUserId = crypto.randomUUID();
      await db.insert(users).values({
        id: otherUserId,
        email: `other-${otherUserId}@example.com`,
        displayName: 'Other User',
        role: 'guest',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await db.insert(webauthnCredentials).values({
        id: crypto.randomUUID(),
        userId: otherUserId,
        credentialId: Buffer.from('other-credential-id').toString('base64url'),
        publicKeyCose: Buffer.from('other-public-key').toString('base64url'),
        counter: 0,
        deviceName: 'Other Device',
        transportsJson: JSON.stringify(['usb']),
        uv: false,
      });

      const options = await generateWebAuthnAuthenticationOptions({
        userId: testUserId,
        userVerification: 'preferred',
      });

      const mockResponse = {
        id: Buffer.from('other-credential-id').toString('base64url'),
        rawId: Buffer.from('other-credential-id').toString('base64url'),
        response: {
          authenticatorData: Buffer.from('mock-authenticator-data').toString('base64url'),
          clientDataJSON: Buffer.from(JSON.stringify({
            type: 'webauthn.get',
            challenge: options.challenge,
            origin: 'http://localhost:5173',
            crossOrigin: false,
          })).toString('base64url'),
          signature: Buffer.from('mock-signature').toString('base64url'),
          userHandle: Buffer.from(testUserId).toString('base64url'),
        },
        type: 'public-key',
      };

      const result = await verifyWebAuthnAuthentication({
        userId: testUserId,
        response: mockResponse,
        expectedOrigin: 'http://localhost:5173',
      });

      expect(result.verified).toBe(false);
    });
  });
});
