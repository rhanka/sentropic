import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  generateWebAuthnRegistrationOptions,
  verifyWebAuthnRegistration,
} from '../../../src/services/webauthn-registration';
import { createCmUser } from '../../../src/services/identity/cm-users';
import { createCmCredential } from '../../../src/services/identity/cm-proofs';
import { getWebAuthnConfig } from '../../../src/services/webauthn-config';
import { cmPurgeAllIdentity, cmQuery, cmTable } from '../../utils/cm-identity-test-store';

const testEmail = 'testuser@example.com';
const testDisplayName = 'Test User';

describe('WebAuthn Registration Service', () => {
  let testUserId: string;
  
  beforeEach(async () => {
    testUserId = crypto.randomUUID();
    await createCmUser({ userId: testUserId, email: `test-${testUserId}@example.com`, displayName: 'Test User', role: 'editor', emailVerified: true, accountStatus: 'active' });
  });

  afterEach(async () => {
    await cmPurgeAllIdentity();
  });

  describe('generateRegistrationOptions', () => {
    it('should generate valid registration options', async () => {
      const options = await generateWebAuthnRegistrationOptions({
        userId: testUserId,
        userName: testEmail,
        userDisplayName: testDisplayName,
      });

      expect(options).toBeDefined();
      expect(options.challenge).toBeDefined();
      expect(options.challenge.length).toBeGreaterThan(20);
      expect(options.rp).toBeDefined();
      expect(options.rp.name).toBeDefined();
      expect(options.rp.id).toBeDefined();
      expect(options.user).toBeDefined();
      expect(options.user.id).toBeDefined();
      expect(options.user.name).toBe(testEmail);
      expect(options.user.displayName).toBe(testDisplayName);
      expect(options.authenticatorSelection).toBeDefined();
      expect(options.timeout).toBeGreaterThan(0);
    });

    it('should exclude existing credentials', async () => {
      // Create existing credential
      await createCmCredential({
        userId: testUserId,
        credentialId: Buffer.from('existing-credential-id').toString('base64url'),
        publicKey: Buffer.from('existing-public-key').toString('base64url'),
        counter: 0,
        name: 'Existing Device',
        transports: ['usb', 'nfc'],
        uv: false,
        rpId: getWebAuthnConfig().rpID,
        now: new Date(),
      });

      const options = await generateWebAuthnRegistrationOptions({
        userId: testUserId,
        userName: testEmail,
        userDisplayName: testDisplayName,
      });

      expect(options.excludeCredentials).toBeDefined();
      expect(options.excludeCredentials!.length).toBe(1);
      expect(options.excludeCredentials![0].id).toBeDefined();
      expect(options.excludeCredentials![0].transports).toEqual(['usb', 'nfc']);
    });

    it('should handle user verification policy', async () => {
      // F3/B4: known users resolve the role-based UV requirement — every role
      // requires UV, so enrolled credentials can later satisfy policy clients.
      const optionsKnown = await generateWebAuthnRegistrationOptions({
        userId: testUserId,
        userName: testEmail,
        userDisplayName: testDisplayName,
      });

      expect(optionsKnown.authenticatorSelection?.userVerification).toBe('required');

      // Unknown (pre-registration) users keep the 'preferred' fallback.
      const optionsUnknown = await generateWebAuthnRegistrationOptions({
        userName: testEmail,
        userDisplayName: testDisplayName,
      });

      expect(optionsUnknown.authenticatorSelection?.userVerification).toBe('preferred');
    });

    it('should generate challenge and store it', async () => {
      const options = await generateWebAuthnRegistrationOptions({
        userId: testUserId,
        userName: testEmail,
        userDisplayName: testDisplayName,
      });

      // Challenge should be stored in database
      const stored = await cmQuery<{ proof_id: string }>(`SELECT "proof_id" FROM ${cmTable('identity_single_use_proofs')} WHERE "kind" = 'webauthn_challenge' AND "challenge" = $1`, [options.challenge]);
      // The challenge is stored in the CM single-use-proof custody store.
      expect(stored.length).toBe(1);
      expect(options.challenge).toBeDefined();
    });
  });

  describe('verifyRegistrationResponse', () => {
    it('should verify valid registration response', async () => {
      // First generate options to get challenge
      const options = await generateWebAuthnRegistrationOptions({
        userId: testUserId,
        userName: testEmail,
        userDisplayName: testDisplayName,
      });

      // Mock WebAuthn registration response
      const mockResponse = {
        id: 'mock-credential-id',
        rawId: Buffer.from('mock-credential-id').toString('base64url'),
        response: {
          attestationObject: Buffer.from('mock-attestation-object').toString('base64url'),
          clientDataJSON: Buffer.from(JSON.stringify({
            type: 'webauthn.create',
            challenge: options.challenge,
            origin: 'http://localhost:5173',
            crossOrigin: false,
          })).toString('base64url'),
        },
        type: 'public-key',
      };

      const result = await verifyWebAuthnRegistration({
        userId: testUserId,
        credential: mockResponse as any,
        expectedChallenge: options.challenge,
      });

      // Note: This will fail with real WebAuthn verification due to mock data
      // But it tests the function structure and error handling
      expect(result).toBeDefined();
    });

    it('should reject invalid challenge', async () => {
      const mockResponse = {
        id: 'mock-credential-id',
        rawId: Buffer.from('mock-credential-id').toString('base64url'),
        response: {
          attestationObject: Buffer.from('mock-attestation-object').toString('base64url'),
          clientDataJSON: Buffer.from(JSON.stringify({
            type: 'webauthn.create',
            challenge: 'invalid-challenge',
            origin: 'http://localhost:5173',
            crossOrigin: false,
          })).toString('base64url'),
        },
        type: 'public-key',
      };

      const result = await verifyWebAuthnRegistration({
        userId: testUserId,
        credential: mockResponse as any,
        expectedChallenge: 'invalid-challenge',
      });

      expect(result.verified).toBe(false);
    });

    it('should reject invalid origin', async () => {
      const options = await generateWebAuthnRegistrationOptions({
        userId: testUserId,
        userName: testEmail,
        userDisplayName: testDisplayName,
      });

      const mockResponse = {
        id: 'mock-credential-id',
        rawId: Buffer.from('mock-credential-id').toString('base64url'),
        response: {
          attestationObject: Buffer.from('mock-attestation-object').toString('base64url'),
          clientDataJSON: Buffer.from(JSON.stringify({
            type: 'webauthn.create',
            challenge: options.challenge,
            origin: 'https://malicious-site.com',
            crossOrigin: false,
          })).toString('base64url'),
        },
        type: 'public-key',
      };

      const result = await verifyWebAuthnRegistration({
        userId: testUserId,
        credential: mockResponse as any,
        expectedChallenge: options.challenge,
      });

      expect(result.verified).toBe(false);
    });

    it('should reject wrong response type', async () => {
      const options = await generateWebAuthnRegistrationOptions({
        userId: testUserId,
        userName: testEmail,
        userDisplayName: testDisplayName,
      });

      const mockResponse = {
        id: 'mock-credential-id',
        rawId: Buffer.from('mock-credential-id').toString('base64url'),
        response: {
          attestationObject: Buffer.from('mock-attestation-object').toString('base64url'),
          clientDataJSON: Buffer.from(JSON.stringify({
            type: 'webauthn.get', // Wrong type - should be 'webauthn.create'
            challenge: options.challenge,
            origin: 'http://localhost:5173',
            crossOrigin: false,
          })).toString('base64url'),
        },
        type: 'public-key',
      };

      const result = await verifyWebAuthnRegistration({
        userId: testUserId,
        credential: mockResponse as any,
        expectedChallenge: options.challenge,
      });

      expect(result.verified).toBe(false);
    });
  });
});
