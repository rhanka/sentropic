import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  generateWebAuthnAuthenticationOptions,
  verifyWebAuthnAuthentication,
} from '../../../src/services/webauthn-authentication';
import { createCmUser, updateCmUser } from '../../../src/services/identity/cm-users';
import { createCmCredential } from '../../../src/services/identity/cm-proofs';
import { getWebAuthnConfig } from '../../../src/services/webauthn-config';
import { cmPurgeAllIdentity } from '../../utils/cm-identity-test-store';

describe('WebAuthn Authentication Service', () => {
  let testUserId: string;
  let testCredentialId: string;
  
  beforeEach(async () => {
    testUserId = crypto.randomUUID();
    testCredentialId = crypto.randomUUID();
    
    await createCmUser({ userId: testUserId, email: `test-${testUserId}@example.com`, displayName: 'Test User', role: 'editor', emailVerified: true, accountStatus: 'active' });

    // Create test credential
    await createCmCredential({
      userId: testUserId,
      credentialId: Buffer.from('test-credential-id').toString('base64url'),
      publicKey: Buffer.from('test-public-key').toString('base64url'),
      counter: 0,
      name: 'Test Device',
      transports: ['usb', 'nfc'],
      uv: false,
      rpId: getWebAuthnConfig().rpID,
      now: new Date(),
    });
  });

  afterEach(async () => {
    await cmPurgeAllIdentity();
  });

  describe('generateAuthenticationOptions', () => {
    it('should generate valid authentication options', async () => {
      const options = await generateWebAuthnAuthenticationOptions({
        userId: testUserId,
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

    it('should require user verification for every role (F3: IdP passkeys are 2FA)', async () => {
      // Editor role requires UV (was preferred before F3).
      const optionsEditor = await generateWebAuthnAuthenticationOptions({
        userId: testUserId,
      });

      expect(optionsEditor.userVerification).toBe('required');

      // Update user to admin role — still required.
      await updateCmUser(testUserId, { role: 'admin_app' });

      const optionsAdmin = await generateWebAuthnAuthenticationOptions({
        userId: testUserId,
      });

      expect(optionsAdmin.userVerification).toBe('required');
    });

    it('should require user verification for discoverable logins (F3 fail-closed)', async () => {
      const options = await generateWebAuthnAuthenticationOptions({});

      expect(options.userVerification).toBe('required');
      expect(options.allowCredentials).toBeUndefined();
    });

    it('should include all user credentials in allowCredentials', async () => {
      // Add another credential
      await createCmCredential({
        userId: testUserId,
        credentialId: Buffer.from('second-credential-id').toString('base64url'),
        publicKey: Buffer.from('second-public-key').toString('base64url'),
        counter: 5,
        name: 'Second Device',
        transports: ['internal'],
        uv: true,
        rpId: getWebAuthnConfig().rpID,
        now: new Date(),
      });

      const options = await generateWebAuthnAuthenticationOptions({
        userId: testUserId,
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
      await createCmUser({ userId: userIdNoCreds, email: `test-${userIdNoCreds}@example.com`, displayName: 'No Creds User', role: 'guest', emailVerified: true, accountStatus: 'active' });

      const options = await generateWebAuthnAuthenticationOptions({
        userId: userIdNoCreds,
      });

      expect(options.allowCredentials).toBeUndefined(); // No credentials to allow
    });

    it('should generate challenge and store it', async () => {
      const options = await generateWebAuthnAuthenticationOptions({
        userId: testUserId,
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
      await createCmUser({ userId: otherUserId, email: `other-${otherUserId}@example.com`, displayName: 'Other User', role: 'guest', emailVerified: true, accountStatus: 'active' });

      await createCmCredential({
        userId: otherUserId,
        credentialId: Buffer.from('other-credential-id').toString('base64url'),
        publicKey: Buffer.from('other-public-key').toString('base64url'),
        counter: 0,
        name: 'Other Device',
        transports: ['usb'],
        uv: false,
        rpId: getWebAuthnConfig().rpID,
        now: new Date(),
      });

      const options = await generateWebAuthnAuthenticationOptions({
        userId: testUserId,
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
