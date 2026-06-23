import type {
  AuthHonoWebAuthnAuthenticationService,
  AuthHonoWebAuthnRegistrationService,
} from '@sentropic/auth-hono';
import { eq } from 'drizzle-orm';
import { db } from '../../db/client';
import { webauthnCredentials } from '../../db/schema';
import { verifyChallenge } from '../challenge-manager';
import {
  generateWebAuthnAuthenticationOptions,
  verifyWebAuthnAuthentication,
} from '../webauthn-authentication';
import {
  generateWebAuthnRegistrationOptions,
  verifyWebAuthnRegistration,
} from '../webauthn-registration';

/**
 * Sentropic adapters for `@sentropic/auth-hono` WebAuthn services.
 *
 * `generate*Options` delegate to the existing app services. `verify*` wrap the
 * existing app verify functions and add the app-owned challenge replay-protection
 * (`verifyChallenge`) plus the duplicate-credential check for registration; both
 * gates return structured `{ verified|valid: false, error }` results aligned with
 * the package contract.
 */

export const authHonoWebAuthnRegistrationService: AuthHonoWebAuthnRegistrationService = {
  async generateRegistrationOptions({ userDisplayName, userId, userName }) {
    return generateWebAuthnRegistrationOptions({
      userDisplayName,
      userId,
      userName,
    });
  },

  async verifyRegistration({ beforePersist, credential, deviceName, expectedChallenge, userId }) {
    // Replay protection: challenge must exist, be unused, and match this userId.
    const challengeValid = await verifyChallenge(expectedChallenge, userId, 'registration');
    if (!challengeValid) {
      return {
        error: {
          code: 'invalid_challenge',
          message: 'Invalid or expired registration challenge.',
          status: 400,
        },
        verified: false,
      };
    }

    // Duplicate credential check (a credential id can only register once).
    const credentialIdBase64 = credential.id;
    const [existing] = await db
      .select({ id: webauthnCredentials.id })
      .from(webauthnCredentials)
      .where(eq(webauthnCredentials.credentialId, credentialIdBase64))
      .limit(1);
    if (existing) {
      return {
        error: {
          code: 'duplicate_credential',
          message:
            'Ce device est déjà enregistré, utilisez-le pour vous connecter',
          status: 400,
        },
        verified: false,
      };
    }

    const result = await verifyWebAuthnRegistration({
      beforePersist,
      credential,
      deviceName,
      expectedChallenge,
      userId,
    });

    if (!result.verified || !result.credentialId) {
      return {
        error: {
          code: 'registration_verification_failed',
          message: 'Registration verification failed.',
          status: 400,
        },
        verified: false,
      };
    }

    return { credentialId: result.credentialId, verified: true };
  },
};

export const authHonoWebAuthnAuthenticationService: AuthHonoWebAuthnAuthenticationService = {
  async generateAuthenticationOptions({ userId }) {
    return generateWebAuthnAuthenticationOptions({ userId });
  },

  async verifyAuthentication({ credential, expectedChallenge }) {
    // Replay protection: challenge must exist and be unused; authentication
    // challenges are unbound from any user (discoverable credentials).
    const challengeValid = await verifyChallenge(expectedChallenge, undefined, 'authentication');
    if (!challengeValid) {
      return {
        error: {
          code: 'invalid_challenge',
          message: 'Invalid or expired authentication challenge.',
          status: 400,
        },
        verified: false,
      };
    }

    const result = await verifyWebAuthnAuthentication({ credential, expectedChallenge });

    if (!result.verified || !result.userId || !result.credentialId) {
      return {
        error: {
          code: 'authentication_verification_failed',
          message: 'Authentication verification failed.',
          status: 401,
        },
        verified: false,
      };
    }

    return {
      credentialId: result.credentialId,
      userId: result.userId,
      verified: true,
    };
  },
};
