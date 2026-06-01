import type { AuthHonoPorts, AuthHonoUserRecord } from './ports.js';

export interface CreateAuthMagicLinkServiceOptions {
  baseUrl: string;
  ports: AuthHonoPorts;
  tokenBytes?: number;
  ttlSeconds?: number;
}

export interface AuthHonoRequestMagicLinkInput {
  email: string;
  userId?: string | null;
}

export interface AuthHonoVerifyMagicLinkInput {
  token: string;
}

export type AuthHonoRequestMagicLinkResult =
  | {
      expiresAt: Date;
      success: true;
    }
  | {
      error: AuthHonoMagicLinkError;
      success: false;
    };

export type AuthHonoVerifyMagicLinkResult =
  | {
      email: string;
      user: AuthHonoUserRecord;
      valid: true;
    }
  | {
      error: AuthHonoMagicLinkError;
      valid: false;
    };

export interface AuthHonoMagicLinkError {
  code: string;
  message: string;
  status: number;
}

export interface AuthHonoMagicLinkService {
  requestMagicLink(input: AuthHonoRequestMagicLinkInput): Promise<AuthHonoRequestMagicLinkResult>;
  verifyMagicLink(input: AuthHonoVerifyMagicLinkInput): Promise<AuthHonoVerifyMagicLinkResult>;
}

export const createAuthMagicLinkService = (
  options: CreateAuthMagicLinkServiceOptions
): AuthHonoMagicLinkService => {
  const tokenBytes = options.tokenBytes ?? 32;
  const ttlSeconds = options.ttlSeconds ?? 10 * 60;

  return {
    async requestMagicLink(input) {
      const email = options.ports.accountPolicy.normalizeEmail(input.email);
      const now = options.ports.clock.now();
      const token = options.ports.random.token(tokenBytes);
      const tokenHash = await options.ports.tokens.hashSecret(token);
      const expiresAt = options.ports.clock.addSeconds(now, ttlSeconds);
      const url = buildMagicLinkUrl(options.baseUrl, token);

      await options.ports.magicLinks.create({
        email,
        expiresAt,
        now,
        tokenHash,
        userId: input.userId ?? null,
      });
      await options.ports.emailDelivery.sendMagicLink({ email, expiresAt, token, url });

      return {
        expiresAt,
        success: true,
      };
    },

    async verifyMagicLink(input) {
      const tokenHash = await options.ports.tokens.hashSecret(input.token);
      const now = options.ports.clock.now();
      const link = await options.ports.magicLinks.findValidByTokenHash(tokenHash, now);

      if (!link || link.used || link.expiresAt <= now) {
        return invalidMagicLink();
      }

      const email = options.ports.accountPolicy.normalizeEmail(link.email);
      const user = await resolveMagicLinkUser(options.ports, {
        email,
        now,
        userId: link.userId,
      });

      if (!user) {
        return invalidMagicLink();
      }

      await options.ports.magicLinks.markUsed(link.id, user.id);

      return {
        email,
        user,
        valid: true,
      };
    },
  };
};

const resolveMagicLinkUser = async (
  ports: AuthHonoPorts,
  input: { email: string; now: Date; userId: string | null }
): Promise<AuthHonoUserRecord | null> => {
  const existingUser = input.userId
    ? await ports.users.findById(input.userId)
    : await ports.users.findByEmail(input.email);

  if (existingUser) {
    if (!existingUser.emailVerified || existingUser.email !== input.email || !existingUser.displayName) {
      return (
        (await ports.users.update(existingUser.id, {
          displayName: existingUser.displayName ?? ports.accountPolicy.deriveDisplayName(input.email),
          email: existingUser.email ?? input.email,
          emailVerified: true,
          updatedAt: input.now,
        })) ?? existingUser
      );
    }

    return existingUser;
  }

  const isFirstUser = (await ports.users.count()) === 0;
  const status = await ports.accountPolicy.statusForNewUser({
    email: input.email,
    isFirstUser,
    now: input.now,
  });
  const user = await ports.users.create({
    accountStatus: status.accountStatus,
    approvalDueAt: status.approvalDueAt,
    displayName: ports.accountPolicy.deriveDisplayName(input.email),
    email: input.email,
    emailVerified: true,
    role: await ports.accountPolicy.roleForNewUser({ email: input.email, isFirstUser }),
  });

  await ports.accountPolicy.afterUserCreated?.(user);

  return user;
};

const invalidMagicLink = (): AuthHonoVerifyMagicLinkResult => ({
  error: {
    code: 'invalid_or_expired_magic_link',
    message: 'Magic link is invalid or expired.',
    status: 400,
  },
  valid: false,
});

const buildMagicLinkUrl = (baseUrl: string, token: string): string => {
  const normalizedBaseUrl = baseUrl.replace(/\/+$/g, '');
  return `${normalizedBaseUrl}/auth/magic-link/verify?token=${encodeURIComponent(token)}`;
};
