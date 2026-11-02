import { randomBytes } from 'crypto';
import { logger } from '../logger';
import { env } from '../config/env';
import { sendTransactionalEmail } from './scw-tem-client';
import { deriveDisplayNameFromEmail } from '../utils/display-name';
import { findCmUserByEmail, createCmUser, updateCmUser } from './identity/cm-users';
import {
  consumeCmMagicLink,
  createCmMagicLink,
  findCmMagicLinkByTokenHash,
  sha256Hex,
} from './identity/cm-proofs';

/**
 * Magic Link Service
 * 
 * Fallback authentication method using email magic links:
 * - Generate secure magic link tokens
 * - Send magic link emails
 * - Verify magic link tokens
 * - Create or find user accounts
 */

interface GenerateMagicLinkParams {
  email: string;
  userId?: string; // Optional for existing users
}

interface MagicLinkResult {
  token: string;
  expiresAt: Date;
}

interface VerifyMagicLinkResult {
  valid: boolean;
  userId?: string;
  email?: string;
}

const MAGIC_LINK_TTL = 10 * 60; // 10 minutes in seconds

/**
 * Hash a token for storage (SHA-256)
 */
function hashToken(token: string): string {
  return sha256Hex(token);
}

/**
 * Generate a magic link token
 * 
 * @param params - Email and optional user ID
 * @returns Magic link token and expiration
 */
export async function generateMagicLink(
  params: GenerateMagicLinkParams
): Promise<MagicLinkResult> {
  const { email, userId } = params;
  
  const normalizedEmail = email.trim().toLowerCase();
  
  // Generate secure random token (32 bytes)
  const tokenBuffer = randomBytes(32);
  const token = tokenBuffer.toString('base64url');
  const tokenHash = hashToken(token);
  
  const expiresAt = new Date(Date.now() + MAGIC_LINK_TTL * 1000);

  // Store magic link in the CM custody store (single-use proof, kind magic_link)
  await createCmMagicLink({
    email: normalizedEmail,
    tokenHash,
    userId: userId || null,
    expiresAt,
    now: new Date(),
  });
  
  logger.info({
    email: normalizedEmail,
    userId: userId || 'new_user',
    expiresAt,
  }, 'Magic link generated');
  
  return { token, expiresAt };
}

/**
 * Verify a magic link token
 * 
 * @param token - Magic link token to verify
 * @returns Verification result with user ID and email if valid
 */
export async function verifyMagicLink(
  token: string
): Promise<VerifyMagicLinkResult> {
  try {
    const tokenHash = hashToken(token);
    const now = new Date();

    // Find magic link (pending only; consumed/revoked/expired rows do not match)
    const link = await findCmMagicLinkByTokenHash(tokenHash);

    if (!link || link.used) {
      logger.warn('Magic link not found or already used');
      return { valid: false };
    }

    // Check if expired
    if (link.expiresAt < now) {
      logger.warn({
        linkId: link.id,
        expiresAt: link.expiresAt
      }, 'Magic link expired');
      return { valid: false };
    }

    // If user ID exists, atomically consume and return it
    if (link.userId) {
      const consumed = await consumeCmMagicLink(tokenHash, link.userId, now);
      if (!consumed) {
        logger.warn({ linkId: link.id }, 'Magic link consume lost the race');
        return { valid: false };
      }
      logger.info({
        userId: link.userId,
        email: link.email,
      }, 'Magic link verified for existing user');

      return {
        valid: true,
        userId: link.userId,
        email: link.email.toLowerCase(),
      };
    }

    // Create new user if doesn't exist
    const existingUser = await findCmUserByEmail(link.email);

    if (existingUser) {
      const normalizedLinkEmail = link.email.toLowerCase();
      const updates: { displayName?: string; email?: string } = {};

      if (!existingUser.displayName) {
        updates.displayName = deriveDisplayNameFromEmail(normalizedLinkEmail);
      }

      if (!existingUser.email) {
        updates.email = normalizedLinkEmail;
      }

      if (Object.keys(updates).length > 0) {
        await updateCmUser(existingUser.id, updates);
      }

      // Consume the link and bind it to the existing user
      const consumed = await consumeCmMagicLink(tokenHash, existingUser.id, now);
      if (!consumed) {
        logger.warn({ linkId: link.id }, 'Magic link consume lost the race');
        return { valid: false };
      }

      logger.info({
        userId: existingUser.id,
        email: normalizedLinkEmail,
      }, 'Magic link verified, user found by email');

      return {
        valid: true,
        userId: existingUser.id,
        email: normalizedLinkEmail,
      };
    }

    const normalizedLinkEmail = link.email.toLowerCase();
    const displayName = deriveDisplayNameFromEmail(normalizedLinkEmail);
    const newUser = await createCmUser({
      email: normalizedLinkEmail,
      displayName,
      emailVerified: true,
      role: 'editor',
      accountStatus: 'pending_admin_approval',
      approvalDueAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
    });

    // Consume the link and bind it to the new user
    const consumed = await consumeCmMagicLink(tokenHash, newUser.id, now);
    if (!consumed) {
      logger.warn({ linkId: link.id }, 'Magic link consume lost the race');
      return { valid: false };
    }

    logger.info({
      userId: newUser.id,
      email: normalizedLinkEmail,
    }, 'Magic link verified, new user created');

    return {
      valid: true,
      userId: newUser.id,
      email: normalizedLinkEmail,
    };
  } catch (error) {
    logger.error({ err: error }, 'Error verifying magic link');
    return { valid: false };
  }
}

/**
 * Send magic link email (placeholder - to be implemented with email service)
 * 
 * @param email - Recipient email
 * @param magicLink - Full magic link URL
 */
export async function sendMagicLinkEmail(
  email: string,
  magicLink: string
): Promise<void> {
  try {
    await sendTransactionalEmail({
      to: email,
      subject: 'Votre lien de connexion Sentropic',
      text: `Bonjour,\n\nVoici votre lien de connexion sécurisé. Il expirera dans 10 minutes et ne peut être utilisé qu'une seule fois.\n\n${magicLink}\n\nSi vous n'êtes pas à l'origine de cette demande, ignorez simplement cet email.\n\nL’équipe Sentropic`,
      html: `<p>Bonjour,</p>
        <p>Voici votre lien de connexion sécurisé. Il expirera dans 10 minutes et ne peut être utilisé qu'une seule fois.</p>
        <p><a href="${magicLink}" style="display:inline-block;padding:10px 16px;border-radius:6px;background:#4f46e5;color:#fff;text-decoration:none;font-weight:600;">Se connecter</a></p>
        <p>Si le bouton ne fonctionne pas, copiez et collez ce lien dans votre navigateur :<br/><code>${magicLink}</code></p>
        <p style="margin-top:24px;">L’équipe Sentropic</p>`,
    });

    logger.info({ email }, 'Magic link email sent');
  } catch (error) {
    logger.error({ err: error, email }, 'Failed to send magic link email');
    if (env.NODE_ENV === 'production') {
      throw error;
    }
  }
}
