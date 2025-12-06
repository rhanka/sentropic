import {
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  type VerifiedAuthenticationResponse,
  type UserVerificationRequirement,
} from '@simplewebauthn/server';
import type {
  PublicKeyCredentialRequestOptionsJSON,
  AuthenticationResponseJSON,
} from '@simplewebauthn/types';
import { db } from '../db/client';
import { webauthnCredentials, users } from '../db/schema';
import { eq } from 'drizzle-orm';
import { logger } from '../logger';
import { getWebAuthnConfig, getUserVerificationRequirement } from './webauthn-config';
import { generateChallenge, markChallengeUsed } from './challenge-manager';

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
  
  let allowCredentials: Array<{ id: string; transports?: string[] }> = [];
  let userVerification: UserVerificationRequirement = 'preferred';
  
  // If user ID provided, get their credentials and role
  if (userId) {
    const credentials = await db
      .select({
        id: webauthnCredentials.credentialId,
        transports: webauthnCredentials.transportsJson,
      })
      .from(webauthnCredentials)
      .where(eq(webauthnCredentials.userId, userId));
    
    allowCredentials = credentials.map((cred) => ({
      id: cred.id,
      transports: cred.transports ? JSON.parse(cred.transports) : undefined,
    }));
    
    // Get user role for verification requirement
    const [user] = await db
      .select({ role: users.role })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    
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
): Promise<{ verified: boolean; userId?: string; credentialId?: string }> {
  const { credential, expectedChallenge } = params;
  const config = getWebAuthnConfig();
  
  try {
    // Get credential from database using credential ID from response
    logger.debug({
      credentialIdType: typeof credential.id,
      credentialId: credential.id,
    }, 'Credential ID from response');
    
    // Convert credential ID to base64url for database lookup
    const credentialIdArray = credential.id instanceof Uint8Array 
      ? credential.id 
      : new Uint8Array(Object.values(credential.id));
    const credentialIdBase64 = Buffer.from(credentialIdArray).toString('base64url');
    
    const [storedCredential] = await db
      .select({
        id: webauthnCredentials.id,
        credentialId: webauthnCredentials.credentialId,
        publicKeyCose: webauthnCredentials.publicKeyCose,
        counter: webauthnCredentials.counter,
        userId: webauthnCredentials.userId,
        uv: webauthnCredentials.uv,
      })
      .from(webauthnCredentials)
      .where(eq(webauthnCredentials.credentialId, credentialIdBase64))
      .limit(1);
    
    // Debug: check what credentials exist in database
    const allCredentials = await db
      .select({ credentialId: webauthnCredentials.credentialId })
      .from(webauthnCredentials)
      .limit(5);
    
    logger.debug({
      searchedCredentialId: credentialIdBase64.substring(0, 10) + '...',
      storedCredential: storedCredential ? 'found' : 'not found',
      storedCredentialData: storedCredential ? {
        id: storedCredential.id,
        credentialId: storedCredential.credentialId.substring(0, 10) + '...',
        counter: storedCredential.counter,
        userId: storedCredential.userId,
        uv: storedCredential.uv
      } : null,
      allCredentials: allCredentials.map(c => c.credentialId.substring(0, 10) + '...')
    }, 'Credential lookup');
    
    if (!storedCredential) {
      logger.warn({ credentialId: credentialIdBase64.substring(0, 10) + '...' }, 'Credential not found');
      return { verified: false };
    }
    
    // Convert base64url back to Uint8Array
    const credentialPublicKey = Buffer.from(storedCredential.publicKeyCose, 'base64url');
    
    // Get user role to determine UV requirement
    const [user] = await db
      .select({ role: users.role })
      .from(users)
      .where(eq(users.id, storedCredential.userId))
      .limit(1);
    
    const userRole = user?.role as 'admin_app' | 'admin_org' | 'editor' | 'guest' || 'guest';
    const requireUV = userRole === 'admin_app' || userRole === 'admin_org';
    
    // Create WebAuthnCredential object (v11.0.0+ API change)
    const webAuthnCredential = {
      id: Buffer.from(storedCredential.credentialId, 'base64url'),
      publicKey: credentialPublicKey,
      counter: storedCredential.counter,
      transports: storedCredential.transportsJson ? JSON.parse(storedCredential.transportsJson) : [],
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
      credential: webAuthnCredential, // Changed from 'authenticator' to 'credential'
      requireUserVerification: requireUV, // Required for admins, optional for others
    });
    
    if (!verification.verified) {
      logger.warn({ userId: storedCredential.userId }, 'WebAuthn authentication verification failed');
      return { verified: false };
    }
    
    // Additional check: for admin roles, verify UV was actually performed
    if (requireUV && !verification.authenticationInfo.userVerified) {
      logger.warn({ 
        userId: storedCredential.userId, 
        role: userRole 
      }, 'User verification required for admin role but not performed');
      return { verified: false };
    }
    
    const { authenticationInfo } = verification;
    const { newCounter } = authenticationInfo;
    
    // Update credential counter and last used timestamp
    await db
      .update(webauthnCredentials)
      .set({
        counter: newCounter,
        lastUsedAt: new Date(),
      })
      .where(eq(webauthnCredentials.id, storedCredential.id));
    
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
    };
  } catch (error) {
    logger.error({ err: error }, 'Error verifying WebAuthn authentication');
    return { verified: false };
  }
}

