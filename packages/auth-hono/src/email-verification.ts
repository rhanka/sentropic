import type { AuthHonoPorts } from './ports.js';

export interface CreateAuthEmailVerificationServiceOptions {
  codeLength?: number;
  codeTtlSeconds?: number;
  maxRequestsPerWindow?: number;
  ports: AuthHonoPorts;
  verificationTokenTtlSeconds?: number;
  windowSeconds?: number;
}

export interface AuthHonoRequestEmailCodeInput {
  email: string;
}

export interface AuthHonoVerifyEmailCodeInput {
  code: string;
  email: string;
}

export type AuthHonoRequestEmailCodeResult =
  | {
      expiresAt: Date;
      success: true;
    }
  | {
      error: AuthHonoServiceError;
      success: false;
    };

export type AuthHonoVerifyEmailCodeResult =
  | {
      valid: true;
      verificationToken: string;
    }
  | {
      error: AuthHonoServiceError;
      valid: false;
    };

export interface AuthHonoServiceError {
  code: string;
  message: string;
  status: number;
}

export interface AuthHonoEmailVerificationService {
  requestEmailCode(input: AuthHonoRequestEmailCodeInput): Promise<AuthHonoRequestEmailCodeResult>;
  verifyEmailCode(input: AuthHonoVerifyEmailCodeInput): Promise<AuthHonoVerifyEmailCodeResult>;
}

export const createAuthEmailVerificationService = (
  options: CreateAuthEmailVerificationServiceOptions
): AuthHonoEmailVerificationService => {
  const codeLength = options.codeLength ?? 6;
  const codeTtlSeconds = options.codeTtlSeconds ?? 10 * 60;
  const maxRequestsPerWindow = options.maxRequestsPerWindow ?? 3;
  const verificationTokenTtlSeconds = options.verificationTokenTtlSeconds ?? 15 * 60;
  const windowSeconds = options.windowSeconds ?? 10 * 60;

  return {
    async requestEmailCode(input) {
      const email = options.ports.accountPolicy.normalizeEmail(input.email);
      const now = options.ports.clock.now();
      const windowStart = options.ports.clock.addSeconds(now, -windowSeconds);
      const recentCount = await options.ports.emailVerification.countRecent(email, windowStart);

      if (recentCount >= maxRequestsPerWindow) {
        return {
          error: {
            code: 'rate_limited',
            message: 'Too many verification code requests.',
            status: 429,
          },
          success: false,
        };
      }

      const code = options.ports.random.numericCode(codeLength);
      const codeHash = await options.ports.tokens.hashSecret(code);
      const expiresAt = options.ports.clock.addSeconds(now, codeTtlSeconds);

      await options.ports.emailVerification.createCode({
        email,
        codeHash,
        expiresAt,
        now,
      });
      await options.ports.emailDelivery.sendVerificationCode({ email, code, expiresAt });

      return {
        expiresAt,
        success: true,
      };
    },

    async verifyEmailCode(input) {
      const email = options.ports.accountPolicy.normalizeEmail(input.email);
      const codeHash = await options.ports.tokens.hashSecret(input.code);
      const now = options.ports.clock.now();
      const record = await options.ports.emailVerification.findLatestValidCode(email, codeHash, now);

      if (!record || record.used || record.expiresAt <= now) {
        return {
          error: {
            code: 'invalid_or_expired_code',
            message: 'Verification code is invalid or expired.',
            status: 400,
          },
          valid: false,
        };
      }

      const verificationToken = await options.ports.tokens.signVerificationToken({
        email,
        expiresAt: options.ports.clock.addSeconds(now, verificationTokenTtlSeconds),
      });

      await options.ports.emailVerification.markUsedWithVerificationToken(record.id, verificationToken);

      return {
        valid: true,
        verificationToken,
      };
    },
  };
};
