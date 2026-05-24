import type {
  AuthHonoDeviceInfo,
  AuthHonoPorts,
  AuthHonoSessionClaims,
  AuthHonoSessionRecord,
  AuthHonoUserRecord,
} from './ports.js';

export interface AuthHonoSessionTokens {
  expiresAt: Date;
  refreshToken: string;
  sessionId: string;
  sessionToken: string;
}

export interface AuthHonoValidatedSession {
  role: string;
  session: AuthHonoSessionClaims;
  sessionRecord: AuthHonoSessionRecord;
  user: AuthHonoUserRecord;
}

export interface CreateAuthSessionServiceOptions {
  ports: AuthHonoPorts;
  refreshTokenBytes?: number;
  sessionTtlSeconds?: number;
}

export interface CreateAuthSessionInput {
  deviceInfo?: AuthHonoDeviceInfo;
  mfaVerified?: boolean;
  user: AuthHonoUserRecord;
}

export interface AuthHonoSessionService {
  createSession(input: CreateAuthSessionInput): Promise<AuthHonoSessionTokens>;
  listUserSessions(userId: string): Promise<AuthHonoSessionRecord[]>;
  revokeAllSessions(userId: string): Promise<number>;
  revokeSession(sessionId: string): Promise<boolean>;
  validateSessionToken(sessionToken: string): Promise<AuthHonoValidatedSession | null>;
}

export const createAuthSessionService = (
  options: CreateAuthSessionServiceOptions
): AuthHonoSessionService => {
  const sessionTtlSeconds = options.sessionTtlSeconds ?? 7 * 24 * 60 * 60;
  const refreshTokenBytes = options.refreshTokenBytes ?? 32;

  return {
    async createSession(input) {
      const now = options.ports.clock.now();
      const sessionId = options.ports.random.uuid();
      const expiresAt = options.ports.clock.addSeconds(now, sessionTtlSeconds);
      const refreshToken = options.ports.random.token(refreshTokenBytes);
      const sessionToken = await options.ports.tokens.signSessionToken(
        {
          userId: input.user.id,
          sessionId,
          role: input.user.role,
          email: input.user.email,
          displayName: input.user.displayName,
        },
        expiresAt
      );

      const sessionTokenHash = await options.ports.tokens.hashSecret(sessionToken);
      const refreshTokenHash = await options.ports.tokens.hashSecret(refreshToken);
      const sessionRecord = await options.ports.sessions.create({
        id: sessionId,
        userId: input.user.id,
        sessionTokenHash,
        refreshTokenHash,
        deviceInfo: input.deviceInfo,
        mfaVerified: input.mfaVerified ?? false,
        expiresAt,
        now,
      });

      return {
        expiresAt: sessionRecord.expiresAt,
        refreshToken,
        sessionId: sessionRecord.id,
        sessionToken,
      };
    },

    listUserSessions(userId) {
      return options.ports.sessions.listForUser(userId);
    },

    revokeAllSessions(userId) {
      return options.ports.sessions.revokeAllForUser(userId);
    },

    revokeSession(sessionId) {
      return options.ports.sessions.revoke(sessionId);
    },

    async validateSessionToken(sessionToken) {
      const claims = await options.ports.tokens.verifySessionToken(sessionToken);

      if (!claims) {
        return null;
      }

      const tokenHash = await options.ports.tokens.hashSecret(sessionToken);
      const sessionRecord = await options.ports.sessions.findByTokenHash(tokenHash);
      const now = options.ports.clock.now();

      if (
        !sessionRecord ||
        sessionRecord.id !== claims.sessionId ||
        sessionRecord.userId !== claims.userId ||
        sessionRecord.revokedAt ||
        sessionRecord.expiresAt <= now
      ) {
        return null;
      }

      const user = await options.ports.users.findById(claims.userId);

      if (!user) {
        return null;
      }

      const decision = await options.ports.accountPolicy.canAuthenticate(user, now);

      if (!decision.allowed) {
        return null;
      }

      const role = await options.ports.accountPolicy.resolveSessionRole(user, now);
      const session = { ...claims, role };

      await options.ports.sessions.touch(sessionRecord.id, now);

      return {
        role,
        session,
        sessionRecord,
        user,
      };
    },
  };
};
