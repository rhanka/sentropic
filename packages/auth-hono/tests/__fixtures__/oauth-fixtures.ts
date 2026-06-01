import {
  createOAuthHmacStateCodec,
  createOAuthRouter,
  type AuthHonoPorts,
  type AuthHonoSessionRecord,
  type AuthHonoUserRecord,
  type OAuthContinuationCodec,
  type OauthClientRecord,
} from '../../src/index.js';
import { createJwksKeyRecord, createMemoryJwksPort } from './memory-jwks.js';
import { createMemoryOauthStateStore, type MemoryOauthStateStorePort } from './memory-oauth-state-store.js';

export const oauthNow = new Date('2026-01-01T00:00:00.000Z');

export const oauthUser: AuthHonoUserRecord = {
  accountStatus: 'active',
  approvalDueAt: null,
  createdAt: oauthNow,
  displayName: 'Ada Lovelace',
  email: 'ada@example.com',
  emailVerified: true,
  id: 'user-1',
  role: 'member',
  updatedAt: oauthNow,
};

export const createOauthClient = (input: Partial<OauthClientRecord> = {}): OauthClientRecord => ({
  allowedScopes: ['openid', 'profile', 'email'],
  clientId: 'example-rp',
  clientSecretHash: 'hash:client-secret',
  createdAt: oauthNow,
  dpopBoundAccessTokens: false,
  grantTypes: ['authorization_code'],
  id: 'client-row-1',
  name: 'Example RP',
  ownerUserId: null,
  redirectUris: ['http://localhost:5397/callback'],
  requirePkce: true,
  responseTypes: ['code'],
  tenantId: null,
  tokenEndpointAuthMethod: 'client_secret_basic',
  updatedAt: oauthNow,
  ...input,
});

export const createOauthSession = (input: Partial<AuthHonoSessionRecord> = {}): AuthHonoSessionRecord => ({
  createdAt: oauthNow,
  deviceName: null,
  expiresAt: new Date('2026-01-08T00:00:00.000Z'),
  id: 'session-1',
  ipAddress: null,
  lastActivityAt: oauthNow,
  mfaVerified: true,
  refreshTokenHash: null,
  revokedAt: null,
  sessionTokenHash: 'hash:session-token',
  userAgent: null,
  userId: oauthUser.id,
  ...input,
});

export const createOauthPorts = async (options: {
  authenticated?: boolean;
  clients?: OauthClientRecord[];
  store?: MemoryOauthStateStorePort;
} = {}): Promise<{ ports: AuthHonoPorts; store: MemoryOauthStateStorePort }> => {
  const store = options.store ?? createMemoryOauthStateStore({ clients: options.clients ?? [createOauthClient()], now: () => oauthNow });
  const jwks = createMemoryJwksPort([await createJwksKeyRecord({ active: true, kid: 'kid-1', now: oauthNow })]);
  let uuidCounter = 0;
  let tokenCounter = 0;

  const ports = {
    accountPolicy: {
      canAuthenticate: () => ({ allowed: true }),
      deriveDisplayName: (email: string) => email,
      normalizeEmail: (email: string) => email.toLowerCase(),
      resolveSessionRole: () => 'member',
      roleForNewUser: () => 'member',
      statusForNewUser: () => ({ accountStatus: 'active', approvalDueAt: null }),
    },
    auditLog: { record: () => undefined },
    challenges: {},
    clock: {
      addSeconds: (date: Date, seconds: number) => new Date(date.getTime() + seconds * 1000),
      now: () => oauthNow,
    },
    cookies: {
      readRefreshToken: () => null,
      readSessionToken: () => (options.authenticated ? 'session-token' : null),
      serializeClearedRefreshCookie: () => 'refreshToken=; Max-Age=0',
      serializeClearedSessionCookie: () => 'session=; Max-Age=0',
      serializeRefreshCookie: ({ token }: { token: string }) => `refreshToken=${token}`,
      serializeSessionCookie: ({ token }: { token: string }) => `session=${token}`,
    },
    credentials: {},
    emailDelivery: {},
    emailVerification: {},
    jwks,
    magicLinks: {},
    oauthStateStore: store,
    random: {
      bytes: (length: number) => new Uint8Array(length).fill(1),
      numericCode: (length: number) => '1'.repeat(length),
      token: () => `random-token-${++tokenCounter}`,
      uuid: () => `uuid-${++uuidCounter}`,
    },
    sessions: {
      findByTokenHash: async (hash: string) => (hash === 'hash:session-token' ? createOauthSession() : null),
      touch: async () => undefined,
    },
    tokens: {
      hashSecret: (secret: string) => `hash:${secret}`,
      signSessionToken: async () => 'session-token',
      signVerificationToken: async () => 'verification-token',
      verifySessionToken: async (token: string) =>
        token === 'session-token' ? { email: oauthUser.email, role: 'member', sessionId: 'session-1', userId: oauthUser.id } : null,
    },
    users: {
      findById: async (userId: string) => (userId === oauthUser.id ? oauthUser : null),
    },
  } as AuthHonoPorts;

  return { ports, store };
};

export const createOauthRouterForTest = (input: {
  ports: AuthHonoPorts;
  stateCodec?: OAuthContinuationCodec;
}) => {
  const stateCodec = input.stateCodec ?? createOAuthHmacStateCodec({ secret: 'test-oauth-state-secret' });
  return {
    router: createOAuthRouter({
      consentUrl: 'http://localhost:5397/auth/oauth/consent',
      issuer: 'http://localhost:9197',
      loginUrl: 'http://localhost:5397/auth/login',
      ports: input.ports,
      stateCodec,
    }),
    stateCodec,
  };
};

export const authorizePath = (input: Record<string, string> = {}): string => {
  const params = new URLSearchParams({
    client_id: 'example-rp',
    code_challenge: 'pkce-challenge',
    code_challenge_method: 'S256',
    redirect_uri: 'http://localhost:5397/callback',
    response_type: 'code',
    scope: 'openid profile email',
    state: 'rp-state',
    ...input,
  });
  return `/oauth/authorize?${params.toString()}`;
};
