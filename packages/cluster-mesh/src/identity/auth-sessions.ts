import { createHash } from 'node:crypto';
import type { AuthHonoSessionService, AuthHonoSessionPort, AuthHonoSessionRecord, AuthHonoUserPort, AuthHonoAccountPolicyPort } from '@sentropic/auth-hono';
import type { IdentityAuthBindingInput } from '../identity-contracts/custody-auth.js';
import type { BoundLoginSessionV1, SignedLoginBindingV1 } from '../identity-contracts/custody.js';
import { IdentityCustodyErrorV1 } from '../identity-contracts/custody-errors.js';
import { AccountNotActiveError } from '../identity-contracts/errors.js';
import { identityDeliveryId } from '../storage/identity/custody-import-deliveries.js';
import { authRole } from './auth-users.js';

const projectSession = (record: BoundLoginSessionV1): AuthHonoSessionRecord => ({
  id: record.sessionId, userId: record.userId, sessionTokenHash: record.sessionTokenHash, refreshTokenHash: record.refreshTokenHash,
  deviceName: record.deviceName, ipAddress: record.ipAddress, userAgent: record.userAgent, mfaVerified: record.login.mfaVerified,
  expiresAt: new Date(record.expiresAt), createdAt: new Date(record.createdAt), lastActivityAt: new Date(record.lastActivityAt ?? record.createdAt), revokedAt: record.revokedAt ? new Date(record.revokedAt) : null,
});
export const authSessionService = <H>(input: IdentityAuthBindingInput<H>, users: AuthHonoUserPort, policy: AuthHonoAccountPolicyPort, check: () => void) => {
  const { tx } = input, store = tx.custody.sessions;
  const now = () => input.hostPorts.clock.now();
  const hash = async (token: string) => { const bytes = Buffer.from(token, 'utf8'); try { return await input.digest.sha256(bytes); } finally { bytes.fill(0); } };
  const sign = async (userId: string, sessionId: string, role: string, login: SignedLoginBindingV1, expiresAt: string) => ({
    sessionToken: await input.loginTokens.sign({ userId, sessionId, role: authRole(role), login, expiresAt, tokenUse: 'session' }),
    refreshToken: await input.loginTokens.sign({ userId, sessionId, role: authRole(role), login, expiresAt, tokenUse: 'refresh' }),
  });
  const readToken = async (token: string, use: 'session' | 'refresh') => {
    check(); const bytes = Buffer.from(token, 'utf8');
    try {
      let claims;
      try { claims = await input.loginTokens.verify(bytes, use, now().toISOString()); }
      catch (error) { if (error instanceof IdentityCustodyErrorV1 && ['login_binding_mismatch', 'identity_material_invalid'].includes(error.code)) return null; throw error; }
      if (claims.tokenUse !== use || claims.expiresAt <= now().toISOString()) return null;
      const account = await tx.stores.accounts.findAccount(claims.userId);
      if (!account || account.accountStatus === 'deleted') return null;
      await tx.lockSubject(claims.userId);
      const record = await store.findById(claims.sessionId), digest = await hash(token);
      if (!record || record.userId !== claims.userId || record.revokedAt || record.expiresAt <= now().toISOString()
        || digest !== (use === 'session' ? record.sessionTokenHash : record.refreshTokenHash)) return null;
      if (use === 'refresh' && (!claims.login || claims.login.authTime !== record.login.authTime || claims.login.sessionVersion !== record.login.sessionVersion || claims.login.mfaVerified !== record.login.mfaVerified)) return null;
      const user = await users.findById(record.userId);
      if (!user || !['active', 'pending_admin_approval', 'approval_expired_readonly'].includes(user.accountStatus) || (use === 'session' && !user.emailVerified)) return null;
      return { record, user, role: await policy.resolveSessionRole(user, now()) };
    } finally { bytes.fill(0); }
  };
  const enqueue = async (operationId: string, userId: string, targetKind: 'login_session' | 'subject', targetRef: string) => {
    const at = now().toISOString(), step = 'remote_reader_sessions' as const;
    await tx.revocationOutbox.enqueue({ deliveryId: identityDeliveryId(operationId, step, targetKind, targetRef), operationId, step,
      subjectId: userId, targetKind, targetRef, custodyRef: null, state: 'pending', createdAt: at, nextAttemptAt: at, deliveredAt: null, claimOwner: null, leaseUntil: null, claimVersion: 0, attemptCount: 0 });
  };
  const group = (tuple: unknown[]) => createHash('sha256').update(JSON.stringify(tuple)).digest('hex');
  const service: AuthHonoSessionService = {
    createSession: async (value) => {
      check(); await tx.lockSubject(value.user.id);
      const user = await users.findById(value.user.id);
      if (!user || !(await policy.canAuthenticate(user, now())).allowed) throw new AccountNotActiveError(value.user.id);
      const at = now(), sessionId = input.hostPorts.random.uuid(), expiresAt = new Date(at.getTime() + 604800_000);
      const login = { mfaVerified: value.mfaVerified === true, authTime: Math.floor(at.getTime() / 1000), sessionVersion: at.getTime() };
      const tokens = await sign(user.id, sessionId, await policy.resolveSessionRole(user, at), login, expiresAt.toISOString());
      await store.insert({ sessionId, userId: user.id, sessionTokenHash: await hash(tokens.sessionToken), refreshTokenHash: await hash(tokens.refreshToken), login,
        rotationVersion: 0, createdAt: at.toISOString(), expiresAt: expiresAt.toISOString(), revokedAt: null,
        deviceName: value.deviceInfo?.name ?? null, ipAddress: value.deviceInfo?.ipAddress ?? null, userAgent: value.deviceInfo?.userAgent ?? null, lastActivityAt: at.toISOString() });
      return { ...tokens, sessionId, expiresAt };
    },
    validateSessionToken: async (token) => {
      const found = await readToken(token, 'session');
      if (!found) return null;
      await store.touchActivity(found.record.sessionId, now().toISOString());
      return { role: found.role, user: found.user, sessionRecord: projectSession(found.record), session: { userId: found.user.id, sessionId: found.record.sessionId, role: found.role } };
    },
    refreshSession: async (token) => {
      const found = await readToken(token, 'refresh');
      if (!found) return null;
      const { record, user, role } = found, expiresAt = new Date(now().getTime() + 604800_000);
      const tokens = await sign(user.id, record.sessionId, role, record.login, expiresAt.toISOString());
      await store.rotate({ sessionId: record.sessionId, userId: user.id, expectedRefreshTokenHash: await hash(token), expectedRotationVersion: record.rotationVersion,
        verifiedLogin: record.login, nextSessionTokenHash: await hash(tokens.sessionToken), nextRefreshTokenHash: await hash(tokens.refreshToken), nextExpiresAt: expiresAt.toISOString(), at: now().toISOString() });
      return { ...tokens, sessionId: record.sessionId, expiresAt };
    },
    listUserSessions: async (userId) => { check(); return (await store.listForUser(userId)).map(projectSession); },
    revokeSession: async (sessionId) => {
      check(); const record = await store.findById(sessionId);
      if (!record) return false;
      await tx.lockSubject(record.userId); await store.revoke(sessionId, now().toISOString());
      await enqueue(group(['session-revoke', sessionId]), record.userId, 'login_session', sessionId); return true;
    },
    revokeAllSessions: async (userId) => {
      check(); await tx.lockSubject(userId); const rows = await store.listForUser(userId);
      const ids = [...new Set(rows.map((row) => row.sessionId))].sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
      const operationId = group(['sessions-revoke-all', userId, ids]), count = await store.revokeAllForUser(userId, now().toISOString());
      for (const id of ids) await enqueue(operationId, userId, 'login_session', id);
      await enqueue(operationId, userId, 'subject', userId); return count;
    },
  };
  const find = async (promise: Promise<BoundLoginSessionV1 | null>) => { check(); const record = await promise; return record ? projectSession(record) : null; };
  const unsupported = async (): Promise<never> => { throw new IdentityCustodyErrorV1('identity_transaction_unbound'); };
  const port: AuthHonoSessionPort = {
    create: unsupported, updateTokens: unsupported, findById: (id) => find(store.findById(id)), findByTokenHash: (hash) => find(store.findBySessionTokenHash(hash)),
    findByRefreshTokenHash: (hash) => find(store.findByRefreshTokenHash(hash)), listForUser: service.listUserSessions,
    revoke: service.revokeSession, revokeAllForUser: service.revokeAllSessions,
    touch: async (id, at) => { check(); const record = await store.findById(id); if (!record) return; await tx.lockSubject(record.userId); await store.touchActivity(id, at.toISOString()); },
  };
  return { service, port };
};
