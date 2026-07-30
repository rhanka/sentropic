import { createHash, randomBytes, randomUUID } from 'node:crypto';

import {
  createOAuthAuthorizeHandler,
  createOAuthConsentDecisionHandler,
  createOAuthConsentDetailsHandler,
  createOAuthEndSessionHandler,
  createOAuthHmacStateCodec,
  createOAuthIntrospectHandler,
  createOAuthRevokeHandler,
  createOAuthTokenHandler,
  createOAuthUserInfoHandler,
  type AuthHonoAccountStatus,
  type AuthHonoPorts,
  type AuthHonoSessionRecord,
  type AuthHonoUserRecord,
} from '@sentropic/auth-hono';
import { and, eq, sql } from 'drizzle-orm';
import { Hono, type Context } from 'hono';
import { jwtVerify, SignJWT } from 'jose';

import { env, requiresOAuthProductionSecrets } from '../../config/env';
import { db } from '../../db/client';
import { emailVerificationCodes, magicLinks, tenantMemberships, userSessions, users } from '../../db/schema';
import { logger } from '../../logger';
import { createConsentStoreAdapter } from '../../services/auth/consent-store-adapter';
import { createFederationAdapter } from '../../services/auth/federation-adapter';
import { createJwksAdapter } from '../../services/auth/jwks-adapter';
import { createOauthStateStoreAdapter } from '../../services/auth/oauth-state-adapter';
import { createServiceTenantAdapter } from '../../services/auth/service-tenant-adapter';
import { authHonoCookiePort } from '../../services/auth/session-adapter';
import { deriveDisplayNameFromEmail } from '../../utils/display-name';

/**
 * HS256 key for the session and verification tokens this host signs and verifies.
 *
 * `||`, not `??`, and the distinction is not cosmetic here. Today production carries no `JWT_SECRET`
 * at all, so both operators yield the literal and this is byte-identical — the change is inert. It
 * stops being inert the moment the JWT rotation step delivers the variable: the secret bundle emits
 * every key it knows about as `--from-literal=VAR="$VAR"`, so an environment whose source env file
 * omits the value receives `JWT_SECRET=""` rather than no variable. `??` preserves that empty string
 * and this becomes a ZERO-LENGTH HMAC key for real authentication material; `||` falls through to the
 * documented fallback instead. Fixing it here, before any pipeline emits the key, is what keeps the
 * rotation step from arming a landmine it cannot see.
 *
 * Exported so the empty-string case is measurable rather than asserted.
 */
export const resolveSessionTokenSecret = (): string =>
  env.JWT_SECRET || 'dev-secret-key-change-in-production-please';

const JWT_SECRET = new TextEncoder().encode(resolveSessionTokenSecret());

const unsupportedOAuthPort = async (): Promise<never> => {
  throw new Error('This AuthHono port is not used by the Sentropic OAuth host routes.');
};

export const oauthRouter = new Hono();

oauthRouter.get('/authorize', withOAuthOptions(createOAuthAuthorizeHandler));
oauthRouter.get('/consent', withOAuthOptions(createOAuthConsentDetailsHandler));
oauthRouter.post('/consent/decision', withOAuthOptions(createOAuthConsentDecisionHandler));
oauthRouter.post('/token', withOAuthOptions(createOAuthTokenHandler));
oauthRouter.get('/userinfo', withOAuthOptions(createOAuthUserInfoHandler));
oauthRouter.post('/userinfo', withOAuthOptions(createOAuthUserInfoHandler));
oauthRouter.post('/revoke', withOAuthOptions(createOAuthRevokeHandler));
oauthRouter.post('/introspect', withOAuthOptions(createOAuthIntrospectHandler));
oauthRouter.get('/end_session', withOAuthOptions(createOAuthEndSessionHandler));

let cachedPorts: AuthHonoPorts | null = null;

export const getSentropicOAuthPorts = (): AuthHonoPorts => {
  cachedPorts ??= createSentropicOAuthPorts();
  return cachedPorts;
};

export const resolveOAuthIssuer = (request?: Request): string => {
  if (env.OAUTH_ISSUER_URL) return trimTrailingSlash(env.OAUTH_ISSUER_URL);
  if (request) return trimTrailingSlash(resolveRequestOrigin(request));
  if (process.env.API_BASE_URL) return trimTrailingSlash(process.env.API_BASE_URL);
  return `http://localhost:${process.env.API_PORT ?? env.PORT}`;
};

export const resolveOAuthUiBaseUrl = (request?: Request): string => {
  if (process.env.UI_BASE_URL) return trimTrailingSlash(process.env.UI_BASE_URL);

  const localRedirectOrigin = request ? resolveLocalRedirectOrigin(request) : null;
  if (localRedirectOrigin) return localRedirectOrigin;

  if (env.AUTH_CALLBACK_BASE_URL) return trimTrailingSlash(env.AUTH_CALLBACK_BASE_URL);

  const corsUiOrigin = env.CORS_ALLOWED_ORIGINS.split(',')
    .map((origin) => origin.trim())
    .find((origin) => origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:'));

  return trimTrailingSlash(corsUiOrigin ?? 'http://localhost:5173');
};

export const createSentropicOAuthOptions = (request?: Request) => ({
  accessTokenTtlSeconds: env.OAUTH_ACCESS_TOKEN_TTL_SEC,
  authorizationCodeTtlSeconds: env.OAUTH_AUTHORIZATION_CODE_TTL_SEC,
  consentUrl: `${resolveOAuthUiBaseUrl(request)}/auth/oauth/consent`,
  dpopIatSkewSeconds: env.OAUTH_DPOP_IAT_SKEW_SEC,
  idTokenTtlSeconds: env.OAUTH_ID_TOKEN_TTL_SEC,
  issuer: resolveOAuthIssuer(request),
  loginUrl: `${resolveOAuthUiBaseUrl(request)}/auth/login`,
  // BR-39r L4: invitation → device-enrollment deep link target (authorize routes here when a
  // `sentropic_invite_token` is present and there is no live session).
  registerUrl: `${resolveOAuthUiBaseUrl(request)}/auth/register`,
  ports: getSentropicOAuthPorts(),
  serviceAccessTokenTtlSeconds: env.OAUTH_SERVICE_ACCESS_TOKEN_TTL_SEC,
  stateCodec: createOAuthHmacStateCodec({ secret: resolveOAuthStateSecret() }),
});

export const resolveOAuthServiceResource = (request?: Request): string =>
  env.OAUTH_SERVICE_RESOURCE_URI
    ? trimTrailingSlash(env.OAUTH_SERVICE_RESOURCE_URI)
    : resolveOAuthIssuer(request);

function withOAuthOptions(
  factory: (options: ReturnType<typeof createSentropicOAuthOptions>) => (c: Context) => Promise<Response>,
): (c: Context) => Promise<Response> {
  return (c) => factory(createSentropicOAuthOptions(c.req.raw))(c);
}

const createSentropicOAuthPorts = (): AuthHonoPorts => ({
  accountPolicy: {
    canAuthenticate(user, now) {
      if (!user.emailVerified) {
        return {
          allowed: false,
          code: 'email_verification_required',
          message: 'User email must be verified.',
          status: 401,
        };
      }
      if (user.accountStatus === 'disabled_by_user' || user.accountStatus === 'disabled_by_admin') {
        return {
          allowed: false,
          code: 'account_disabled',
          message: 'User account is disabled.',
          status: 403,
        };
      }
      if (user.accountStatus === 'pending_admin_approval' && user.approvalDueAt && now > user.approvalDueAt) {
        return { allowed: true };
      }
      return { allowed: true };
    },
    deriveDisplayName: deriveDisplayNameFromEmail,
    normalizeEmail: (email) => email.trim().toLowerCase(),
    resolveSessionRole(user, now) {
      if (user.accountStatus === 'approval_expired_readonly') return 'guest';
      if (user.accountStatus === 'pending_admin_approval' && user.approvalDueAt && now > user.approvalDueAt) {
        return 'guest';
      }
      return user.role;
    },
    roleForNewUser: async ({ email }) => {
      const normalizedEmail = email.trim().toLowerCase();
      if (env.ADMIN_EMAIL && normalizedEmail === env.ADMIN_EMAIL.toLowerCase()) {
        const [{ count }] = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(users)
          .where(eq(users.role, 'admin_app'));
        return Number(count) === 0 ? 'admin_app' : 'guest';
      }
      return 'editor';
    },
    statusForNewUser: ({ email, now }) => {
      const normalizedEmail = email.trim().toLowerCase();
      if (env.ADMIN_EMAIL && normalizedEmail === env.ADMIN_EMAIL.toLowerCase()) {
        return { accountStatus: 'active', approvalDueAt: null };
      }
      return {
        accountStatus: 'pending_admin_approval',
        approvalDueAt: new Date(now.getTime() + 48 * 60 * 60 * 1000),
      };
    },
  },
  auditLog: {
    record(level, event, fields) {
      logger[level]({ ...fields }, event);
    },
  },
  challenges: {
    create: unsupportedOAuthPort,
    findValid: unsupportedOAuthPort,
    markUsed: unsupportedOAuthPort,
    purgeExpired: unsupportedOAuthPort,
  },
  clock: {
    addSeconds: (date, seconds) => new Date(date.getTime() + seconds * 1000),
    now: () => new Date(),
  },
  // Consent persistence: lets the IdP skip the consent screen when a stored grant for the
  // exact (user, client) covers the requested scopes; re-consents on any uncovered scope.
  consentStore: createConsentStoreAdapter(),
  cookies: authHonoCookiePort,
  credentials: {
    create: unsupportedOAuthPort,
    findByCredentialId: unsupportedOAuthPort,
    findById: unsupportedOAuthPort,
    listForUser: unsupportedOAuthPort,
    rename: unsupportedOAuthPort,
    revoke: unsupportedOAuthPort,
    updateCounter: unsupportedOAuthPort,
  },
  emailDelivery: {
    sendMagicLink: unsupportedOAuthPort,
    sendVerificationCode: unsupportedOAuthPort,
  },
  // BR-39e Lot 0: social/enterprise federation substrate (identities link table + one-time
  // server-side flow-state). Inert for the OAuth-server handlers; wired here so the (Lot 1)
  // federation router consumes the port through the same host ports bag.
  federation: createFederationAdapter(),
  emailVerification: {
    async countRecent(email, since) {
      const [{ count }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(emailVerificationCodes)
        .where(and(eq(emailVerificationCodes.email, email), sql`${emailVerificationCodes.createdAt} >= ${since}`));
      return Number(count);
    },
    createCode: unsupportedOAuthPort,
    findLatestValidCode: unsupportedOAuthPort,
    markUsedWithVerificationToken: unsupportedOAuthPort,
    verifyToken: unsupportedOAuthPort,
  },
  jwks: createJwksAdapter(),
  magicLinks: {
    create: unsupportedOAuthPort,
    async findValidByTokenHash(tokenHash, now) {
      const [row] = await db
        .select()
        .from(magicLinks)
        .where(and(eq(magicLinks.tokenHash, tokenHash), eq(magicLinks.used, false), sql`${magicLinks.expiresAt} > ${now}`))
        .limit(1);
      return row ?? null;
    },
    markUsed: unsupportedOAuthPort,
  },
  oauthStateStore: createOauthStateStoreAdapter(),
  // ARCH-11 G1c: S2S on-behalf-of (OBO) tenant policy for the client_credentials mint. Mode-gated
  // on TENANT_RESOLUTION_MODE — no `tid`, no rejection in alias/shadow (byte-identical); strict
  // validates the `tenant` selector against the client's authorized set (fixed ∪ enrollments).
  serviceTenant: createServiceTenantAdapter(),
  // BR-39e: tenancy spine. The tenant claim (`tid`) is derived from an `approved` membership
  // and re-validated at token time; both reads are tenant-scoped to the calling user.
  tenant: {
    async listApprovedTenantIds(userId: string) {
      const rows = await db
        .select({ tenantId: tenantMemberships.tenantId })
        .from(tenantMemberships)
        .where(and(eq(tenantMemberships.userId, userId), eq(tenantMemberships.status, 'approved')));
      return rows.map((row) => row.tenantId);
    },
    async isApprovedMember(userId: string, tenantId: string) {
      const [row] = await db
        .select({ userId: tenantMemberships.userId })
        .from(tenantMemberships)
        .where(
          and(
            eq(tenantMemberships.userId, userId),
            eq(tenantMemberships.tenantId, tenantId),
            eq(tenantMemberships.status, 'approved'),
          ),
        )
        .limit(1);
      return Boolean(row);
    },
  },
  random: {
    bytes: (length) => new Uint8Array(randomBytes(length)),
    numericCode: (length) =>
      Array.from({ length }, () => Math.floor(Math.random() * 10).toString()).join(''),
    token: (bytes) => randomBytes(bytes).toString('base64url'),
    uuid: randomUUID,
  },
  sessions: {
    async create(input) {
      await db.insert(userSessions).values({
        createdAt: input.now,
        deviceName: input.deviceInfo?.name ?? null,
        expiresAt: input.expiresAt,
        id: input.id,
        ipAddress: input.deviceInfo?.ipAddress ?? null,
        lastActivityAt: input.now,
        mfaVerified: input.mfaVerified ?? false,
        refreshTokenHash: input.refreshTokenHash ?? null,
        sessionTokenHash: input.sessionTokenHash,
        userAgent: input.deviceInfo?.userAgent ?? null,
        userId: input.userId,
      });
      const created = await findSessionById(input.id);
      if (!created) throw new Error('Failed to create session.');
      return created;
    },
    findById: findSessionById,
    findByRefreshTokenHash: (refreshTokenHash) => findSessionByHash('refresh', refreshTokenHash),
    findByTokenHash: (sessionTokenHash) => findSessionByHash('session', sessionTokenHash),
    listForUser: async (userId) => {
      const rows = await db.select().from(userSessions).where(eq(userSessions.userId, userId));
      return rows.map(toAuthHonoSessionRecord);
    },
    async revoke(sessionId) {
      const deleted = await db.delete(userSessions).where(eq(userSessions.id, sessionId)).returning({ id: userSessions.id });
      return deleted.length > 0;
    },
    async revokeAllForUser(userId) {
      const deleted = await db.delete(userSessions).where(eq(userSessions.userId, userId)).returning({ id: userSessions.id });
      return deleted.length;
    },
    async touch(sessionId, now) {
      await db.update(userSessions).set({ lastActivityAt: now }).where(eq(userSessions.id, sessionId));
    },
    async updateTokens(input) {
      const [row] = await db
        .update(userSessions)
        .set({
          expiresAt: input.expiresAt,
          lastActivityAt: new Date(),
          refreshTokenHash: input.refreshTokenHash,
          sessionTokenHash: input.sessionTokenHash,
        })
        .where(eq(userSessions.id, input.sessionId))
        .returning();
      return row ? toAuthHonoSessionRecord(row) : null;
    },
  },
  tokens: {
    hashSecret: (secret) => createHash('sha256').update(secret).digest('hex'),
    async signSessionToken(claims, expiresAt) {
      return new SignJWT({ ...claims })
        .setProtectedHeader({ alg: 'HS256' })
        .setJti(randomUUID())
        .setIssuedAt()
        .setExpirationTime(expiresAt)
        .sign(JWT_SECRET);
    },
    async signVerificationToken({ email, expiresAt }) {
      return new SignJWT({ email })
        .setProtectedHeader({ alg: 'HS256' })
        .setJti(randomUUID())
        .setIssuedAt()
        .setExpirationTime(expiresAt)
        .sign(JWT_SECRET);
    },
    async verifySessionToken(token) {
      try {
        const { payload } = await jwtVerify(token, JWT_SECRET);
        if (
          typeof payload.userId !== 'string' ||
          typeof payload.sessionId !== 'string' ||
          typeof payload.role !== 'string'
        ) {
          return null;
        }
        return {
          displayName: typeof payload.displayName === 'string' ? payload.displayName : null,
          email: typeof payload.email === 'string' ? payload.email : null,
          role: payload.role,
          sessionId: payload.sessionId,
          userId: payload.userId,
        };
      } catch {
        return null;
      }
    },
  },
  users: {
    async count() {
      const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(users);
      return Number(count);
    },
    async create(input) {
      const now = new Date();
      const id = randomUUID();
      await db.insert(users).values({
        accountStatus: input.accountStatus ?? 'active',
        approvalDueAt: input.approvalDueAt ?? null,
        createdAt: now,
        displayName: input.displayName ?? null,
        email: input.email,
        emailVerified: input.emailVerified ?? false,
        id,
        role: input.role,
        updatedAt: now,
      });
      const user = await findUserById(id);
      if (!user) throw new Error('Failed to create user.');
      return user;
    },
    findByEmail: async (email) => {
      const [row] = await db.select().from(users).where(eq(users.email, email)).limit(1);
      return row ? toAuthHonoUserRecord(row) : null;
    },
    findById: findUserById,
    async update(userId, input) {
      const [row] = await db
        .update(users)
        .set({
          ...input,
          updatedAt: input.updatedAt ?? new Date(),
        })
        .where(eq(users.id, userId))
        .returning();
      return row ? toAuthHonoUserRecord(row) : null;
    },
  },
});

const findUserById = async (userId: string): Promise<AuthHonoUserRecord | null> => {
  const [row] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  return row ? toAuthHonoUserRecord(row) : null;
};

const findSessionById = async (sessionId: string): Promise<AuthHonoSessionRecord | null> => {
  const [row] = await db.select().from(userSessions).where(eq(userSessions.id, sessionId)).limit(1);
  return row ? toAuthHonoSessionRecord(row) : null;
};

const findSessionByHash = async (
  hashType: 'refresh' | 'session',
  tokenHash: string,
): Promise<AuthHonoSessionRecord | null> => {
  const column = hashType === 'refresh' ? userSessions.refreshTokenHash : userSessions.sessionTokenHash;
  const [row] = await db.select().from(userSessions).where(eq(column, tokenHash)).limit(1);
  return row ? toAuthHonoSessionRecord(row) : null;
};

const toAuthHonoUserRecord = (row: typeof users.$inferSelect): AuthHonoUserRecord => ({
  accountStatus: row.accountStatus as AuthHonoAccountStatus,
  approvalDueAt: row.approvalDueAt,
  createdAt: row.createdAt,
  displayName: row.displayName,
  email: row.email,
  emailVerified: row.emailVerified,
  id: row.id,
  role: row.role,
  updatedAt: row.updatedAt ?? row.createdAt,
});

const toAuthHonoSessionRecord = (row: typeof userSessions.$inferSelect): AuthHonoSessionRecord => ({
  createdAt: row.createdAt,
  deviceName: row.deviceName,
  expiresAt: row.expiresAt,
  id: row.id,
  ipAddress: row.ipAddress,
  lastActivityAt: row.lastActivityAt ?? row.createdAt,
  mfaVerified: row.mfaVerified,
  refreshTokenHash: row.refreshTokenHash,
  revokedAt: null,
  sessionTokenHash: row.sessionTokenHash,
  userAgent: row.userAgent,
  userId: row.userId,
});

/**
 * OAuth state sealing secret. `OAUTH_SIGNING_KEK` takes precedence over `JWT_SECRET` so that
 * provisioning `JWT_SECRET` (step 2 of the secret-separation remediation) cannot silently move state
 * sealing onto the signing key.
 *
 * `||`, not `??`: the secret bundle emits present-but-EMPTY keys (`--from-literal=VAR="$VAR"` yields
 * `VAR=""` when the source env file omits the variable). With `??` an empty `OAUTH_SIGNING_KEK` would
 * short-circuit both the fallback and the production guard, return `''`, and make the state codec throw
 * on every /authorize, /consent and /token request — a total OAuth outage where it previously worked.
 */
const resolveOAuthStateSecret = (): string => {
  const secret = env.OAUTH_SIGNING_KEK || env.JWT_SECRET;
  if (!secret && requiresOAuthProductionSecrets()) {
    throw new Error('JWT_SECRET or OAUTH_SIGNING_KEK is required for OAuth state sealing in production.');
  }
  return secret || 'dev-secret-key-change-in-production-please';
};

const resolveRequestOrigin = (request: Request): string => {
  const forwardedHost = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
  if (forwardedHost) {
    const forwardedProto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() ?? 'https';
    return `${forwardedProto}://${forwardedHost}`;
  }

  const url = new URL(request.url);
  const host = request.headers.get('host');
  if (host) {
    return `${url.protocol}//${host}`;
  }
  return url.origin;
};

const resolveLocalRedirectOrigin = (request: Request): string | null => {
  const redirectUri = new URL(request.url).searchParams.get('redirect_uri');
  if (!redirectUri) return null;
  try {
    const parsed = new URL(redirectUri);
    if (parsed.protocol !== 'http:') return null;
    if (!['localhost', '127.0.0.1'].includes(parsed.hostname)) return null;
    return parsed.origin;
  } catch {
    return null;
  }
};

const trimTrailingSlash = (value: string): string => value.replace(/\/+$/u, '');
