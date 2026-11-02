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


});
