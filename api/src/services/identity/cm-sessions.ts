// Lot A4: app-facing login-session facade over the CM custody stores. The token
// binding lives in `cm_identity.identity_login_token_bindings` (custody
// `BoundLoginSessionStoreV1`); the lifecycle row (status / refresh count) lives
// in `cm_identity.identity_login_sessions` (core `LoginSessionStore`). Writes go
// through the custody unit of work so both tables move in ONE serializable
// transaction; the core row is written via the raw host session inside it.

import type { BoundLoginSessionV1, IdentityTransactionV1, PostgresCustodyHandle } from '@sentropic/cluster-mesh';

import { CM_IDENTITY_SCHEMA, cmStoreClient, getCmIdentity } from './cm-identity';

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
  const { unitOfWork } = getCmIdentity();
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
  await unitOfWork.runWrite({ mode: 'write', deadlineMs: 10_000 }, async (tx: IdentityTransactionV1<PostgresCustodyHandle>) => {
    await tx.stores.sessions.insert(bound);
    await tx.hostTransaction.raw.execute({
      text: `INSERT INTO "${CM_IDENTITY_SCHEMA}"."identity_login_sessions"
        ("session_id","user_id","status","mfa_state","created_at","expires_at","revoked_at","refresh_count")
        VALUES ($1,$2,'active',$3,$4,$5,NULL,0)`,
      values: [input.id, input.userId, bound.login.mfaVerified ? 'step_up' : 'none', now, bound.expiresAt],
    });
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
    `SELECT COUNT(*)::int AS n FROM ${CM_IDENTITY_SCHEMA}.identity_login_token_bindings WHERE "revoked_at" IS NULL`,
    [],
  );
  const row = result.rows[0] as { n: number } | undefined;
  return row?.n ?? 0;
};

export const touchCmSession = async (sessionId: string, now: Date): Promise<void> => {
  const { custody } = getCmIdentity();
  await custody.sessions.touchActivity(sessionId, now.toISOString());
};

export const rotateCmSession = async (input: CmRotateSessionInput): Promise<CmSessionRecord | null> => {
  const { unitOfWork } = getCmIdentity();
  const at = new Date().toISOString();
  const current = await findCmSessionByRefreshTokenHash(input.expectedRefreshTokenHash);
  if (!current || current.id !== input.sessionId || current.userId !== input.userId) return null;
  const rotated = await unitOfWork.runWrite({ mode: 'write', deadlineMs: 10_000 }, async (tx) => {
    const next = await tx.stores.sessions.rotate({
      sessionId: input.sessionId,
      userId: input.userId,
      expectedRefreshTokenHash: input.expectedRefreshTokenHash,
      expectedRotationVersion: current ? Number((await custodyRotationVersion(current.id))) : 1,
      // The signed login lineage is immutable across rotation: keep the original
      // authTime/sessionVersion so the refreshed JWT still matches the binding.
      verifiedLogin: { mfaVerified: current.mfaVerified, authTime: current.authTime, sessionVersion: current.sessionVersion },
      nextSessionTokenHash: input.sessionTokenHash,
      nextRefreshTokenHash: input.refreshTokenHash,
      nextExpiresAt: input.expiresAt.toISOString(),
      at,
    });
    await tx.hostTransaction.raw.execute({
      text: `UPDATE "${CM_IDENTITY_SCHEMA}"."identity_login_sessions"
        SET "expires_at" = $2, "refresh_count" = "refresh_count" + 1 WHERE "session_id" = $1`,
      values: [input.sessionId, input.expiresAt.toISOString()],
    });
    return next;
  });
  return toRecord(rotated, await lifecycleOf(input.sessionId));
};

const custodyRotationVersion = async (sessionId: string): Promise<number> => {
  const { custody } = getCmIdentity();
  const bound = await custody.sessions.findById(sessionId);
  return bound?.rotationVersion ?? 1;
};

export interface CmUpdateSessionTokensInput {
  readonly sessionId: string;
  readonly sessionTokenHash: string;
  readonly refreshTokenHash: string;
  readonly expiresAt: Date;
}

// Plain token replacement (no rotation CAS): used by the OAuth session port's
// updateTokens. Both tables move in ONE custody unit-of-work transaction.
export const updateCmSessionTokens = async (input: CmUpdateSessionTokensInput): Promise<CmSessionRecord | null> => {
  const { unitOfWork } = getCmIdentity();
  const at = new Date().toISOString();
  await unitOfWork.runWrite({ mode: 'write', deadlineMs: 10_000 }, async (tx) => {
    await tx.hostTransaction.raw.execute({
      text: `UPDATE "${CM_IDENTITY_SCHEMA}"."identity_login_token_bindings"
        SET "session_token_hash" = $2, "refresh_token_hash" = $3, "last_activity_at" = $4
        WHERE "session_id" = $1`,
      values: [input.sessionId, input.sessionTokenHash, input.refreshTokenHash, at],
    });
    await tx.hostTransaction.raw.execute({
      text: `UPDATE "${CM_IDENTITY_SCHEMA}"."identity_login_sessions"
        SET "expires_at" = $2 WHERE "session_id" = $1`,
      values: [input.sessionId, input.expiresAt.toISOString()],
    });
  });
  return findCmSessionById(input.sessionId);
};

export const revokeCmSession = async (sessionId: string): Promise<boolean> => {
  const { unitOfWork } = getCmIdentity();
  const at = new Date().toISOString();
  const existing = await findCmSessionById(sessionId);
  if (!existing) return false;
  await unitOfWork.runWrite({ mode: 'write', deadlineMs: 10_000 }, async (tx) => {
    await tx.stores.sessions.revoke(sessionId, at);
    await tx.hostTransaction.raw.execute({
      text: `UPDATE "${CM_IDENTITY_SCHEMA}"."identity_login_sessions"
        SET "status" = 'revoked', "revoked_at" = $2 WHERE "session_id" = $1`,
      values: [sessionId, at],
    });
  });
  return true;
};

export const revokeAllCmSessionsForUser = async (userId: string): Promise<number> => {
  const { unitOfWork } = getCmIdentity();
  const at = new Date().toISOString();
  return unitOfWork.runWrite({ mode: 'write', deadlineMs: 30_000 }, async (tx) => {
    const count = await tx.stores.sessions.revokeAllForUser(userId, at);
    await tx.hostTransaction.raw.execute({
      text: `UPDATE "${CM_IDENTITY_SCHEMA}"."identity_login_sessions"
        SET "status" = 'revoked', "revoked_at" = $2
        WHERE "user_id" = $1 AND "status" = 'active'`,
      values: [userId, at],
    });
    return count;
  });
};
