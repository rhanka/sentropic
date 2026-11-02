import type { AuthHonoFederationPort, AuthHonoIdentityRecord } from '@sentropic/auth-hono';
import type { IdentityAuthBindingInput } from '../identity-contracts/custody-auth.js';
import type { SocialIdentityV1 } from '../identity-contracts/custody.js';
import { IdentityCustodyErrorV1 } from '../identity-contracts/custody-errors.js';
import { IdentitySocialRaceRetrySignal } from '../storage/identity/custody-shared.js';
import { boundIdentitySql } from '../storage/identity/custody-transaction-ports.js';
import { identityTransactionHost } from '../storage/identity/custody-transaction-guards.js';

export const authFederationPort = <H>(input: IdentityAuthBindingInput<H>, check: () => void): AuthHonoFederationPort => {
  const { tx } = input, snapshots = new Map<string, SocialIdentityV1>();
  const project = (row: SocialIdentityV1 | null): AuthHonoIdentityRecord | null => {
    if (!row) return null;
    if (row.revokedAt) throw new IdentityCustodyErrorV1('social_subject_conflict');
    snapshots.set(row.proofId, row);
    return { id: row.proofId, userId: row.userId, provider: row.provider, providerSubject: row.providerSubject, providerTenant: row.providerTenant,
      emailAtLink: row.emailAtLink, emailVerifiedByProvider: row.emailVerifiedByProvider, linkedAt: new Date(row.linkedAt), lastLoginAt: row.lastLoginAt ? new Date(row.lastLoginAt) : null };
  };
  return {
    findIdentityBySubject: async (provider, subject) => { check(); return project(await tx.custody.social.findBySubject(provider, subject)); },
    findIdentitiesForUser: async (id) => { check(); return (await tx.custody.social.listForUser(id)).filter((row) => !row.revokedAt).map((row) => project(row)!); },
    linkIdentity: async (value) => {
      check(); await tx.lockSubject(value.userId);
      const row: SocialIdentityV1 = { proofId: input.hostPorts.random.uuid(), userId: value.userId, provider: value.provider, providerSubject: value.providerSubject,
        providerTenant: value.providerTenant ?? null, emailAtLink: value.emailAtLink, emailVerifiedByProvider: value.emailVerifiedByProvider,
        linkedAt: value.now.toISOString(), lastLoginAt: null, revokedAt: null, revision: 0 };
      try { await tx.custody.social.insert(row); } catch (error) {
        if (error instanceof IdentityCustodyErrorV1 && error.code === 'social_subject_conflict') throw new IdentitySocialRaceRetrySignal();
        throw error;
      }
      return project(row)!;
    },
    unlinkIdentity: async (id, provider, subject) => {
      check(); await tx.lockSubject(id); const row = await tx.custody.social.findBySubject(provider, subject);
      if (!row || row.userId !== id) return false;
      await tx.custody.social.unlink(row.proofId, id, row.revision, input.hostPorts.clock.now().toISOString()); return true;
    },
    touchLogin: async (id, at) => {
      check(); const row = snapshots.get(id);
      if (!row) throw new IdentityCustodyErrorV1('identity_transaction_unbound');
      await tx.lockSubject(row.userId); await tx.custody.social.touchLogin(id, row.revision, at.toISOString());
      snapshots.set(id, { ...row, revision: row.revision + 1, lastLoginAt: at.toISOString() });
    },
    isUserCredentialed: async (id) => {
      check(); await tx.lockSubject(id);
      if ((await tx.custody.credentials.listForUser(id)).some((row) => !row.revokedAt) || (await tx.custody.social.listForUser(id)).some((row) => !row.revokedAt)) return true;
      const sql = boundIdentitySql(identityTransactionHost(tx));
      return (await sql.query(`SELECT proof_id FROM ${sql.table('identity_single_use_proofs')} WHERE user_id = ? AND kind = 'magic_link' AND state = 'consumed' LIMIT 1`, [id])).length > 0;
    },
    createFlowState: (value) => { check(); if (!input.hostPorts.federation) throw new IdentityCustodyErrorV1('identity_contract_unavailable'); return input.hostPorts.federation.createFlowState(value); },
    consumeFlowState: (id, at) => { check(); if (!input.hostPorts.federation) throw new IdentityCustodyErrorV1('identity_contract_unavailable'); return input.hostPorts.federation.consumeFlowState(id, at); },
  };
};
