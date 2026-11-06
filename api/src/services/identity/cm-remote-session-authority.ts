import { IdentityCustodyErrorV1, type BoundLoginSessionV1 } from '@sentropic/cluster-mesh';
import type { IdentityAuthHonoTransactionBindingV1 } from '@sentropic/cluster-mesh/identity/auth-hono';
import { closeRemoteSessionAuthority, getRemoteSessionAuthority } from '../auth/remote-private-session';
import type { CmIdentityTransaction } from './cm-transaction';

/** Issuer-private projections publish only after the CM commit is acknowledged. */
export function bindCmRemoteSessionAuthority(binding: IdentityAuthHonoTransactionBindingV1,
  tx: CmIdentityTransaction, committed: Array<() => void>): IdentityAuthHonoTransactionBindingV1 {
  const project = (record: BoundLoginSessionV1) => {
    if (!record.refreshTokenHash) throw new IdentityCustodyErrorV1('identity_material_missing');
    return ({
    sessionId: record.sessionId, userId: record.userId, login: { ...record.login }, revoked: false,
    sessionTokenHash: record.sessionTokenHash, refreshTokenHash: record.refreshTokenHash,
    expiresAt: Date.parse(record.expiresAt),
    });
  };
  const revoke = (ids: string[], userId?: string) => committed.push(() => {
    try {
      const authority = getRemoteSessionAuthority();
      for (const id of ids) authority?.revoke(id);
      if (userId) authority?.revokeUser(userId);
    } catch {
      // CM destruction remains committed. Recovery of shared rows or files
      // cannot reopen this issuer after an indeterminate private revocation.
      closeRemoteSessionAuthority();
    }
  });
  const sessions: typeof binding.sessions = {
    ...binding.sessions,
    async createSession(input) {
      const result = await binding.sessions.createSession(input);
      const record = await tx.custody.sessions.findById(result.sessionId);
      if (!record) throw new IdentityCustodyErrorV1('identity_material_missing');
      const value = project(record);
      committed.push(() => { getRemoteSessionAuthority()?.create(value); });
      return result;
    },
    async refreshSession(token) {
      const before = await tx.custody.sessions.findByRefreshTokenHash(
        await binding.ports.tokens.hashSecret(token));
      const result = await binding.sessions.refreshSession(token);
      if (result && before) {
        if (!before.refreshTokenHash) throw new IdentityCustodyErrorV1('identity_material_missing');
        const record = await tx.custody.sessions.findById(result.sessionId);
        if (!record) throw new IdentityCustodyErrorV1('identity_material_missing');
        const value = project(record), expected = before.refreshTokenHash;
        committed.push(() => { getRemoteSessionAuthority()?.rotate(expected, value); });
      }
      return result;
    },
    async revokeSession(id) {
      const result = await binding.sessions.revokeSession(id);
      if (result) revoke([id]);
      return result;
    },
    async revokeAllSessions(userId) {
      const rows = await tx.custody.sessions.listForUser(userId);
      const result = await binding.sessions.revokeAllSessions(userId);
      revoke(rows.map(row => row.sessionId), userId);
      return result;
    },
  };
  return { ...binding, get deferredMail() { return binding.deferredMail; }, sessions, ports: { ...binding.ports, sessions: {
    ...binding.ports.sessions, revoke: sessions.revokeSession, revokeAllForUser: sessions.revokeAllSessions,
  } } };
}
