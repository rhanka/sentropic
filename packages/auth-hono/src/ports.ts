import type { JwksPort, OauthStateStorePort } from './oauth/state-store-types.js';

export type {
  AuthCodePayload,
  DpopProofRecord,
  JwksKeyRecord,
  JwksPort,
  JwksPublicJwk,
  OauthClientRecord,
  OauthStateStorePort,
  OauthTokenType,
  TokenMeta,
} from './oauth/state-store-types.js';

export type AuthHonoAccountStatus =
  | 'active'
  | 'pending_admin_approval'
  | 'approval_expired_readonly'
  | 'disabled_by_user'
  | 'disabled_by_admin'
  | (string & {});

export type AuthHonoChallengeType = 'registration' | 'authentication';

export interface AuthHonoDeviceInfo {
  name?: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface AuthHonoUserRecord {
  id: string;
  email: string | null;
  displayName: string | null;
  role: string;
  emailVerified: boolean;
  accountStatus: AuthHonoAccountStatus;
  approvalDueAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AuthHonoCreateUserInput {
  email: string;
  displayName?: string | null;
  role: string;
  emailVerified?: boolean;
  accountStatus?: AuthHonoAccountStatus;
  approvalDueAt?: Date | null;
}

export interface AuthHonoUpdateUserInput {
  email?: string | null;
  displayName?: string | null;
  role?: string;
  emailVerified?: boolean;
  accountStatus?: AuthHonoAccountStatus;
  approvalDueAt?: Date | null;
  updatedAt?: Date;
}

export interface AuthHonoUserPort {
  findById(userId: string): Promise<AuthHonoUserRecord | null>;
  findByEmail(email: string): Promise<AuthHonoUserRecord | null>;
  create(input: AuthHonoCreateUserInput): Promise<AuthHonoUserRecord>;
  update(userId: string, input: AuthHonoUpdateUserInput): Promise<AuthHonoUserRecord | null>;
  count(): Promise<number>;
}

export interface AuthHonoCredentialRecord {
  id: string;
  userId: string;
  credentialId: string;
  publicKey: Uint8Array | ArrayBuffer | string;
  counter: number;
  transports: string[] | null;
  name: string | null;
  deviceType: string | null;
  backedUp: boolean | null;
  lastUsedAt: Date | null;
  createdAt: Date;
  revokedAt: Date | null;
}

export interface AuthHonoCreateCredentialInput {
  userId: string;
  credentialId: string;
  publicKey: Uint8Array | ArrayBuffer | string;
  counter: number;
  transports?: string[] | null;
  name?: string | null;
  deviceType?: string | null;
  backedUp?: boolean | null;
}

export interface AuthHonoCredentialPort {
  findById(credentialRecordId: string): Promise<AuthHonoCredentialRecord | null>;
  findByCredentialId(credentialId: string): Promise<AuthHonoCredentialRecord | null>;
  listForUser(userId: string): Promise<AuthHonoCredentialRecord[]>;
  create(input: AuthHonoCreateCredentialInput): Promise<AuthHonoCredentialRecord>;
  updateCounter(credentialId: string, counter: number, lastUsedAt?: Date): Promise<void>;
  rename(credentialRecordId: string, userId: string, name: string): Promise<AuthHonoCredentialRecord | null>;
  revoke(credentialRecordId: string, userId: string): Promise<boolean>;
}

export interface AuthHonoChallengeRecord {
  id: string;
  challenge: string;
  userId: string | null;
  type: AuthHonoChallengeType;
  expiresAt: Date;
  used: boolean;
  createdAt: Date;
}

export interface AuthHonoCreateChallengeInput {
  challenge: string;
  userId?: string | null;
  type: AuthHonoChallengeType;
  expiresAt: Date;
}

export interface AuthHonoChallengePort {
  create(input: AuthHonoCreateChallengeInput): Promise<AuthHonoChallengeRecord>;
  findValid(challenge: string, type: AuthHonoChallengeType): Promise<AuthHonoChallengeRecord | null>;
  markUsed(challenge: string): Promise<void>;
  purgeExpired(now: Date): Promise<number>;
}

export interface AuthHonoSessionRecord {
  id: string;
  userId: string;
  sessionTokenHash: string;
  refreshTokenHash: string | null;
  deviceName: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  mfaVerified: boolean;
  expiresAt: Date;
  createdAt: Date;
  lastActivityAt: Date;
  revokedAt: Date | null;
}

export interface AuthHonoCreateSessionInput {
  id: string;
  userId: string;
  sessionTokenHash: string;
  refreshTokenHash?: string | null;
  deviceInfo?: AuthHonoDeviceInfo;
  mfaVerified?: boolean;
  expiresAt: Date;
  now: Date;
}

export interface AuthHonoSessionPort {
  create(input: AuthHonoCreateSessionInput): Promise<AuthHonoSessionRecord>;
  findById(sessionId: string): Promise<AuthHonoSessionRecord | null>;
  findByTokenHash(sessionTokenHash: string): Promise<AuthHonoSessionRecord | null>;
  findByRefreshTokenHash(refreshTokenHash: string): Promise<AuthHonoSessionRecord | null>;
  touch(sessionId: string, now: Date): Promise<void>;
  updateTokens(input: {
    expiresAt: Date;
    refreshTokenHash: string;
    sessionId: string;
    sessionTokenHash: string;
  }): Promise<AuthHonoSessionRecord | null>;
  revoke(sessionId: string): Promise<boolean>;
  revokeAllForUser(userId: string): Promise<number>;
  listForUser(userId: string): Promise<AuthHonoSessionRecord[]>;
}

export interface AuthHonoEmailVerificationRecord {
  id: string;
  email: string;
  codeHash: string;
  verificationToken: string | null;
  expiresAt: Date;
  used: boolean;
  createdAt: Date;
}

export interface AuthHonoEmailVerificationPort {
  countRecent(email: string, since: Date): Promise<number>;
  createCode(input: {
    email: string;
    codeHash: string;
    expiresAt: Date;
    now: Date;
  }): Promise<AuthHonoEmailVerificationRecord>;
  findLatestValidCode(email: string, codeHash: string, now: Date): Promise<AuthHonoEmailVerificationRecord | null>;
  markUsedWithVerificationToken(id: string, verificationToken: string): Promise<void>;
  verifyToken(email: string, verificationToken: string, now: Date): Promise<boolean>;
}

export interface AuthHonoMagicLinkRecord {
  id: string;
  tokenHash: string;
  email: string;
  userId: string | null;
  expiresAt: Date;
  used: boolean;
  createdAt: Date;
}

export interface AuthHonoMagicLinkPort {
  create(input: {
    email: string;
    tokenHash: string;
    userId?: string | null;
    expiresAt: Date;
    now: Date;
  }): Promise<AuthHonoMagicLinkRecord>;
  findValidByTokenHash(tokenHash: string, now: Date): Promise<AuthHonoMagicLinkRecord | null>;
  markUsed(id: string, userId?: string | null): Promise<void>;
}

export interface AuthHonoEmailDeliveryPort {
  sendVerificationCode(input: { email: string; code: string; expiresAt: Date }): Promise<void>;
  sendMagicLink(input: { email: string; token: string; expiresAt: Date; url: string }): Promise<void>;
}

export interface AuthHonoCookiePort {
  readSessionToken(request: Request): string | null;
  readRefreshToken(request: Request): string | null;
  serializeSessionCookie(input: { token: string; expiresAt: Date }): string;
  serializeRefreshCookie(input: { token: string; expiresAt: Date }): string;
  serializeClearedSessionCookie(): string;
  serializeClearedRefreshCookie(): string;
}

export interface AuthHonoSessionClaims {
  userId: string;
  sessionId: string;
  role: string;
  email?: string | null;
  displayName?: string | null;
}

export interface AuthHonoTokenPort {
  hashSecret(secret: string): Promise<string> | string;
  signSessionToken(claims: AuthHonoSessionClaims, expiresAt: Date): Promise<string>;
  verifySessionToken(token: string): Promise<AuthHonoSessionClaims | null>;
  signVerificationToken(input: { email: string; expiresAt: Date }): Promise<string>;
}

export type AuthHonoAuditLevel = 'debug' | 'info' | 'warn' | 'error';

export interface AuthHonoAuditLogPort {
  record(level: AuthHonoAuditLevel, event: string, fields?: Record<string, unknown>): Promise<void> | void;
}

export interface AuthHonoClockPort {
  now(): Date;
  addSeconds(date: Date, seconds: number): Date;
}

export interface AuthHonoRandomPort {
  uuid(): string;
  bytes(length: number): Uint8Array;
  numericCode(length: number): string;
  token(bytes: number): string;
}

export interface AuthHonoAccountPolicyDecision {
  allowed: boolean;
  status?: number;
  code?: string;
  message?: string;
}

export interface AuthHonoAccountPolicyPort {
  normalizeEmail(email: string): string;
  deriveDisplayName(email: string): string;
  resolveUserVerification?(user: AuthHonoUserRecord): 'discouraged' | 'preferred' | 'required';
  roleForNewUser(input: { email: string; isFirstUser: boolean }): Promise<string> | string;
  statusForNewUser(input: { email: string; isFirstUser: boolean; now: Date }): Promise<{
    accountStatus: AuthHonoAccountStatus;
    approvalDueAt: Date | null;
  }> | {
    accountStatus: AuthHonoAccountStatus;
    approvalDueAt: Date | null;
  };
  canAuthenticate(user: AuthHonoUserRecord, now: Date): Promise<AuthHonoAccountPolicyDecision> | AuthHonoAccountPolicyDecision;
  resolveSessionRole(user: AuthHonoUserRecord, now: Date): Promise<string> | string;
  afterUserCreated?(user: AuthHonoUserRecord): Promise<void> | void;
}

export interface AuthHonoPorts {
  users: AuthHonoUserPort;
  credentials: AuthHonoCredentialPort;
  challenges: AuthHonoChallengePort;
  sessions: AuthHonoSessionPort;
  emailVerification: AuthHonoEmailVerificationPort;
  magicLinks: AuthHonoMagicLinkPort;
  emailDelivery: AuthHonoEmailDeliveryPort;
  cookies: AuthHonoCookiePort;
  tokens: AuthHonoTokenPort;
  auditLog: AuthHonoAuditLogPort;
  clock: AuthHonoClockPort;
  random: AuthHonoRandomPort;
  accountPolicy: AuthHonoAccountPolicyPort;
  oauthStateStore: OauthStateStorePort;
  jwks: JwksPort;
}
