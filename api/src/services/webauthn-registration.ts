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
  userId?: string; // Optional for new user registration (user doesn't exist yet)
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
  // Only check if userId is provided (existing user)
  const existingCredentials = userId ? await db
    .select({
      id: webauthnCredentials.credentialId,
      transports: webauthnCredentials.transportsJson,
    })
    .from(webauthnCredentials)
    .where(eq(webauthnCredentials.userId, userId)) : [];
  
  // Get user role to determine user verification requirement
  // Only check if userId is provided (existing user)
  const user = userId ? await db
    .select({ role: users.role })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
    .then(rows => rows[0]) : null;
  
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
  
        // Generate registration options with our unique challenge
        const options = await generateRegistrationOptions({
          rpName: config.rpName,
          rpID: config.rpID,
          userName,
          userDisplayName,
          challenge: challengeRecord.challenge, // Use our unique challenge
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
    
    // Debug: log the structure of registrationInfo
    logger.debug({
      userId,
      registrationInfoKeys: Object.keys(registrationInfo || {}),
      credential: registrationInfo.credential,
      credentialKeys: registrationInfo.credential ? Object.keys(registrationInfo.credential) : 'no credential',
    }, 'Registration info structure');
    
    // Extract credential info from the credential object
    const credentialData = registrationInfo.credential;
    if (!credentialData) {
      logger.error({ userId }, 'credential is missing from registrationInfo');
      return { verified: false };
    }
    
    const {
      id: credentialID,
      publicKey: credentialPublicKey,
      counter,
    } = credentialData;
    
    const {
      credentialDeviceType,
      // credentialBackedUp not currently used but may be useful for future device management
      // credentialBackedUp,
      userVerified,
    } = registrationInfo;
    
    // Validate required fields
    if (!credentialID) {
      logger.error({ userId }, 'credentialID is missing from credential');
      return { verified: false };
    }
    
    if (!credentialPublicKey) {
      logger.error({ userId }, 'credentialPublicKey is missing from credential');
      return { verified: false };
    }
    
    // Convert credential ID and public key to base64url for storage
    // credentialID and credentialPublicKey might be Uint8Array-like objects
    const credentialIdArray = credentialID instanceof Uint8Array 
      ? credentialID 
      : new Uint8Array(Object.values(credentialID));
    const publicKeyArray = credentialPublicKey instanceof Uint8Array 
      ? credentialPublicKey 
      : new Uint8Array(Object.values(credentialPublicKey));
    
    const credentialIdBase64 = Buffer.from(credentialIdArray).toString('base64url');
    const publicKeyBase64 = Buffer.from(publicKeyArray).toString('base64url');
    
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

