import { db } from '../db/client';
import { magicLinks, users } from '../db/schema';
import { eq, and } from 'drizzle-orm';
import { randomBytes, createHash } from 'crypto';
import { logger } from '../logger';
import nodemailer from 'nodemailer';
import { env } from '../config/env';
import { deriveDisplayNameFromEmail } from '../utils/display-name';

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

let mailTransporter: nodemailer.Transporter | null = null;

function getMailTransporter(): nodemailer.Transporter | null {
  if (mailTransporter) {
    return mailTransporter;
  }

  if (!env.MAIL_HOST) {
    logger.warn('MAIL_HOST not configured. Emails will not be sent.');
    return null;
  }

  try {
    mailTransporter = nodemailer.createTransport({
      host: env.MAIL_HOST,
      port: env.MAIL_PORT,
      secure: env.MAIL_SECURE,
      auth:
        env.MAIL_USERNAME && env.MAIL_PASSWORD
          ? {
              user: env.MAIL_USERNAME,
              pass: env.MAIL_PASSWORD,
            }
          : undefined,
    });

    return mailTransporter;
  } catch (error) {
    logger.error({ err: error }, 'Failed to initialize mail transporter.');
    return null;
  }
}

/**
 * Hash a token for storage (SHA-256)
 */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
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
  
  // Store magic link in database
  await db.insert(magicLinks).values({
    id: crypto.randomUUID(),
    tokenHash,
    email: normalizedEmail,
    userId: userId || null,
    expiresAt,
    used: false,
    createdAt: new Date(),
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
    
    // Find magic link
    const [link] = await db
      .select()
      .from(magicLinks)
      .where(
        and(
          eq(magicLinks.tokenHash, tokenHash),
          eq(magicLinks.used, false)
        )
      )
      .limit(1);
    
    if (!link) {
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
    
    // If user ID exists, mark as used and return it
    if (link.userId) {
      await db
        .update(magicLinks)
        .set({ used: true })
        .where(eq(magicLinks.id, link.id));
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
    const [existingUser] = await db
      .select()
      .from(users)
      .where(eq(users.email, link.email))
      .limit(1);
    
    if (existingUser) {
      const normalizedLinkEmail = link.email.toLowerCase();
      const updates: Record<string, unknown> = {};

      if (!existingUser.displayName) {
        updates.displayName = deriveDisplayNameFromEmail(normalizedLinkEmail);
      }

      if (!existingUser.email) {
        updates.email = normalizedLinkEmail;
      }

      if (Object.keys(updates).length > 0) {
        updates.updatedAt = new Date();
        await db
          .update(users)
          .set(updates)
          .where(eq(users.id, existingUser.id));
      }

      // Update magic link with userId and mark as used
      await db
        .update(magicLinks)
        .set({ used: true, userId: existingUser.id })
        .where(eq(magicLinks.id, link.id));

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
    const [newUser] = await db
      .insert(users)
      .values({
        id: crypto.randomUUID(),
        email: normalizedLinkEmail,
        displayName,
        role: 'guest', // Default role
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();
    
    // Update magic link with userId and mark as used
    await db
      .update(magicLinks)
      .set({ used: true, userId: newUser.id })
      .where(eq(magicLinks.id, link.id));
    
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
  const transporter = getMailTransporter();

  if (!transporter) {
    logger.info({
      email,
      magicLink,
    }, '[FALLBACK] Magic link email logged (no transporter available)');
    return;
  }

  try {
    await transporter.sendMail({
      from: env.MAIL_FROM,
      to: email,
      subject: 'Votre lien de connexion Top AI Ideas',
      text: `Bonjour,\n\nVoici votre lien de connexion sécurisé. Il expirera dans 10 minutes et ne peut être utilisé qu'une seule fois.\n\n${magicLink}\n\nSi vous n'êtes pas à l'origine de cette demande, ignorez simplement cet email.\n\nL’équipe Top AI Ideas`,
      html: `<p>Bonjour,</p>
        <p>Voici votre lien de connexion sécurisé. Il expirera dans 10 minutes et ne peut être utilisé qu'une seule fois.</p>
        <p><a href="${magicLink}" style="display:inline-block;padding:10px 16px;border-radius:6px;background:#4f46e5;color:#fff;text-decoration:none;font-weight:600;">Se connecter</a></p>
        <p>Si le bouton ne fonctionne pas, copiez et collez ce lien dans votre navigateur :<br/><code>${magicLink}</code></p>
        <p style="margin-top:24px;">L’équipe Top AI Ideas</p>`,
    });

    logger.info({ email }, 'Magic link email sent');
  } catch (error) {
    logger.error({ err: error, email }, 'Failed to send magic link email');
    if (env.NODE_ENV === 'production') {
      throw error;
    }
  }
}

