import { Hono } from 'hono';
import { z } from 'zod';
import { logger } from '../../logger';
import {
  generateEmailVerificationCode,
  verifyEmailCode,
} from '../../services/email-verification';

/**
 * Email Verification Routes
 * 
 * POST /auth/email/verify-request - Request email verification code
 * POST /auth/email/verify-code - Verify code and get validation token
 */

export const emailRouter = new Hono();

// Request schemas
const verifyRequestSchema = z.object({
  email: z.string().email(),
});

const verifyCodeSchema = z.object({
  email: z.string().email(),
  code: z.string().regex(/^\d{6}$/, 'Code must be 6 digits'),
});

/**
 * POST /auth/email/verify-request
 * Request an email verification code
 */
emailRouter.post('/verify-request', async (c) => {
  try {
    const body = await c.req.json();
    const { email } = verifyRequestSchema.parse(body);
    
    await generateEmailVerificationCode({ email });
    
    logger.info({ email }, 'Email verification code requested');
    
    return c.json({
      success: true,
      message: 'Code de vérification envoyé par email',
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return c.json({ error: 'Invalid request data', details: error.errors }, 400);
    }
    
    if (error instanceof Error && error.message.includes('Trop de demandes')) {
      return c.json({ error: 'Rate limit exceeded', message: error.message }, 429);
    }
    
    logger.error({ err: error }, 'Error requesting email verification code');
    // In development, don't fail completely - code is still stored and logged
    if (process.env.NODE_ENV !== 'production') {
      return c.json({ 
        success: true,
        message: 'Code généré (vérifiez les logs ou maildev pour le code)' 
      }, 200);
    }
    return c.json({ error: 'Failed to send verification code' }, 500);
  }
});

/**
 * POST /auth/email/verify-code
 * Verify code and get validation token
 */
emailRouter.post('/verify-code', async (c) => {
  try {
    const body = await c.req.json();
    const { email, code } = verifyCodeSchema.parse(body);
    
    const result = await verifyEmailCode({ email, code });
    
    if (!result.valid || !result.verificationToken) {
      logger.warn({ email }, 'Invalid email verification code');
      return c.json({ error: 'Code invalide ou expiré' }, 400);
    }
    
    logger.info({ email }, 'Email verification code verified');
    
    return c.json({
      success: true,
      verificationToken: result.verificationToken,
      message: 'Email vérifié avec succès',
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return c.json({ error: 'Invalid request data', details: error.errors }, 400);
    }
    
    logger.error({ err: error }, 'Error verifying email code');
    return c.json({ error: 'Failed to verify code' }, 500);
  }
});

