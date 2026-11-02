import { createHash } from 'crypto';
import { logger } from '../logger';
import { SignJWT } from 'jose';
import { env } from '../config/env';
import { sendTransactionalEmail } from './scw-tem-client';
import {
  consumeCmEmailCodeWithTicket,
  countCmRecentEmailCodes,
  createCmEmailCode,
  findCmLatestValidEmailCode,
  verifyCmRegistrationTicket,
} from './identity/cm-proofs';

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

export const resolveEmailVerificationTokenSecret = (): string =>
  env.JWT_SECRET || 'default-secret-change-in-production';

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
): Promise<{ success: boolean; expiresAt: Date }> {
  const { email } = params;
  const normalizedEmail = email.trim().toLowerCase();

  // Check rate limiting: max 3 codes per email in last 10 minutes
  const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
  const recentCount = await countCmRecentEmailCodes(normalizedEmail, tenMinutesAgo);

  if (recentCount >= 3) {
    logger.warn({ email: normalizedEmail }, 'Rate limit exceeded for email verification code');
    throw new Error('Trop de demandes. Veuillez patienter quelques minutes avant de réessayer.');
  }

  // Generate 6-digit code
  const code = generateCode();
  const codeHash = hashCode(code);

  const expiresAt = new Date(Date.now() + CODE_TTL * 1000);

  // Store code in the CM custody store (hashed, single-use proof kind email_code)
  await createCmEmailCode({
    email: normalizedEmail,
    codeHash,
    expiresAt,
    now: new Date(),
  });

  // Send code via the Scaleway TEM HTTP API
  try {
    await sendTransactionalEmail({
      to: normalizedEmail,
      subject: 'Votre code de vérification Sentropic',
      text: `Bonjour,\n\nVotre code de vérification est : ${code}\n\nCe code est valide pendant 10 minutes.\n\nSi vous n'êtes pas à l'origine de cette demande, ignorez simplement cet email.\n\nL'équipe Sentropic`,
      html: `<p>Bonjour,</p>
        <p>Votre code de vérification est : <strong style="font-size: 24px; letter-spacing: 4px; font-family: monospace;">${code}</strong></p>
        <p>Ce code est valide pendant 10 minutes.</p>
        <p>Si vous n'êtes pas à l'origine de cette demande, ignorez simplement cet email.</p>
        <p style="margin-top:24px;">L'équipe Sentropic</p>`,
    });

    logger.info({ email: normalizedEmail }, 'Email verification code sent');
  } catch (error: unknown) {
    const errorDetails = error instanceof Error
      ? { errorCode: (error as { code?: string }).code, errorMessage: error.message }
      : { errorCode: undefined, errorMessage: String(error) };
    logger.error({
      err: error,
      email: normalizedEmail,
      ...errorDetails,
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

  return { success: true, expiresAt };
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
  
  // Find latest pending, unexpired code matching the hash
  const codeRecord = await findCmLatestValidEmailCode(normalizedEmail, codeHash, now);

  if (!codeRecord || codeRecord.used) {
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

  // Generate verification token (JWT)
  const JWT_SECRET = new TextEncoder().encode(resolveEmailVerificationTokenSecret());
  const token = await new SignJWT({
    email: normalizedEmail,
    codeId: codeRecord.id,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${VERIFICATION_TOKEN_TTL}s`)
    .sign(JWT_SECRET);

  // Atomically consume the code and issue the registration ticket (hashed token)
  const consumed = await consumeCmEmailCodeWithTicket(codeRecord.id, normalizedEmail, codeHash, token, now);
  if (!consumed) {
    logger.warn({ email: normalizedEmail, codeId: codeRecord.id }, 'Email code consume lost the race');
    return { valid: false };
  }

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
    // Verify JWT token
    const JWT_SECRET = new TextEncoder().encode(resolveEmailVerificationTokenSecret());
    const { jwtVerify } = await import('jose');
    const { payload } = await jwtVerify(token, JWT_SECRET);
    const email = typeof payload.email === 'string' ? payload.email : undefined;
    if (!email) {
      logger.warn({ token: token.substring(0, 10) + '...' }, 'Validation token has no email');
      return { valid: false };
    }

    // Atomically consume the pending registration ticket bound to this email
    const ticketValid = await verifyCmRegistrationTicket(email, token, new Date());
    if (!ticketValid) {
      logger.warn({ token: token.substring(0, 10) + '...' }, 'Validation token not found, consumed, or email mismatch');
      return { valid: false };
    }

    logger.debug({
      email,
    }, 'Validation token verified');

    return {
      valid: true,
      email,
    };
  } catch (error) {
    logger.debug({ err: error }, 'Invalid validation token');
    return { valid: false };
  }
}
