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
export async function verifyWebAuthnAuthentication(
  params: VerifyAuthenticationParams
): Promise<{ verified: boolean; userId?: string; credentialId?: string; userVerified?: boolean }> {
  const { credential, expectedChallenge } = params;
  const config = getWebAuthnConfig();
  
  try {
    // Get credential from database using credential ID from response
    logger.debug({
      credentialIdType: typeof credential.id,
      credentialId: credential.id,
    }, 'Credential ID from response');
    
    // credential.id is always a Base64URLString (string) in AuthenticationResponseJSON
    // Same as RegistrationResponseJSON.id - see @simplewebauthn/server types
    const credentialIdBase64 = credential.id;
    
    const storedCredential = await findCmCredentialByCredentialId(credentialIdBase64);

    logger.debug({
      searchedCredentialId: credentialIdBase64.substring(0, 10) + '...',
      storedCredential: storedCredential ? 'found' : 'not found',
      storedCredentialData: storedCredential ? {
        id: storedCredential.id,
        credentialId: storedCredential.credentialId.substring(0, 10) + '...',
        counter: storedCredential.counter,
        userId: storedCredential.userId,
      } : null,
    }, 'Credential lookup');
    
    if (!storedCredential) {
      logger.warn({ credentialId: credentialIdBase64.substring(0, 10) + '...' }, 'Credential not found');
      return { verified: false };
    }
    
    // Convert base64url back to Uint8Array
    const credentialPublicKey = Buffer.from(storedCredential.publicKey, 'base64url');

    // F3/B4: IdP passkeys are 2FA credentials — UV is required for every login,
    // regardless of role. No per-role lookup: fail closed by construction.
    const requireUV = true;

    // Create WebAuthnCredential object (v11.0.0+ API change)
    const transports = storedCredential.transports
      ? [...storedCredential.transports] as AuthenticatorTransportFuture[]
      : [];
    // WebAuthnCredential attend id comme Base64URLString (string) et publicKey comme Uint8Array
    // storedCredential.credentialId est déjà un string base64url, pas besoin de conversion
    const webAuthnCredential: WebAuthnCredential = {
      id: storedCredential.credentialId, // Base64URLString (string)
      publicKey: new Uint8Array(credentialPublicKey), // Uint8Array
      counter: storedCredential.counter,
      transports,
    };
    
    logger.debug({
      credentialKeys: Object.keys(webAuthnCredential),
      idType: typeof webAuthnCredential.id,
      publicKeyType: typeof webAuthnCredential.publicKey,
      counterType: typeof webAuthnCredential.counter,
      counterValue: webAuthnCredential.counter,
    }, 'WebAuthnCredential object before verification');
    
    // Verify authentication response
    const verification: VerifiedAuthenticationResponse = await verifyAuthenticationResponse({
      response: credential,
      expectedChallenge,
      expectedOrigin: Array.isArray(config.origin) ? config.origin : [config.origin],
      expectedRPID: config.rpID,
      credential: webAuthnCredential,
      requireUserVerification: requireUV,
    });
    
    if (!verification.verified) {
      logger.warn({ userId: storedCredential.userId }, 'WebAuthn authentication verification failed');
      return { verified: false };
    }
    
    // Fail-closed belt-and-braces: the UV bit must be set, whatever the library decided.
    if (!verification.authenticationInfo.userVerified) {
      logger.warn({
        userId: storedCredential.userId,
      }, 'User verification required but not performed');
      return { verified: false, userVerified: false };
    }
    
    const { authenticationInfo } = verification;
    const { newCounter } = authenticationInfo;
    
    // Update credential counter and last used timestamp (CAS on counter+revision)
    const counterUpdated = await compareAndSwapCmCredentialCounter({
      credentialId: storedCredential.credentialId,
      userId: storedCredential.userId,
      expectedCounter: storedCredential.counter,
      newCounter,
      now: new Date(),
    });
    if (!counterUpdated) {
      logger.warn({ userId: storedCredential.userId }, 'WebAuthn counter update lost a race');
      return { verified: false };
    }
    
    // Mark challenge as used
    await markChallengeUsed(expectedChallenge);
    
    logger.info({
      userId: storedCredential.userId,
      credentialId: credentialIdBase64.substring(0, 10) + '...',
      newCounter,
    }, 'WebAuthn authentication successful');
    
    return {
      verified: true,
      userId: storedCredential.userId,
      credentialId: storedCredential.credentialId,
      userVerified: verification.authenticationInfo.userVerified === true,
    };
  } catch (error) {
    logger.error({ err: error }, 'Error verifying WebAuthn authentication');
    return { verified: false };
  }
}

