import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  type VerifiedRegistrationResponse,
} from '@simplewebauthn/server';
import type {
  PublicKeyCredentialCreationOptionsJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/types';
import { db } from '../db/client';
import { users, webauthnCredentials } from '../db/schema';
import { eq } from 'drizzle-orm';
import { logger } from '../logger';
import { getWebAuthnConfig, getUserVerificationRequirement } from './webauthn-config';
import { generateChallenge, markChallengeUsed } from './challenge-manager';

/**
 * WebAuthn Registration Service
 * 
 * Handles WebAuthn credential registration:
 * - Generate registration options (challenge, RP info, etc.)
 * - Verify registration response from authenticator
 * - Store credential in database
 */

interface GenerateRegistrationOptionsParams {
  userId: string;
  userName: string;
  userDisplayName: string;
}

interface VerifyRegistrationParams {
  userId: string;
  credential: RegistrationResponseJSON;
  expectedChallenge: string;
  deviceName?: string;
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
  const existingCredentials = await db
    .select({
      id: webauthnCredentials.credentialId,
      transports: webauthnCredentials.transportsJson,
    })
    .from(webauthnCredentials)
    .where(eq(webauthnCredentials.userId, userId));
  
  // Get user role to determine user verification requirement
  const [user] = await db
    .select({ role: users.role })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  
  const userVerification = user
    ? getUserVerificationRequirement(user.role as any)
    : 'preferred';
  
  // Generate challenge and store in database
  const challengeRecord = await generateChallenge({
    userId,
    type: 'registration',
    ttlSeconds: config.timeout.registration / 1000,
  });
  
  // Generate registration options
  const options = await generateRegistrationOptions({
    rpName: config.rpName,
    rpID: config.rpID,
    userName,
    userDisplayName,
    timeout: config.timeout.registration,
    attestationType: config.attestation,
    excludeCredentials: existingCredentials.map((cred) => ({
      id: cred.id,
      transports: cred.transports ? JSON.parse(cred.transports) : [],
    })),
    authenticatorSelection: {
      residentKey: 'preferred', // Support passkeys
      userVerification,
    },
    challenge: challengeRecord.challenge,
  });
  
  logger.info({
    userId,
    userName,
    challengeId: challengeRecord.id,
  }, 'WebAuthn registration options generated');
  
  return options;
}

/**
 * Verify registration response from authenticator
 * 
 * @param params - Registration response and verification parameters
 * @returns Verified registration response with credential data
 */
export async function verifyWebAuthnRegistration(
  params: VerifyRegistrationParams
): Promise<{ verified: boolean; credentialId?: string }> {
  const { userId, credential, expectedChallenge, deviceName } = params;
  const config = getWebAuthnConfig();
  
  try {
    // Verify registration response
    const verification: VerifiedRegistrationResponse = await verifyRegistrationResponse({
      response: credential,
      expectedChallenge,
      expectedOrigin: Array.isArray(config.origin) ? config.origin : [config.origin],
      expectedRPID: config.rpID,
      requireUserVerification: false, // Will check per-role later
    });
    
    if (!verification.verified || !verification.registrationInfo) {
      logger.warn({ userId }, 'WebAuthn registration verification failed');
      return { verified: false };
    }
    
    const { registrationInfo } = verification;
    const {
      credentialID,
      credentialPublicKey,
      counter,
      credentialDeviceType,
      credentialBackedUp,
      userVerified,
    } = registrationInfo;
    
    // Convert credential ID to base64url for storage
    const credentialIdBase64 = Buffer.from(credentialID).toString('base64url');
    const publicKeyBase64 = Buffer.from(credentialPublicKey).toString('base64url');
    
    // Store credential in database
    await db.insert(webauthnCredentials).values({
      id: crypto.randomUUID(),
      credentialId: credentialIdBase64,
      publicKeyCose: publicKeyBase64,
      counter,
      userId,
      deviceName: deviceName || credentialDeviceType || 'Unknown Device',
      transportsJson: JSON.stringify(credential.response.transports || []),
      uv: userVerified,
      createdAt: new Date(),
      lastUsedAt: null,
    });
    
    // Mark challenge as used
    await markChallengeUsed(expectedChallenge);
    
    logger.info({
      userId,
      credentialId: credentialIdBase64.substring(0, 10) + '...',
      userVerified,
      deviceType: credentialDeviceType,
    }, 'WebAuthn credential registered successfully');
    
    return {
      verified: true,
      credentialId: credentialIdBase64,
    };
  } catch (error) {
    logger.error({ err: error, userId }, 'Error verifying WebAuthn registration');
    return { verified: false };
  }
}

