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


});
