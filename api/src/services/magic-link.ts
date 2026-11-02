import { randomBytes } from 'crypto';
import { logger } from '../logger';
import { env } from '../config/env';
import { sendTransactionalEmail } from './scw-tem-client';
import {
  createCmMagicLink,
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
