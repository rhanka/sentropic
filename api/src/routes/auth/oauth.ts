import { randomBytes, randomUUID } from 'node:crypto';

import {
  createOAuthHmacStateCodec,
  type AuthHonoPorts,
} from '@sentropic/auth-hono';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { env, requiresOAuthProductionSecrets } from '../../config/env';
import { db } from '../../db/client';
import { bindCmAppDatabase, withAppDatabaseMethods, type CmIdentityTransaction } from '../../services/identity/cm-transaction';
import { logger } from '../../logger';
import { createConsentStoreAdapter } from '../../services/auth/consent-store-adapter';
import { createFederationAdapter } from '../../services/auth/federation-adapter';
import { createJwksAdapter } from '../../services/auth/jwks-adapter';
import { createOauthStateStoreAdapter } from '../../services/auth/oauth-state-adapter';
import { createOAuthRefreshAdapter } from '../../services/auth/oauth-refresh-adapter';
import { createServiceTenantAdapter } from '../../services/auth/service-tenant-adapter';
import { authHonoCookiePort } from '../../services/auth/session-adapter';
import { deriveDisplayNameFromEmail } from '../../utils/display-name';
import { countCmUsersWithRole } from '../../services/identity/cm-users';
import {
  isCmApprovedMember,
  listCmApprovedTenantIds,
} from '../../services/identity/cm-tenancy';

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

const unsupportedOAuthPort = async (): Promise<never> => {
  throw new Error('This AuthHono port is not used by the Sentropic OAuth host routes.');
};

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
  refreshTokenTtlSeconds: env.OAUTH_REFRESH_TOKEN_TTL_SEC,
  authorizationCodeTtlSeconds: env.OAUTH_AUTHORIZATION_CODE_TTL_SEC,
  consentUrl: `${resolveOAuthUiBaseUrl(request)}/auth/oauth/consent`,
  dpopIatSkewSeconds: env.OAUTH_DPOP_IAT_SKEW_SEC,
  // 2-IdP: no separate exchange environment gate. The environment binding is carried by the
  // workload policy's exact subject/target audience entries (per-environment rows and
  // credentials, no wildcards), so the host passes no environment string here.
  exchangeEnvironment: null,
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

const rootDb = db;
export const createSentropicOAuthHostPorts = (tx: CmIdentityTransaction, boundPorts: () => AuthHonoPorts): AuthHonoPorts =>
  createSentropicOAuthPorts(bindCmAppDatabase(tx), boundPorts);
const createSentropicOAuthPorts = (source: NodePgDatabase = rootDb, boundPorts?: () => AuthHonoPorts): AuthHonoPorts => {
  const db = withAppDatabaseMethods(source);
  return ({
  oauthRefresh: createOAuthRefreshAdapter({
    database: db,
    portsForDatabase: (tx) => boundPorts ? boundPorts() : createSentropicOAuthPorts(tx),
    transactionBound: Boolean(boundPorts),
  }),
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
        // Lot A4: admin count reads the CM account store (public.users is dropped).
        const count = await countCmUsersWithRole('admin_app');
        return count === 0 ? 'admin_app' : 'guest';
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
  consentStore: createConsentStoreAdapter({ database: db, transactionBound: Boolean(boundPorts) }),
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
  federation: createFederationAdapter({ database: db }),
  emailVerification: {
    countRecent: unsupportedOAuthPort,
    createCode: unsupportedOAuthPort,
    findLatestValidCode: unsupportedOAuthPort,
    markUsedWithVerificationToken: unsupportedOAuthPort,
    verifyToken: unsupportedOAuthPort,
  },
  jwks: createJwksAdapter({ database: db }),
  magicLinks: {
    create: unsupportedOAuthPort,
    findValidByTokenHash: unsupportedOAuthPort,
    markUsed: unsupportedOAuthPort,
  },
  oauthStateStore: createOauthStateStoreAdapter({ database: db, transactionBound: Boolean(boundPorts) }),
  // ARCH-11 G1c: S2S on-behalf-of (OBO) tenant policy for the client_credentials mint.
  // Lot A4: always strict — validates the `tenant` selector against the client's authorized
  // set (fixed cm_service_clients binding ∪ enrollments).
  serviceTenant: createServiceTenantAdapter(),
  // BR-39e: tenancy spine. The tenant claim (`tid`) is derived from an `approved` membership
  // and re-validated at token time; both reads are tenant-scoped to the calling user.
  tenant: {
    // Lot A4: memberships live in cm_identity.cm_tenant_memberships.
    async listApprovedTenantIds(userId: string) {
      return listCmApprovedTenantIds(userId);
    },
    async isApprovedMember(userId: string, tenantId: string) {
      return isCmApprovedMember(userId, tenantId);
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
    // Only the CM binding supplies session authority; this host bag is protocol configuration.
    create: unsupportedOAuthPort, findById: unsupportedOAuthPort,
    findByRefreshTokenHash: unsupportedOAuthPort, findByTokenHash: unsupportedOAuthPort,
    listForUser: unsupportedOAuthPort, revoke: unsupportedOAuthPort,
    revokeAllForUser: unsupportedOAuthPort, touch: unsupportedOAuthPort, updateTokens: unsupportedOAuthPort,
  },
  tokens: {
    hashSecret: unsupportedOAuthPort, signSessionToken: unsupportedOAuthPort,
    signVerificationToken: unsupportedOAuthPort, verifySessionToken: unsupportedOAuthPort,
  },
  users: {
    count: unsupportedOAuthPort, create: unsupportedOAuthPort,
    findByEmail: unsupportedOAuthPort, findById: unsupportedOAuthPort, update: unsupportedOAuthPort,
  },
  });
};

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
