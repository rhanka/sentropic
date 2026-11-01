// A2.0b prerequisites (promoted lot-A4 diagnostic probes P1–P5): typed
// assertions against the new custody contracts on BOTH durable profiles.
// No skips: the PostgreSQL leg requires CM_PG_URL and fails without it.

import { describe, expect, it } from 'vitest';
import type {
  BoundLoginSessionV1,
  BusinessDeletionPlanV1,
  DigestInvitationV1,
  IdentityAccountStores,
  IdentityImportBatchV1,
  IdentityTransactionV1,
  IdentityUnitOfWorkV1,
  PersonDeletionCommandV2,
  SingleUseProofV1,
  WebAuthnCredentialV1,
} from '../../src/index.js';
import {
  IdentityNotFoundError,
  InvitationError,
  SelfActionForbiddenError,
} from '../../src/index.js';
import { createAtomicPersonDeletionV2 } from '../../src/index.js';
import { createIdentityCustodyImporterV1 } from '../../src/index.js';
import { hashPresentedTokenV1 } from '../../src/index.js';
import { asOpHost, createFixtureBusiness, LATER, NOW, openPostgresEnv, openSqliteEnv, randomBase64Url, sha256Hex, syntheticCoseKey, type FixtureBusinessState } from './a20b-helpers.js';
import type { CustodyOpHost } from '../../src/index.js';

const WRITE = { mode: 'write' as const, deadlineMs: 5000 };
const DELETE_OPTS = { mode: 'delete' as const, deadlineMs: 8000 };
const IMPORT_OPTS = { mode: 'import' as const, deadlineMs: 8000 };

const accountRow = (userId: string, email: string, status: 'active' | 'disabled' = 'active') => ({
  userId, email, accountStatus: status, globalRole: 'editor' as const, createdAt: NOW, updatedAt: NOW,
});

const profileRow = (userId: string) => ({
  userId, emailVerified: true, displayName: null, approvalDueAt: null, approvedAt: NOW, approvedByUserId: 'admin', disabledAt: null, disabledReason: null, legacyAccountStatus: null,
});

const credentialRow = (proofId: string, userId: string, counter: number): WebAuthnCredentialV1 => ({
  proofId, userId, credentialId: randomBase64Url(32), publicKeyCose: syntheticCoseKey(proofId), counter, revision: 0,
  rpId: 'idp.example.test', deviceName: 'key', transports: ['usb'], uv: true, deviceType: 'phone', backedUp: false,
  createdAt: NOW, lastUsedAt: null, revokedAt: null,
});

const challengeRow = (proofId: string): SingleUseProofV1 => ({
  kind: 'webauthn_challenge', proofId, userId: null, state: 'pending', revision: 0, createdAt: NOW, expiresAt: LATER,
  consumedAt: null, revokedAt: null, challenge: randomBase64Url(32), purpose: 'registration', rpId: 'idp.example.test',
  allowedOrigins: ['https://idp.example.test'], userVerification: 'preferred',
});

const invitationBatchRow = (token: string): { readonly invitation: DigestInvitationV1; readonly token: string } => ({
  invitation: {
    invitationId: 'invite-legacy-1', email: 'marie@example.test', tenantId: null, workspaceId: null, clientId: null,
    tokenHash: sha256Hex(token), status: 'pending', expiresAt: LATER, createdAt: NOW, consumedAt: null, consumedByUserId: null, revision: 0,
  },
  token,
});

const sessionRow = (sessionId: string, userId: string, sessionTokenHash: string, refreshTokenHash: string | null): BoundLoginSessionV1 => ({
  sessionId, userId, sessionTokenHash, refreshTokenHash,
  login: { mfaVerified: false, authTime: 1762000000, sessionVersion: 1762000000000 },
  rotationVersion: 0, createdAt: NOW, expiresAt: LATER, revokedAt: null, deviceName: null, ipAddress: null, userAgent: null, lastActivityAt: null,
});

const setupBaseline = async (host: CustodyOpHost, userId: string, email: string): Promise<void> => {
  await host.journal.insertAccountCore(accountRow(userId, email, 'disabled'));
  await host.journal.ensureLiveFence(userId, NOW);
  await host.stores.profiles.put(profileRow(userId));
  await host.journal.insertTenantCore({ tenantId: 'org', slug: 'org', status: 'active', createdAt: NOW });
  await host.journal.insertMembershipCore({ userId, tenantId: 'org', status: 'approved', tenantRole: 'member', decidedBy: 'admin', decidedAt: NOW, updatedAt: NOW });
  await host.journal.insertWorkspaceCore({ workspaceId: 'workspace', tenantId: 'org', repoIdentity: null, aliases: [], enrolledAt: NOW });
  await host.journal.insertWorkspaceMemberCore({ workspaceId: 'workspace', userId, role: 'editor' });
};

interface ProfileEnv {
  readonly unitOfWork: IdentityUnitOfWorkV1<CustodyOpHost>;
  readonly oldStores: IdentityAccountStores;
  readonly reopen: () => ProfileEnv;
}

describe.each([{ profile: 'postgres' }, { profile: 'sqlite' }])('A2.0b prerequisites on $profile', ({ profile }) => {
  const openEnv = async (): Promise<ProfileEnv> => {
    if (profile === 'postgres') {
      const env = await openPostgresEnv();
      const { createPostgresIdentityCoreStores } = await import('../../src/index.js');
      const oldStores = createPostgresIdentityCoreStores({ driver: env.raw, schema: env.schema });
      const unitOfWork = asOpHost(env.unitOfWork);
      // A fresh host over the same schema proves no cached state is read back.
      const reopen = (): ProfileEnv => ({ unitOfWork, oldStores, reopen });
      return { unitOfWork, oldStores, reopen };
    }
    const env = openSqliteEnv();
    const { createSqliteIdentityCoreStores } = await import('../../src/index.js');
    const reopen = (): ProfileEnv => {
      const next = env.reopen();
      return { unitOfWork: asOpHost(next.unitOfWork), oldStores: createSqliteIdentityCoreStores({ connection: next.connection }), reopen };
    };
    return { unitOfWork: asOpHost(env.unitOfWork), oldStores: createSqliteIdentityCoreStores({ connection: env.connection }), reopen };
  };

  it('P1 preserves WebAuthn verification material through close/reopen and advances the counter', async () => {
    const first = await openEnv();
    const credential = credentialRow('credential-1', 'marie', 7);
    await first.unitOfWork.runWrite(WRITE, async (tx) => {
      await tx.hostTransaction.journal.insertAccountCore(accountRow('marie', 'marie@example.test'));
      await tx.hostTransaction.journal.ensureLiveFence('marie', NOW);
      await tx.hostTransaction.stores.credentials.insert(credential);
    });
    const second = first.reopen();
    const stored = await second.unitOfWork.runRead({ mode: 'read', deadlineMs: 5000 }, (tx) => tx.hostTransaction.stores.credentials.findById('credential-1'));
    expect(stored).toMatchObject({ proofId: 'credential-1', userId: 'marie', credentialId: credential.credentialId, publicKeyCose: credential.publicKeyCose, counter: 7, revision: 0 });
    const byCredential = await second.unitOfWork.runRead({ mode: 'read', deadlineMs: 5000 }, (tx) => tx.hostTransaction.stores.credentials.findByCredentialId(credential.credentialId));
    expect(byCredential?.proofId).toBe('credential-1');
    const advanced = await second.unitOfWork.runWrite(WRITE, (tx) =>
      tx.hostTransaction.stores.credentials.compareAndSwapCounter({ proofId: 'credential-1', userId: 'marie', expectedCounter: 7, expectedRevision: 0, newCounter: 8, at: LATER }));
    expect(advanced).toMatchObject({ counter: 8, revision: 1, lastUsedAt: LATER });
    await expect(second.unitOfWork.runWrite(WRITE, (tx) =>
      tx.hostTransaction.stores.credentials.compareAndSwapCounter({ proofId: 'credential-1', userId: 'marie', expectedCounter: 8, expectedRevision: 0, newCounter: 9, at: LATER }),
    )).rejects.toMatchObject({ code: 'webauthn_credential_stale' });
  });

  it('P2 preserves unbound registration challenges without inventing an account', async () => {
    const first = await openEnv();
    const challenge = challengeRow('registration-challenge');
    await first.unitOfWork.runWrite(WRITE, (tx) => tx.hostTransaction.stores.singleUseProofs.insert(challenge));
    const found = await first.unitOfWork.runRead({ mode: 'read', deadlineMs: 5000 }, (tx) =>
      tx.hostTransaction.stores.singleUseProofs.findChallenge(challenge.kind === 'webauthn_challenge' ? challenge.challenge : '', 'registration'));
    expect(found?.proofId).toBe('registration-challenge');
    expect(found?.userId).toBeNull();
    const consumed = await first.unitOfWork.runWrite(WRITE, (tx) =>
      tx.hostTransaction.singleUseProofs.consume({
        key: { kind: 'webauthn_challenge', proofId: 'registration-challenge' },
        expectedRevision: 0, expectedUserId: null, bindUserId: 'marie',
        match: challenge.kind === 'webauthn_challenge'
          ? { kind: 'webauthn_challenge', challenge: challenge.challenge, purpose: 'registration', rpId: 'idp.example.test' }
          : { kind: 'email_code', email: '', digest: { algorithm: 'sha256', value: '' } },
        at: NOW,
      }));
    expect(consumed.userId).toBe('marie');
    expect(consumed.state).toBe('consumed');
    await expect(first.unitOfWork.runWrite(WRITE, (tx) =>
      tx.hostTransaction.singleUseProofs.consume({
        key: { kind: 'webauthn_challenge', proofId: 'registration-challenge' },
        expectedRevision: 1, expectedUserId: 'marie', bindUserId: null,
        match: challenge.kind === 'webauthn_challenge'
          ? { kind: 'webauthn_challenge', challenge: challenge.challenge, purpose: 'registration', rpId: 'idp.example.test' }
          : { kind: 'email_code', email: '', digest: { algorithm: 'sha256', value: '' } },
        at: NOW,
      }))).rejects.toMatchObject({ code: 'proof_state_conflict' });
  });

  it('P3 imports a hash-only invitation and consumes it once with the original token', async () => {
    const first = await openEnv();
    const { invitation } = invitationBatchRow('sit_original-token-value');
    const batch: IdentityImportBatchV1 = {
      contractVersion: '1.1.0', migrationId: 'mig-p3', sourceSnapshotRef: 'snap-p3', sourceSnapshotDigest: sha256Hex('snap-p3'), manifestDigest: sha256Hex('manifest-p3'), importedAt: NOW,
      rows: [{ entity: 'invitation', record: invitation }],
    };
    const importer = createIdentityCustodyImporterV1({ unitOfWork: first.unitOfWork, fence: { assertExclusiveWriter: async () => undefined }, importOptions: IMPORT_OPTS, validationOptions: { mode: 'read', deadlineMs: 5000 } });
    const receipt = await importer.importBatch(batch);
    expect(receipt.counts.invitation).toBe(1);
    expect(receipt.verificationMaterialPreserved).toBe(true);
    const stored = await first.unitOfWork.runRead({ mode: 'read', deadlineMs: 5000 }, (tx) => tx.hostTransaction.stores.invitations.findByDigest(invitation.tokenHash));
    expect(stored?.status).toBe('pending');
    expect(JSON.stringify(stored)).not.toContain('sit_original-token-value');
    const digest = hashPresentedTokenV1('sit_original-token-value');
    expect(digest).toBe(invitation.tokenHash);
    const consumed = await first.unitOfWork.runWrite(WRITE, (tx) =>
      tx.hostTransaction.stores.invitations.consumeByDigest({ tokenHash: digest, email: 'marie@example.test', clientId: null, userId: 'marie', expectedRevision: 0, at: NOW }));
    expect(consumed).toMatchObject({ status: 'consumed', consumedByUserId: 'marie', revision: 1 });
    await expect(first.unitOfWork.runWrite(WRITE, (tx) =>
      tx.hostTransaction.stores.invitations.consumeByDigest({ tokenHash: digest, email: 'marie@example.test', clientId: null, userId: 'marie', expectedRevision: 1, at: NOW }),
    )).rejects.toBeInstanceOf(InvitationError);
  });

  it('P4 rolls back identity and business rows when a cascade step fails', async () => {
    const first = await openEnv();
    const state: FixtureBusinessState = { failAt: 'delete', reachedDelete: false, reachedAssert: false };
    const plan: BusinessDeletionPlanV1 = { userId: 'marie', workspaceIdsToDelete: [], retainedWorkspaceIds: ['workspace'] };
    const fixture = createFixtureBusiness({ handlerId: 'admin_account', plan, state });
    await first.unitOfWork.runWrite(WRITE, async (tx) => {
      await setupBaseline(tx.hostTransaction, 'marie', 'marie@example.test');
      await tx.hostTransaction.journal.insertAccountCore(accountRow('admin', 'admin@example.test'));
      await tx.hostTransaction.journal.ensureLiveFence('admin', NOW);
      await tx.hostTransaction.stores.profiles.put(profileRow('admin'));
      await tx.hostTransaction.stores.sessions.insert(sessionRow('session-1', 'marie', sha256Hex('session-token-1'), sha256Hex('refresh-token-1')));
      await fixture.setup(tx.hostTransaction, [{ ownerId: 'marie', workspaceId: 'workspace', payload: 'doc' }]);
    });
    const deletion = createAtomicPersonDeletionV2({ unitOfWork: first.unitOfWork, business: fixture.business, deletionOptions: DELETE_OPTS });
    const command: PersonDeletionCommandV2 = { userId: 'marie', actorId: 'admin', handlerId: 'admin_account', operationId: 'op-p4' };
    const receipt = await deletion.deletePerson(command);
    expect(state.reachedDelete).toBe(true);
    expect(receipt.transaction).toBe('rolled_back');
    expect(receipt.resultCode).toBe('identity_cascade_rolled_back');
    expect(receipt.complete).toBe(false);
    expect(receipt.steps).toContainEqual({ step: 'account', outcome: 'queued', detail: 'required_local_step_failed' });
    expect(receipt.steps).toContainEqual({ step: 'tenant_memberships', outcome: 'rolled_back', detail: 'transaction_rolled_back' });
    const check = async (tx: IdentityTransactionV1<CustodyOpHost>): Promise<void> => {
      expect(await tx.hostTransaction.journal.findAccountCore('marie')).not.toBeNull();
      const memberships = await tx.hostTransaction.journal.listMembershipsForUser('marie');
      expect(memberships).toHaveLength(1);
      expect(memberships[0]).toMatchObject({ status: 'approved' });
      const sessions = await tx.hostTransaction.stores.sessions.listForUser('marie');
      expect(sessions).toHaveLength(1);
      expect(await fixture.rows(tx.hostTransaction)).toHaveLength(1);
    };
    await first.unitOfWork.runRead({ mode: 'read', deadlineMs: 5000 }, check);
    const persisted = await deletion.getReceipt('op-p4');
    expect(persisted).toEqual(receipt);
    const operation = await deletion.getOperation('op-p4');
    expect(operation?.state).toBe('queued');
  });

  it('P5 leaves no membership or proof orphan after account deletion succeeds', async () => {
    const first = await openEnv();
    const state: FixtureBusinessState = { failAt: null, reachedDelete: false, reachedAssert: false };
    const plan: BusinessDeletionPlanV1 = { userId: 'marie', workspaceIdsToDelete: ['ws-del'], retainedWorkspaceIds: ['ws-keep'] };
    const fixture = createFixtureBusiness({ handlerId: 'admin_account', plan, state });
    await first.unitOfWork.runWrite(WRITE, async (tx) => {
      const host = tx.hostTransaction;
      await host.journal.insertAccountCore(accountRow('marie', 'marie@example.test', 'disabled'));
      await host.journal.ensureLiveFence('marie', NOW);
      await host.stores.profiles.put(profileRow('marie'));
      await host.journal.insertTenantCore({ tenantId: 'org', slug: 'org', status: 'active', createdAt: NOW });
      await host.journal.insertMembershipCore({ userId: 'marie', tenantId: 'org', status: 'suspended', tenantRole: 'member', decidedBy: 'admin', decidedAt: NOW, updatedAt: NOW });
      await host.journal.insertAccountCore(accountRow('bob', 'bob@example.test'));
      await host.journal.ensureLiveFence('bob', NOW);
      await host.journal.insertWorkspaceCore({ workspaceId: 'ws-keep', tenantId: 'org', repoIdentity: null, aliases: [], enrolledAt: NOW });
      await host.journal.insertWorkspaceCore({ workspaceId: 'ws-del', tenantId: 'org', repoIdentity: null, aliases: [], enrolledAt: NOW });
      await host.journal.insertWorkspaceMemberCore({ workspaceId: 'ws-keep', userId: 'marie', role: 'member' });
      await host.journal.insertWorkspaceMemberCore({ workspaceId: 'ws-keep', userId: 'bob', role: 'admin' });
      await host.journal.insertWorkspaceMemberCore({ workspaceId: 'ws-del', userId: 'marie', role: 'admin' });
      await host.journal.insertWorkspaceMemberCore({ workspaceId: 'ws-del', userId: 'bob', role: 'viewer' });
      await host.journal.insertAccountCore(accountRow('admin', 'admin@example.test'));
      await host.journal.ensureLiveFence('admin', NOW);
      const credential = credentialRow('cred-del', 'marie', 3);
      await host.stores.credentials.insert(credential);
      await host.stores.sessions.insert(sessionRow('session-del', 'marie', sha256Hex('session-del'), sha256Hex('refresh-del')));
      await fixture.setup(host, [
        { ownerId: 'marie', workspaceId: 'ws-del', payload: 'doc' },
        { ownerId: 'bob', workspaceId: 'ws-del', payload: 'shared' },
        { ownerId: 'bob', workspaceId: 'ws-keep', payload: 'kept' },
      ]);
    });
    // Legacy 1.0 rows bound to the subject must disappear with the account.
    await first.oldStores.proofs.addProof({ proofId: 'old-proof', userId: 'marie', kind: 'social', provider: 'github', createdAt: NOW });
    await first.oldStores.deviceCodes.saveDeviceCode({ deviceCode: 'dev-1', userCode: 'user-1', deviceName: null, status: 'pending', issuedAt: NOW, expiresAt: LATER });
    expect(await first.oldStores.deviceCodes.approveDeviceCode('user-1', 'marie', NOW)).toBe(true);
    const deletion = createAtomicPersonDeletionV2({ unitOfWork: first.unitOfWork, business: fixture.business, deletionOptions: DELETE_OPTS });
    const receipt = await deletion.deletePerson({ userId: 'marie', actorId: 'admin', handlerId: 'admin_account', operationId: 'op-p5' });
    expect(state.reachedDelete).toBe(true);
    expect(state.reachedAssert).toBe(true);
    expect(receipt.transaction).toBe('committed');
    expect(receipt.resultCode).toBe('identity_deleted');
    expect(receipt.complete).toBe(true);
    await first.unitOfWork.runRead({ mode: 'read', deadlineMs: 5000 }, async (tx) => {
      const host = tx.hostTransaction;
      expect(await host.journal.findAccountCore('marie')).toBeNull();
      expect(await host.journal.listMembershipsForUser('marie')).toHaveLength(0);
      expect(await host.journal.listWorkspaceIdsForUser('marie')).toHaveLength(0);
      expect(await host.stores.sessions.listForUser('marie')).toHaveLength(0);
      expect(await host.stores.credentials.listForUser('marie')).toHaveLength(0);
      expect(await host.journal.findWorkspaceCore('ws-del')).toBeNull();
      expect(await host.journal.findWorkspaceCore('ws-keep')).not.toBeNull();
      // Unrelated accounts and their retained references survive.
      expect(await host.journal.findAccountCore('bob')).not.toBeNull();
      expect(await host.journal.roleInWorkspace('ws-keep', 'bob')).toBe('admin');
      expect(await host.journal.roleInWorkspace('ws-del', 'bob')).toBeNull();
      expect(await fixture.rows(host)).toEqual([{ ownerId: 'bob', workspaceId: 'ws-keep' }]);
    });
    // Legacy 1.0 subject rows are gone as well.
    expect(await first.oldStores.proofs.findProof('old-proof')).toBeNull();
    expect(await first.oldStores.proofs.listProofsForUser('marie')).toHaveLength(0);
    expect(await first.oldStores.deviceCodes.findDeviceCodeByUser('user-1')).toBeNull();
    const persisted = await deletion.getReceipt('op-p5');
    expect(persisted?.transaction).toBe('committed');
  });

  it('rejects unauthorized and guarded deletion callers identically', async () => {
    const first = await openEnv();
    await first.unitOfWork.runWrite(WRITE, async (tx) => {
      await tx.hostTransaction.journal.insertAccountCore(accountRow('marie', 'marie@example.test', 'active'));
      await tx.hostTransaction.journal.ensureLiveFence('marie', NOW);
      await tx.hostTransaction.journal.insertAccountCore(accountRow('admin', 'admin@example.test'));
      await tx.hostTransaction.journal.ensureLiveFence('admin', NOW);
    });
    const state: FixtureBusinessState = { failAt: null, reachedDelete: false, reachedAssert: false };
    const plan: BusinessDeletionPlanV1 = { userId: 'marie', workspaceIdsToDelete: [], retainedWorkspaceIds: [] };
    const fixture = createFixtureBusiness({ handlerId: 'admin_account', plan, state });
    const deletion = createAtomicPersonDeletionV2({ unitOfWork: first.unitOfWork, business: fixture.business, deletionOptions: DELETE_OPTS });
    // Active account refuses before any reservation mutation.
    await expect(deletion.deletePerson({ userId: 'marie', actorId: 'admin', handlerId: 'admin_account', operationId: 'op-g1' })).rejects.toMatchObject({ name: 'AccountTransitionError' });
    expect(await deletion.getOperation('op-g1')).toBeNull();
    // Admin acting on self through the admin handler refuses.
    await expect(deletion.deletePerson({ userId: 'admin', actorId: 'admin', handlerId: 'admin_account', operationId: 'op-g2' })).rejects.toBeInstanceOf(SelfActionForbiddenError);
    expect(await deletion.getOperation('op-g2')).toBeNull();
    // Unknown subject refuses like a missing record.
    await expect(deletion.deletePerson({ userId: 'ghost', actorId: 'admin', handlerId: 'admin_account', operationId: 'op-g3' })).rejects.toBeInstanceOf(IdentityNotFoundError);
    expect(state.reachedDelete).toBe(false);
  });
});
