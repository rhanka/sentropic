import type { IdentitySubjectLifecyclePortV1 } from '../../identity-contracts/custody-operations.js';
import { IdentityCustodyErrorV1 } from '../../identity-contracts/custody-errors.js';
import { IdentityNotFoundError } from '../../identity-contracts/errors.js';
import { assertCanonicalEmailV1 } from '../../identity/custody-crypto.js';
import type { CustodyOpHost } from './custody-host.js';
import { boundIdentitySql } from './custody-transaction-ports.js';

export const subjectLifecycle = (host: CustodyOpHost): IdentitySubjectLifecyclePortV1 => {
  const sql = boundIdentitySql(host);
  const lock = async (kind: string, id: string): Promise<void> => {
    if (host.profile === 'postgres') await sql.query('SELECT pg_advisory_xact_lock(hashtextextended(?, 0))', [JSON.stringify([kind, id])]);
  };
  const checkFence = async (userId: string): Promise<void> => {
    const [fence] = await sql.query(`SELECT retired_at FROM ${sql.table('identity_subject_fences')} WHERE user_id = ?`, [userId]);
    if (fence?.retired_at != null) throw new IdentityCustodyErrorV1('identity_subject_retired');
  };
  return {
    register: async (account, profile) => {
      assertCanonicalEmailV1(account.email);
      if (!account.userId || profile.userId !== account.userId) throw new IdentityCustodyErrorV1('identity_material_invalid');
      await lock('subject', account.userId);
      await checkFence(account.userId);
      await lock('email', account.email);
      await host.journal.insertAccountCore(account);
      await host.journal.ensureLiveFence(account.userId, account.createdAt);
      await host.stores.profiles.put(profile);
    },
    updateEmail: async (userId, email, at) => {
      assertCanonicalEmailV1(email);
      await lock('subject', userId);
      await checkFence(userId);
      const account = await host.journal.findAccountCore(userId);
      if (!account) throw new IdentityNotFoundError('user', userId);
      for (const key of [...new Set([account.email, email])].sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)))) await lock('email', key);
      await sql.query(`UPDATE ${sql.table('identity_user_accounts')} SET email = ?, updated_at = ? WHERE user_id = ? RETURNING user_id`, [email, at, userId]);
      return { ...account, email, updatedAt: at };
    },
  };
};
