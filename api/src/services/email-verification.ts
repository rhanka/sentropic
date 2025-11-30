import { db } from '../db/client';
import { emailVerificationCodes } from '../db/schema';
import { eq, and, gt, desc } from 'drizzle-orm';
import { createHash } from 'crypto';
import { logger } from '../logger';
import { SignJWT } from 'jose';
import { env } from '../config/env';
import nodemailer from 'nodemailer';

/**
 * Email Verification Code Service
 * 
 * Manages email verification using 6-digit codes:
 * - Generate and send verification codes
 * - Verify codes and generate validation tokens
 * - Store codes securely (hashed)
 */

interface GenerateCodeParams {
  email: string;
}

interface VerifyCodeParams {
  email: string;
  code: string;
}

const CODE_TTL = 10 * 60; // 10 minutes in seconds
const VERIFICATION_TOKEN_TTL = 15 * 60; // 15 minutes in seconds

let mailTransporter: nodemailer.Transporter | null = null;
let transporterConfigHash: string | null = null;

function getMailTransporter(): nodemailer.Transporter | null {
  // Create a hash of the current config to detect changes
  const currentConfigHash = `${env.MAIL_HOST}:${env.MAIL_PORT}:${env.MAIL_SECURE}:${env.MAIL_USERNAME || ''}`;
  
  // If config changed or transporter doesn't exist, recreate it
  if (mailTransporter && transporterConfigHash === currentConfigHash) {
    return mailTransporter;
  }

  // Reset transporter if config changed
  if (transporterConfigHash !== currentConfigHash) {
    mailTransporter = null;
    transporterConfigHash = null;
  }

  if (!env.MAIL_HOST) {
    logger.warn('MAIL_HOST not configured. Emails will not be sent.');
    return null;
  }

  try {
    const transporterConfig: any = {
      host: env.MAIL_HOST,
      port: env.MAIL_PORT,
      secure: env.MAIL_SECURE, // Use env var (false for maildev, true for production)
      requireTLS: env.MAIL_SECURE, // Require TLS in production
      ignoreTLS: !env.MAIL_SECURE, // Ignore TLS for maildev/dev
    };

    // Add TLS options if secure is enabled
    if (env.MAIL_SECURE) {
      transporterConfig.tls = {
        rejectUnauthorized: true, // Reject self-signed certs in production
      };
    }

    // Add auth only if credentials are provided
    if (env.MAIL_USERNAME && env.MAIL_PASSWORD) {
      transporterConfig.auth = {
        user: env.MAIL_USERNAME,
        pass: env.MAIL_PASSWORD,
      };
    }

    mailTransporter = nodemailer.createTransport(transporterConfig);
    transporterConfigHash = currentConfigHash;

    logger.info({ 
      host: env.MAIL_HOST, 
      port: env.MAIL_PORT,
      secure: env.MAIL_SECURE,
      requireTLS: env.MAIL_SECURE,
      ignoreTLS: !env.MAIL_SECURE
    }, 'Mail transporter configured');

    return mailTransporter;
  } catch (error) {
    logger.error({ err: error }, 'Failed to initialize mail transporter.');
    return null;
  }
}

/**
 * Hash a code for storage (SHA-256)
 */
function hashCode(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

/**
 * Generate a 6-digit verification code
 */
function generateCode(): string {
  // Generate random number between 100000 and 999999
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  return code;
}

/**
 * Generate and send email verification code
 * 
 * @param params - Email to send code to
 * @returns Success status
 */
export async function generateEmailVerificationCode(
  params: GenerateCodeParams
): Promise<{ success: boolean }> {
  const { email } = params;
  const normalizedEmail = email.trim().toLowerCase();

  // Check rate limiting: max 3 codes per email in last 10 minutes
  const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
  const recentCodes = await db
    .select({ id: emailVerificationCodes.id })
    .from(emailVerificationCodes)
    .where(
      and(
        eq(emailVerificationCodes.email, normalizedEmail),
        gt(emailVerificationCodes.createdAt, tenMinutesAgo)
      )
    );

  if (recentCodes.length >= 3) {
    logger.warn({ email: normalizedEmail }, 'Rate limit exceeded for email verification code');
    throw new Error('Trop de demandes. Veuillez patienter quelques minutes avant de réessayer.');
  }

  // Generate 6-digit code
  const code = generateCode();
  const codeHash = hashCode(code);
  
  const expiresAt = new Date(Date.now() + CODE_TTL * 1000);
  
  // Store code in database (hashed)
  await db.insert(emailVerificationCodes).values({
    id: crypto.randomUUID(),
    codeHash,
    email: normalizedEmail,
    verificationToken: null, // Will be set after code verification
    expiresAt,
    used: false,
    createdAt: new Date(),
  });

  // Send code via email
  const transporter = getMailTransporter();
  
  if (transporter) {
    try {
      const mailOptions = {
        from: env.MAIL_FROM,
        to: normalizedEmail,
        subject: 'Votre code de vérification Top AI Ideas',
        text: `Bonjour,\n\nVotre code de vérification est : ${code}\n\nCe code est valide pendant 10 minutes.\n\nSi vous n'êtes pas à l'origine de cette demande, ignorez simplement cet email.\n\nL'équipe Top AI Ideas`,
        html: `<p>Bonjour,</p>
          <p>Votre code de vérification est : <strong style="font-size: 24px; letter-spacing: 4px; font-family: monospace;">${code}</strong></p>
          <p>Ce code est valide pendant 10 minutes.</p>
          <p>Si vous n'êtes pas à l'origine de cette demande, ignorez simplement cet email.</p>
          <p style="margin-top:24px;">L'équipe Top AI Ideas</p>`,
      };
      
      logger.debug({ 
        host: env.MAIL_HOST, 
        port: env.MAIL_PORT, 
        secure: env.MAIL_SECURE,
        from: mailOptions.from,
        to: mailOptions.to 
      }, 'Attempting to send email');
      
      await transporter.sendMail(mailOptions);

      logger.info({ email: normalizedEmail }, 'Email verification code sent');
    } catch (error: any) {
      logger.error({ 
        err: error, 
        email: normalizedEmail,
        errorCode: error.code,
        errorMessage: error.message,
        host: env.MAIL_HOST,
        port: env.MAIL_PORT
      }, 'Failed to send email verification code');
      // In development, log the code and continue (don't fail)
      if (env.NODE_ENV !== 'production') {
        logger.info({
          email: normalizedEmail,
          code,
        }, '[FALLBACK] Email verification code (email send failed, see code above)');
        // Don't throw in dev - code is still valid and stored
      } else {
        // In production, throw the error
        throw error;
      }
    }
  } else {
    // Fallback: log code in development
    logger.info({
      email: normalizedEmail,
      code,
    }, '[FALLBACK] Email verification code (no transporter available)');
  }

  return { success: true };
}

/**
 * Verify email verification code and generate validation token
 * 
 * @param params - Email and code to verify
 * @returns Validation token if code is valid
 */
export async function verifyEmailCode(
  params: VerifyCodeParams
): Promise<{ valid: boolean; verificationToken?: string }> {
  const { email, code } = params;
  const normalizedEmail = email.trim().toLowerCase();
  const codeHash = hashCode(code);
  const now = new Date();
  
  // Find code
  const [codeRecord] = await db
    .select()
    .from(emailVerificationCodes)
    .where(
      and(
        eq(emailVerificationCodes.email, normalizedEmail),
        eq(emailVerificationCodes.codeHash, codeHash),
        eq(emailVerificationCodes.used, false)
      )
    )
    .orderBy(desc(emailVerificationCodes.createdAt))
    .limit(1);
  
  if (!codeRecord) {
    logger.warn({ email: normalizedEmail }, 'Email verification code not found or already used');
    return { valid: false };
  }
  
  // Check if expired
  if (codeRecord.expiresAt < now) {
    logger.warn({ 
      codeId: codeRecord.id,
      expiresAt: codeRecord.expiresAt 
    }, 'Email verification code expired');
    return { valid: false };
  }
  
  // Mark code as used and generate verification token (JWT)
  const JWT_SECRET = new TextEncoder().encode(env.JWT_SECRET || 'default-secret-change-in-production');
  const token = await new SignJWT({ 
    email: normalizedEmail,
    codeId: codeRecord.id,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${VERIFICATION_TOKEN_TTL}s`)
    .sign(JWT_SECRET);
  
  // Store verification token in code record and mark as used
  await db
    .update(emailVerificationCodes)
    .set({ 
      used: true,
      verificationToken: token,
    })
    .where(eq(emailVerificationCodes.id, codeRecord.id));
  
  logger.info({
    email: normalizedEmail,
    codeId: codeRecord.id,
  }, 'Email verification code verified');
  
  return {
    valid: true,
    verificationToken: token,
  };
}

/**
 * Verify validation token (used during registration)
 * 
 * @param token - Validation token to verify
 * @returns Email and validation status
 */
export async function verifyValidationToken(
  token: string
): Promise<{ valid: boolean; email?: string }> {
  try {
    // Check if token exists in database
    const [codeRecord] = await db
      .select({ email: emailVerificationCodes.email })
      .from(emailVerificationCodes)
      .where(eq(emailVerificationCodes.verificationToken, token))
      .limit(1);
    
    if (!codeRecord) {
      logger.warn({ token: token.substring(0, 10) + '...' }, 'Validation token not found');
      return { valid: false };
    }
    
    // Verify JWT token
    const JWT_SECRET = new TextEncoder().encode(env.JWT_SECRET || 'default-secret-change-in-production');
    const { jwtVerify } = await import('jose');
    const { payload } = await jwtVerify(token, JWT_SECRET);
    
    // Verify token matches email
    if (payload.email !== codeRecord.email) {
      logger.warn({ token: token.substring(0, 10) + '...' }, 'Validation token email mismatch');
      return { valid: false };
    }
    
    logger.debug({
      email: codeRecord.email,
    }, 'Validation token verified');
    
    return {
      valid: true,
      email: codeRecord.email,
    };
  } catch (error) {
    logger.debug({ err: error }, 'Invalid validation token');
    return { valid: false };
  }
}

