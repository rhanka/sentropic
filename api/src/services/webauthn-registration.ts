import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  type VerifiedRegistrationResponse,
} from '@simplewebauthn/server';
import type {
  PublicKeyCredentialCreationOptionsJSON,
  RegistrationResponseJSON,
  AuthenticatorTransportFuture,
} from '@simplewebauthn/server';
import { logger } from '../logger';
import { getWebAuthnConfig, getUserVerificationRequirement } from './webauthn-config';
import { generateChallenge, markChallengeUsed } from './challenge-manager';
import { findCmUserById } from './identity/cm-users';
import { createCmCredential, listCmCredentialsForUser } from './identity/cm-proofs';

/**
 * WebAuthn Registration Service
 * 
 * Handles WebAuthn credential registration:
 * - Generate registration options (challenge, RP info, etc.)
 * - Verify registration response from authenticator
 * - Store credential in database
 */

interface GenerateRegistrationOptionsParams {
  userId?: string; // Optional for new user registration (user doesn't exist yet)
  userName: string;
  userDisplayName: string;
}

interface VerifyRegistrationParams {
  userId: string;
  credential: RegistrationResponseJSON;
  expectedChallenge: string;
  deviceName?: string;
  /**
   * BR-39r L4 — runs AFTER the WebAuthn response is verified but BEFORE the credential is
   * persisted (atomic single-use invite consume). If it throws, the credential is NOT inserted
   * (no orphan) and registration fails.
   */
  beforePersist?: (input: { userId: string }) => Promise<void> | void;
}

/**
 * Generate registration options for WebAuthn ceremony
 * 
 * @param params - User information for registration
 * @returns PublicKeyCredentialCreationOptions for client
 */
export async function generateWebAuthnRegistrationOptions(
  params: GenerateRegistrationOptionsParams
): Promise<PublicKeyCredentialCreationOptionsJSON> {
  const { userId, userName, userDisplayName } = params;
  const config = getWebAuthnConfig();
  
  // Check if user already has credentials (for excludeCredentials)
  // Only check if userId is provided (existing user)
  const existingCredentials = userId ? await listCmCredentialsForUser(userId) : [];

  // Get user role to determine user verification requirement
  // Only check if userId is provided (existing user)
  const user = userId ? await findCmUserById(userId) : null;
  
  const userVerification = user
    ? getUserVerificationRequirement(user.role as 'admin_app' | 'admin_org' | 'editor' | 'guest')
    : 'preferred';
  
  // Generate a unique challenge first
  // Pass null userId for new users (user doesn't exist yet)
  const challengeRecord = await generateChallenge({
    userId: userId || undefined, // undefined will become null in challenge-manager
    type: 'registration',
    ttlSeconds: config.timeout.registration / 1000,
  });
  
        // generateRegistrationOptions n'accepte pas 'indirect', convertir en 'none'
        // (AttestationConveyancePreference inclut 'indirect' mais la bibliothèque ne le supporte pas)
        const attestationType = config.attestation === 'indirect' 
          ? 'none' 
          : (config.attestation as 'none' | 'direct' | 'enterprise' | undefined);
  
        // Generate registration options with our unique challenge
        const options = await generateRegistrationOptions({
          rpName: config.rpName,
          rpID: config.rpID,
          userName,
          userDisplayName,
          challenge: challengeRecord.challenge, // Use our unique challenge
          timeout: config.timeout.registration,
          attestationType,
          excludeCredentials: existingCredentials.map((cred) => ({
            id: cred.credentialId,
            transports: (cred.transports ?? []) as AuthenticatorTransportFuture[],
          })),
          authenticatorSelection: {
            residentKey: 'preferred', // Support passkeys
            userVerification,
          },
        });

        // Override the challenge with our unique one
        options.challenge = challengeRecord.challenge;
  
  logger.info({
    userId,
    userName,
    challengeId: challengeRecord.id,
    challenge: challengeRecord.challenge.substring(0, 10) + '...',
    challengesMatch: challengeRecord.challenge === options.challenge,
  }, 'WebAuthn registration options generated');
  
  return options;
}

/**
 * Verify registration response from authenticator
 * 
 * @param params - Registration response and verification parameters
 * @returns Verified registration response with credential data
 */
