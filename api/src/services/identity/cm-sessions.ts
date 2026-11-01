// Lot A4: app-facing login-session facade over the CM custody stores. The token
// binding lives in `cm_identity.identity_login_token_bindings` (custody
// `BoundLoginSessionStoreV1`); the lifecycle row (status / refresh count) lives
// in `cm_identity.identity_login_sessions` (core `LoginSessionStore`). Writes go
// through the custody unit of work so both tables move in ONE serializable
// transaction; the CM store owns both rows.

import { IdentityCustodyErrorV1, type BoundLoginSessionV1, type SignedLoginBindingV1 } from '@sentropic/cluster-mesh';

import { CM_IDENTITY_SCHEMA, cmStoreClient, getCmIdentity } from './cm-identity';
import { runCmIdentityWrite } from './cm-transaction';

export interface CmSessionRecord {
  readonly id: string;
  readonly userId: string;
  readonly sessionTokenHash: string;
  readonly refreshTokenHash: string | null;
  readonly deviceName: string | null;
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
  readonly mfaVerified: boolean;
  readonly authTime: number; // epoch seconds, matches JWT login.authTime
  readonly sessionVersion: number; // epoch ms, matches JWT login.sessionVersion
  readonly expiresAt: Date;
  readonly createdAt: Date;
  readonly lastActivityAt: Date;
  readonly revokedAt: Date | null;
}

export interface CmCreateSessionInput {
  readonly id: string;
  readonly userId: string;
  readonly sessionTokenHash: string;
  readonly refreshTokenHash?: string | null;
  readonly deviceInfo?: { name?: string; ipAddress?: string; userAgent?: string };
  readonly mfaVerified?: boolean;
  readonly expiresAt: Date;
  readonly now: Date;
}

export interface CmRotateSessionInput {
  readonly sessionId: string;
  readonly userId: string;
  readonly expectedRefreshTokenHash: string;
  readonly expiresAt: Date;
  readonly sessionTokenHash: string;
  readonly refreshTokenHash: string;
  readonly verifiedLogin: SignedLoginBindingV1;
}

const date = (value: string | null | undefined): Date | null =>
  value ? new Date(value) : null;

const toRecord = (bound: BoundLoginSessionV1, lifecycle: { status: string; revokedAt?: string } | null): CmSessionRecord => ({
  id: bound.sessionId,
  userId: bound.userId,
  sessionTokenHash: bound.sessionTokenHash,
  refreshTokenHash: bound.refreshTokenHash,
  deviceName: bound.deviceName,
  ipAddress: bound.ipAddress,
  userAgent: bound.userAgent,
  mfaVerified: bound.login.mfaVerified,
  authTime: bound.login.authTime,
  sessionVersion: bound.login.sessionVersion,
  expiresAt: new Date(bound.expiresAt),
  createdAt: new Date(bound.createdAt),
  lastActivityAt: date(bound.lastActivityAt) ?? new Date(bound.createdAt),
  revokedAt: date(bound.revokedAt) ?? (lifecycle?.status === 'revoked' ? date(lifecycle.revokedAt) : null),
});

const lifecycleOf = async (sessionId: string) => {
  const { core } = getCmIdentity();
  return core.sessions.findSession(sessionId);
};

export const createCmSession = async (input: CmCreateSessionInput): Promise<CmSessionRecord> => {
  const now = input.now.toISOString();
  const bound: BoundLoginSessionV1 = {
    sessionId: input.id,
    userId: input.userId,
    sessionTokenHash: input.sessionTokenHash,
    refreshTokenHash: input.refreshTokenHash ?? null,
    login: {
      mfaVerified: input.mfaVerified ?? false,
      authTime: Math.floor(input.now.getTime() / 1000),
      sessionVersion: input.now.getTime(),
    },
    rotationVersion: 1,
    createdAt: now,
    expiresAt: input.expiresAt.toISOString(),
    revokedAt: null,
    deviceName: input.deviceInfo?.name ?? null,
    ipAddress: input.deviceInfo?.ipAddress ?? null,
    userAgent: input.deviceInfo?.userAgent ?? null,
    lastActivityAt: now,
  };
  await runCmIdentityWrite(async (tx) => {
    await tx.lockSubject(input.userId);
    await tx.custody.sessions.insert(bound);
  });
  const created = await findCmSessionById(input.id);
  if (!created) throw new Error('Failed to create session.');
  return created;
};

export const findCmSessionById = async (sessionId: string): Promise<CmSessionRecord | null> => {
  const { custody } = getCmIdentity();
  const bound = await custody.sessions.findById(sessionId);
  if (!bound) return null;
  return toRecord(bound, await lifecycleOf(sessionId));
};

export const findCmSessionByTokenHash = async (sessionTokenHash: string): Promise<CmSessionRecord | null> => {
  const { custody } = getCmIdentity();
  const bound = await custody.sessions.findBySessionTokenHash(sessionTokenHash);
  if (!bound) return null;
  return toRecord(bound, await lifecycleOf(bound.sessionId));
};

export const findCmSessionByRefreshTokenHash = async (refreshTokenHash: string): Promise<CmSessionRecord | null> => {
  const { custody } = getCmIdentity();
  const bound = await custody.sessions.findByRefreshTokenHash(refreshTokenHash);
  if (!bound) return null;
  return toRecord(bound, await lifecycleOf(bound.sessionId));
};

export const listCmSessionsForUser = async (userId: string): Promise<CmSessionRecord[]> => {
  const { custody } = getCmIdentity();
  const bound = await custody.sessions.listForUser(userId);
  const records: CmSessionRecord[] = [];
  for (const row of bound) records.push(toRecord(row, await lifecycleOf(row.sessionId)));
  return records;
};

export const countCmSessions = async (): Promise<number> => {
  const result = await cmStoreClient.query(
    `SELECT COUNT(*)::int AS n FROM ${CM_IDENTITY_SCHEMA}.identity_login_sessions WHERE "status" = 'active' AND "revoked_at" IS NULL`,
    [],
  );
  const row = result.rows[0] as { n: number } | undefined;
  return row?.n ?? 0;
};

export const touchCmSession = async (sessionId: string, now: Date): Promise<void> => {
  await runCmIdentityWrite(async (tx) => {
    const session = await tx.custody.sessions.findById(sessionId);
    if (!session) return;
    await tx.lockSubject(session.userId);
    await tx.custody.sessions.touchActivity(sessionId, now.toISOString());
  });
};

export const rotateCmSession = async (input: CmRotateSessionInput): Promise<CmSessionRecord | null> => {
  const at = new Date().toISOString();
  const rotated = await runCmIdentityWrite(async (tx) => {
    await tx.lockSubject(input.userId);
    const current = await tx.custody.sessions.findByRefreshTokenHash(input.expectedRefreshTokenHash);
    if (!current || current.sessionId !== input.sessionId || current.userId !== input.userId) return null;
    return tx.custody.sessions.rotate({
      sessionId: input.sessionId,
      userId: input.userId,
      expectedRefreshTokenHash: input.expectedRefreshTokenHash,
      expectedRotationVersion: current.rotationVersion,
      // The signed login lineage is immutable across rotation: keep the original
      // authTime/sessionVersion so the refreshed JWT still matches the binding.
      verifiedLogin: input.verifiedLogin,
      nextSessionTokenHash: input.sessionTokenHash,
      nextRefreshTokenHash: input.refreshTokenHash,
      nextExpiresAt: input.expiresAt.toISOString(),
      at,
    });
  });
  return rotated ? toRecord(rotated, await lifecycleOf(input.sessionId)) : null;
};

export interface CmUpdateSessionTokensInput {
  readonly sessionId: string;
  readonly sessionTokenHash: string;
  readonly refreshTokenHash: string;
  readonly expiresAt: Date;
}

/** r6 forbids revision-free token replacement; callers use the signed CM session service. */
export const updateCmSessionTokens = async (_input: CmUpdateSessionTokensInput): Promise<CmSessionRecord | null> => {
  throw new IdentityCustodyErrorV1('identity_contract_unavailable');
};

export const revokeCmSession = async (sessionId: string): Promise<boolean> => {
  const at = new Date().toISOString();
  const existing = await findCmSessionById(sessionId);
  if (!existing) return false;
  await runCmIdentityWrite(async (tx) => {
    await tx.lockSubject(existing.userId);
    await tx.custody.sessions.revoke(sessionId, at);
  });
  return true;
};

export const revokeAllCmSessionsForUser = async (userId: string): Promise<number> => {
  const at = new Date().toISOString();
  return runCmIdentityWrite(async (tx) => {
    await tx.lockSubject(userId);
    return tx.custody.sessions.revokeAllForUser(userId, at);
  });
};
