import {
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  type VerifiedAuthenticationResponse,
  type UserVerificationRequirement,
  type AuthenticatorTransportFuture,
  type WebAuthnCredential,
} from '@simplewebauthn/server';
import type {
  PublicKeyCredentialRequestOptionsJSON,
  AuthenticationResponseJSON,
} from '@simplewebauthn/server';
import { logger } from '../logger';
import { getWebAuthnConfig, getUserVerificationRequirement } from './webauthn-config';
import { generateChallenge, markChallengeUsed } from './challenge-manager';
import { findCmUserById } from './identity/cm-users';
import {
  compareAndSwapCmCredentialCounter,
  findCmCredentialByCredentialId,
  listCmCredentialsForUser,
} from './identity/cm-proofs';

/**
 * WebAuthn Authentication Service
 * 
 * Handles WebAuthn authentication:
 * - Generate authentication options (challenge, allowed credentials)
 * - Verify authentication response from authenticator
 * - Update credential counter
 */

interface GenerateAuthenticationOptionsParams {
  userId?: string; // Optional for discoverable credentials (passkeys)
}

interface VerifyAuthenticationParams {
  credential: AuthenticationResponseJSON;
  expectedChallenge: string;
}

/**
 * Generate authentication options for WebAuthn ceremony
 * 
 * @param params - Optional user ID for credential filtering
 * @returns PublicKeyCredentialRequestOptions for client
 */
export async function generateWebAuthnAuthenticationOptions(
  params: GenerateAuthenticationOptionsParams
): Promise<PublicKeyCredentialRequestOptionsJSON> {
  const { userId } = params;
  const config = getWebAuthnConfig();
  
  let allowCredentials: Array<{ id: string; transports?: AuthenticatorTransportFuture[] }> = [];
  // F3/B4: discoverable logins (no userId) cannot resolve a role — fail closed with UV required.
  let userVerification: UserVerificationRequirement = 'required';
  
  // If user ID provided, get their credentials and role
  if (userId) {
    const credentials = await listCmCredentialsForUser(userId);

    allowCredentials = credentials.map((cred) => ({
      id: cred.credentialId,
      transports: cred.transports ? [...cred.transports] as AuthenticatorTransportFuture[] : undefined,
    }));

    // Get user role for verification requirement
    const user = await findCmUserById(userId);

    if (user) {
      userVerification = getUserVerificationRequirement(user.role as 'admin_app' | 'admin_org' | 'editor' | 'guest');
    }
  }
  
  // Generate a unique challenge first
  const challengeRecord = await generateChallenge({
    userId,
    type: 'authentication',
    ttlSeconds: config.timeout.authentication / 1000,
  });
  
        // Generate authentication options with our unique challenge
        const options = await generateAuthenticationOptions({
          rpID: config.rpID,
          challenge: challengeRecord.challenge, // Use our unique challenge
          timeout: config.timeout.authentication,
          allowCredentials: allowCredentials.length > 0 ? allowCredentials : undefined,
          userVerification,
        });

        // Override the challenge with our unique one
        options.challenge = challengeRecord.challenge;
  
  logger.info({
    userId: userId || 'discoverable',
    challengeId: challengeRecord.id,
    allowedCredentials: allowCredentials.length,
  }, 'WebAuthn authentication options generated');
  
  return options;
}

/**
 * Verify authentication response from authenticator
 * 
 * @param params - Authentication response and verification parameters
 * @returns Verification result with user ID if successful
 */
