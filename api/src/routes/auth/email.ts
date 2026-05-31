import {
  createAuthEmailRouteHandlers,
  type AuthHonoEmailVerificationService,
} from '@sentropic/auth-hono';
import { Hono } from 'hono';
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
 *
 * Routes consume `@sentropic/auth-hono` route handlers; this module only
 * provides the Sentropic email-verification service adapter. Response and
 * error shapes follow the package's structured contract.
 */

export const emailRouter = new Hono();

const emailVerificationService: AuthHonoEmailVerificationService = {
  async requestEmailCode({ email }) {
    try {
      const { expiresAt } = await generateEmailVerificationCode({ email });
      return { expiresAt, success: true };
    } catch (error) {
      if (error instanceof Error && error.message.includes('Trop de demandes')) {
        return {
          error: {
            code: 'rate_limit_exceeded',
            message: error.message,
            status: 429,
          },
          success: false,
        };
      }

      logger.error({ err: error }, 'Error requesting email verification code');
      return {
        error: {
          code: 'email_send_failed',
          message: 'Failed to send verification code',
          status: 500,
        },
        success: false,
      };
    }
  },

  async verifyEmailCode({ code, email }) {
    const result = await verifyEmailCode({ code, email });

    if (!result.valid || !result.verificationToken) {
      logger.warn({ email }, 'Invalid email verification code');
      return {
        error: {
          code: 'invalid_or_expired_code',
          message: 'Code invalide ou expiré',
          status: 400,
        },
        valid: false,
      };
    }

    logger.info({ email }, 'Email verification code verified');
    return { valid: true, verificationToken: result.verificationToken };
  },
};

const emailHandlers = createAuthEmailRouteHandlers({ service: emailVerificationService });

emailRouter.post('/verify-request', emailHandlers.requestEmailCode!);
emailRouter.post('/verify-code', emailHandlers.verifyEmailCode!);
