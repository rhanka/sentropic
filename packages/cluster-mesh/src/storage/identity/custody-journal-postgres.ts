// A2.0b deletion journal, revocation outbox and core-table transaction layer
// on the PostgreSQL profile. Shares the caller's PgSession — and therefore
// the host transaction — with the custody stores; never begins or commits.

import { createHash } from 'node:crypto';
import type {
  AtomicRevocationStepReceiptV2,
  IdentityDeletionAttemptV2,
  IdentityDeletionOperationV2,
  IdentityExternalRevocationV1,
  IdentityImportReceiptV1,
  PersonDeletionReceiptV2,
} from '../../identity-contracts/custody.js';
import type { RevocationStepKind, UserAccount } from '../../identity-contracts/types.js';
import { IdentityCustodyErrorV1 } from '../../identity-contracts/custody-errors.js';
import type { PgSession, SqlValue } from '../postgres/protocol.js';
import { identityTable, type IdentityTableName } from './schema.js';

export class PostgresCustodyJournal {
  constructor(
    readonly schema: string,
    readonly session: PgSession,
  ) {}

  readonly t = (table: IdentityTableName): string => identityTable('postgres', this.schema, table);
  readonly cm = (table: string): string => `"${this.schema}"."${table}"`;

  private readonly one = async <T>(decode: (row: Record<string, unknown>) => T, text: string, values: readonly SqlValue[]): Promise<T | null> => {
    const result = await this.session.execute({ text, values });
    return result.rows.length > 0 ? decode(result.rows[0]) : null;
  };

  // -- Subject fences -------------------------------------------------------

  async ensureLiveFence(userId: string, at: string): Promise<void> {
    await this.session.execute({
      text: `INSERT INTO ${this.t('identity_subject_fences')} ("user_id","revision","updated_at","retired_at") VALUES ($1,0,$2,NULL) ON CONFLICT ("user_id") DO NOTHING`,
      values: [userId, at],
    });
    const fence = await this.one(
      (row) => ({ retiredAt: (row['retired_at'] as string | null) ?? null }),
      `SELECT "retired_at" FROM ${this.t('identity_subject_fences')} WHERE "user_id" = $1`,
      [userId],
    );
    if (fence?.retiredAt !== null && fence?.retiredAt !== undefined) throw new IdentityCustodyErrorV1('identity_subject_retired');
  }

  async retireFence(userId: string, at: string): Promise<void> {
    const result = await this.session.execute({
      text: `UPDATE ${this.t('identity_subject_fences')} SET "retired_at" = $2, "revision" = "revision" + 1, "updated_at" = $2 WHERE "user_id" = $1 AND "retired_at" IS NULL`,
      values: [userId, at],
    });
    if ((result.rowCount ?? 0) === 0) throw new IdentityCustodyErrorV1('identity_subject_retired');
  }

  // -- Deletion operations --------------------------------------------------

  static requestDigestV1(userId: string, actorId: string, handlerId: string, operationId: string): string {
    return createHash('sha256').update(JSON.stringify(['A2.0b', '2.0.0', userId, actorId, handlerId, operationId]), 'utf8').digest('hex');
  }

  async reserveOperation(op: IdentityDeletionOperationV2): Promise<'reserved' | 'committed'> {
    try {
      await this.session.execute({
        text: `INSERT INTO ${this.t('identity_deletion_operations')} ("operation_id","user_id","actor_id","handler_id","request_digest","state","created_at","committed_at","committed_receipt_json") VALUES ($1,$2,$3,$4,$5,'queued',$6,NULL,NULL)`,
        values: [op.operationId, op.userId, op.actorId, op.handlerId, op.requestDigest, op.createdAt],
      });
      return 'reserved';
    } catch (error) {
      if (String((error as { code?: unknown }).code ?? '') !== '23505') throw error;
      const existing = await this.findOperation(op.operationId);
      if (!existing) throw new IdentityCustodyErrorV1('identity_transaction_indeterminate');
      if (existing.requestDigest !== op.requestDigest || existing.userId !== op.userId || existing.actorId !== op.actorId || existing.handlerId !== op.handlerId) {
        throw new IdentityCustodyErrorV1('identity_operation_conflict');
      }
      return existing.state === 'committed' ? 'committed' : 'reserved';
    }
  }

  findOperation = (operationId: string): Promise<IdentityDeletionOperationV2 | null> =>
    this.one(
      (row) => ({
        operationId: String(row['operation_id']),
        userId: String(row['user_id']),
        actorId: String(row['actor_id']),
        handlerId: row['handler_id'] as IdentityDeletionOperationV2['handlerId'],
        requestDigest: String(row['request_digest']),
        state: row['state'] as IdentityDeletionOperationV2['state'],
        createdAt: String(row['created_at']),
        committedAt: (row['committed_at'] as string | null) ?? null,
      }),
      `SELECT * FROM ${this.t('identity_deletion_operations')} WHERE "operation_id" = $1`,
      [operationId],
    );

  async markOperationCommitted(operationId: string, receipt: PersonDeletionReceiptV2, at: string): Promise<void> {
    const result = await this.session.execute({
      text: `UPDATE ${this.t('identity_deletion_operations')} SET "state" = 'committed', "committed_at" = $2, "committed_receipt_json" = $3 WHERE "operation_id" = $1 AND "state" = 'queued'`,
      values: [operationId, at, JSON.stringify(receipt)],
    });
    if ((result.rowCount ?? 0) === 0) throw new IdentityCustodyErrorV1('identity_operation_conflict');
  }

  async appendAttempt(attempt: IdentityDeletionAttemptV2): Promise<void> {
    if (attempt.receipt.transaction !== 'rolled_back') throw new IdentityCustodyErrorV1('identity_material_invalid');
    await this.session.execute({
      text: `INSERT INTO ${this.t('identity_deletion_attempts')} ("attempt_id","operation_id","at","receipt_json") VALUES ($1,$2,$3,$4)`,
      values: [attempt.attemptId, attempt.operationId, attempt.at, JSON.stringify(attempt.receipt)],
    });
  }

  latestReceipt = async (operationId: string): Promise<PersonDeletionReceiptV2 | null> => {
    const committed = await this.one(
      (row) => (row['committed_receipt_json'] as string | null) ?? null,
      `SELECT "committed_receipt_json" FROM ${this.t('identity_deletion_operations')} WHERE "operation_id" = $1 AND "state" = 'committed'`,
      [operationId],
    );
    if (committed) return JSON.parse(committed) as PersonDeletionReceiptV2;
    const attempt = await this.one(
      (row) => String(row['receipt_json']),
      `SELECT "receipt_json" FROM ${this.t('identity_deletion_attempts')} WHERE "operation_id" = $1 ORDER BY "at" DESC, "attempt_id" DESC LIMIT 1`,
      [operationId],
    );
    return attempt ? (JSON.parse(attempt) as PersonDeletionReceiptV2) : null;
  };

  // -- Revocation outbox ----------------------------------------------------

  async enqueueDelivery(delivery: IdentityExternalRevocationV1): Promise<void> {
    try {
      await this.session.execute({
        text: `INSERT INTO ${this.t('identity_revocation_outbox')} ("delivery_id","operation_id","step","subject_id","target_kind","target_ref","state","created_at","next_attempt_at","custody_ref","delivered_at","claim_owner","lease_until","claim_version","attempt_count") VALUES ($1,$2,$3,$4,$5,$6,'pending',$7,$8,$9,NULL,NULL,NULL,0,0)`,
        values: [delivery.deliveryId, delivery.operationId, delivery.step, delivery.subjectId, delivery.targetKind, delivery.targetRef, delivery.createdAt, delivery.nextAttemptAt, null],
      });
    } catch (error) {
      if (String((error as { code?: unknown }).code ?? '') !== '23505') throw error;
      const existing = await this.findDelivery(delivery.deliveryId);
      if (!existing) throw new IdentityCustodyErrorV1('identity_transaction_indeterminate');
      if (existing.subjectId !== delivery.subjectId || existing.targetKind !== delivery.targetKind || existing.targetRef !== delivery.targetRef || existing.step !== delivery.step) {
        throw new IdentityCustodyErrorV1('identity_operation_conflict');
      }
    }
  }

  findDelivery = (deliveryId: string): Promise<IdentityExternalRevocationV1 | null> =>
    this.one(
      (row) => ({
        deliveryId: String(row['delivery_id']),
        operationId: String(row['operation_id']),
        step: String(row['step']),
        subjectId: String(row['subject_id']),
        targetKind: String(row['target_kind']),
        targetRef: String(row['target_ref']),
        state: row['state'] as IdentityExternalRevocationV1['state'],
        createdAt: String(row['created_at']),
        nextAttemptAt: String(row['next_attempt_at']),
      }),
      `SELECT * FROM ${this.t('identity_revocation_outbox')} WHERE "delivery_id" = $1`,
      [deliveryId],
    );

  async claimPending(now: string, owner: string, leaseUntil: string, limit: number): Promise<readonly (IdentityExternalRevocationV1 & { readonly claimVersion: number })[]> {
    if (!Number.isInteger(limit) || limit <= 0) throw new IdentityCustodyErrorV1('identity_material_invalid');
    if (!(leaseUntil > now)) throw new IdentityCustodyErrorV1('identity_material_invalid');
    const rows = (
      await this.session.execute({
        text: `UPDATE ${this.t('identity_revocation_outbox')} SET "claim_owner" = $2, "lease_until" = $3, "claim_version" = "claim_version" + 1, "attempt_count" = "attempt_count" + 1
               WHERE "delivery_id" IN (SELECT "delivery_id" FROM ${this.t('identity_revocation_outbox')} WHERE "state" = 'pending' AND "next_attempt_at" <= $1 AND ("lease_until" IS NULL OR "lease_until" <= $1) ORDER BY "next_attempt_at", "created_at", "delivery_id" LIMIT $4 FOR UPDATE SKIP LOCKED)
               RETURNING *`,
        values: [now, owner, leaseUntil, limit],
      })
    ).rows;
    return rows.map((row) => ({
      deliveryId: String(row['delivery_id']),
      operationId: String(row['operation_id']),
      step: String(row['step']),
      subjectId: String(row['subject_id']),
      targetKind: String(row['target_kind']),
      targetRef: String(row['target_ref']),
      state: row['state'] as IdentityExternalRevocationV1['state'],
      createdAt: String(row['created_at']),
      nextAttemptAt: String(row['next_attempt_at']),
      claimVersion: Number(row['claim_version']),
    }));
  }

  async acknowledgeDelivery(deliveryId: string, owner: string, version: number, at: string): Promise<void> {
    const result = await this.session.execute({
      text: `UPDATE ${this.t('identity_revocation_outbox')} SET "state" = 'delivered', "delivered_at" = $4, "claim_owner" = NULL, "lease_until" = NULL
             WHERE "delivery_id" = $1 AND "state" = 'pending' AND "claim_owner" = $2 AND "claim_version" = $3 AND "lease_until" > $4`,
      values: [deliveryId, owner, version, at],
    });
    if ((result.rowCount ?? 0) === 0) throw new IdentityCustodyErrorV1('identity_delivery_claim_conflict');
  }

  async releaseClaim(deliveryId: string, owner: string, version: number, nextAttemptAt: string): Promise<void> {
    const result = await this.session.execute({
      text: `UPDATE ${this.t('identity_revocation_outbox')} SET "claim_owner" = NULL, "lease_until" = NULL, "next_attempt_at" = $4
             WHERE "delivery_id" = $1 AND "state" = 'pending' AND "claim_owner" = $2 AND "claim_version" = $3`,
      values: [deliveryId, owner, version, nextAttemptAt],
    });
    if ((result.rowCount ?? 0) === 0) throw new IdentityCustodyErrorV1('identity_delivery_claim_conflict');
  }

  listPendingByOperation = async (operationId: string): Promise<readonly IdentityExternalRevocationV1[]> => {
    const rows = (
      await this.session.execute({
        text: `SELECT * FROM ${this.t('identity_revocation_outbox')} WHERE "operation_id" = $1 ORDER BY "next_attempt_at", "created_at", "delivery_id"`,
        values: [operationId],
      })
    ).rows;
    return rows.map((row) => ({
      deliveryId: String(row['delivery_id']),
      operationId: String(row['operation_id']),
      step: String(row['step']),
      subjectId: String(row['subject_id']),
      targetKind: String(row['target_kind']),
      targetRef: String(row['target_ref']),
      state: row['state'] as IdentityExternalRevocationV1['state'],
      createdAt: String(row['created_at']),
      nextAttemptAt: String(row['next_attempt_at']),
    }));
  };

  // -- Import receipts ------------------------------------------------------

  findImportReceipt = (migrationId: string): Promise<IdentityImportReceiptV1 | null> =>
    this.one(
      (row) => JSON.parse(String(row['receipt_json'])) as IdentityImportReceiptV1,
      `SELECT "receipt_json" FROM ${this.t('identity_import_receipts')} WHERE "migration_id" = $1`,
      [migrationId],
    );

  async insertImportReceipt(migrationId: string, row: { readonly sourceSnapshotRef: string; readonly sourceSnapshotDigest: string; readonly manifestDigest: string; readonly importedAt: string }, receipt: IdentityImportReceiptV1): Promise<void> {
    await this.session.execute({
      text: `INSERT INTO ${this.t('identity_import_receipts')} ("migration_id","source_snapshot_ref","source_snapshot_digest","manifest_digest","contract_version","imported_at","receipt_json") VALUES ($1,$2,$3,$4,'1.1.0',$5,$6)`,
      values: [migrationId, row.sourceSnapshotRef, row.sourceSnapshotDigest, row.manifestDigest, row.importedAt, JSON.stringify(receipt)],
    });
  }

  // -- Core account rows (import + deletion) --------------------------------

  async insertAccountCore(record: UserAccount): Promise<void> {
    try {
      await this.session.execute({
        text: `INSERT INTO ${this.t('identity_user_accounts')} ("user_id","email","account_status","global_role","created_at","updated_at") VALUES ($1,$2,$3,$4,$5,$6)`,
        values: [record.userId, record.email, record.accountStatus, record.globalRole, record.createdAt, record.updatedAt],
      });
    } catch (error) {
      if (String((error as { code?: unknown }).code ?? '') === '23505') throw new IdentityCustodyErrorV1('identity_record_conflict');
      throw error;
    }
  }

  findAccountCore = (userId: string): Promise<UserAccount | null> =>
    this.one(
      (row) => ({
        userId: String(row['user_id']),
        email: String(row['email']),
        accountStatus: row['account_status'] as UserAccount['accountStatus'],
        globalRole: row['global_role'] as UserAccount['globalRole'],
        createdAt: String(row['created_at']),
        updatedAt: String(row['updated_at']),
      }),
      `SELECT * FROM ${this.t('identity_user_accounts')} WHERE "user_id" = $1`,
      [userId],
    );

  async deleteAccountCore(userId: string): Promise<void> {
    await this.session.execute({ text: `DELETE FROM ${this.t('identity_user_accounts')} WHERE "user_id" = $1`, values: [userId] });
  }

  // -- Tenancy / workspace rows (import + deletion) --------------------------

  async insertTenantCore(tenant: { readonly tenantId: string; readonly slug: string; readonly status: string; readonly createdAt: string }): Promise<void> {
    await this.session.execute({
      text: `INSERT INTO ${this.cm('cm_tenants')} ("tenant_id","slug","status","created_at") VALUES ($1,$2,$3,$4) ON CONFLICT ("tenant_id") DO NOTHING`,
      values: [tenant.tenantId, tenant.slug, tenant.status, tenant.createdAt],
    });
  }

  async insertMembershipCore(membership: { readonly userId: string; readonly tenantId: string; readonly status: string; readonly tenantRole: string; readonly decidedBy?: string; readonly decidedAt?: string; readonly updatedAt: string }): Promise<void> {
    await this.session.execute({
      text: `INSERT INTO ${this.cm('cm_tenant_memberships')} ("user_id","tenant_id","status","tenant_role","decided_by","decided_at","updated_at") VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT ("user_id","tenant_id") DO NOTHING`,
      values: [membership.userId, membership.tenantId, membership.status, membership.tenantRole, membership.decidedBy ?? null, membership.decidedAt ?? null, membership.updatedAt],
    });
  }

  async insertWorkspaceCore(workspace: { readonly workspaceId: string; readonly tenantId: string; readonly repoIdentity: string | null; readonly aliases: readonly string[]; readonly enrolledAt: string }): Promise<void> {
    await this.session.execute({
      text: `INSERT INTO ${this.cm('cm_workspaces')} ("workspace_id","tenant_id","repo_identity","aliases","enrolled_at") VALUES ($1,$2,$3,$4,$5) ON CONFLICT ("workspace_id") DO NOTHING`,
      values: [workspace.workspaceId, workspace.tenantId, workspace.repoIdentity, JSON.stringify(workspace.aliases), workspace.enrolledAt],
    });
  }

  async insertWorkspaceMemberCore(member: { readonly workspaceId: string; readonly userId: string; readonly role: string }): Promise<void> {
    await this.session.execute({
      text: `INSERT INTO ${this.cm('cm_workspace_members')} ("workspace_id","user_id","role") VALUES ($1,$2,$3) ON CONFLICT ("workspace_id","user_id") DO NOTHING`,
      values: [member.workspaceId, member.userId, member.role],
    });
  }

  findTenantCore = (tenantId: string): Promise<{ readonly tenantId: string; readonly slug: string; readonly status: string; readonly createdAt: string } | null> =>
    this.one(
      (row) => ({ tenantId: String(row['tenant_id']), slug: String(row['slug']), status: String(row['status']), createdAt: String(row['created_at']) }),
      `SELECT * FROM ${this.cm('cm_tenants')} WHERE "tenant_id" = $1`,
      [tenantId],
    );

  findWorkspaceCore = (workspaceId: string): Promise<{ readonly workspaceId: string; readonly tenantId: string } | null> =>
    this.one(
      (row) => ({ workspaceId: String(row['workspace_id']), tenantId: String(row['tenant_id']) }),
      `SELECT * FROM ${this.cm('cm_workspaces')} WHERE "workspace_id" = $1`,
      [workspaceId],
    );

  async setImportedSessionBase(sessionId: string, status: 'active' | 'expired' | 'revoked', revokedAt: string | null): Promise<void> {
    const result = await this.session.execute({
      text: `UPDATE ${this.t('identity_login_sessions')} SET "status" = $2, "revoked_at" = $3 WHERE "session_id" = $1`,
      values: [sessionId, status, revokedAt],
    });
    if ((result.rowCount ?? 0) === 0) throw new IdentityCustodyErrorV1('identity_material_missing');
  }

  async insertConsentCore(consent: { readonly consentId: string; readonly tenantId: string; readonly userId: string; readonly clientId: string; readonly grantedAt: string }): Promise<void> {
    await this.session.execute({
      text: `INSERT INTO ${this.cm('cm_oauth_consents')} ("consent_id","tenant_id","user_id","client_id","granted_at","revoked_at") VALUES ($1,$2,$3,$4,$5,NULL) ON CONFLICT ("consent_id") DO NOTHING`,
      values: [consent.consentId, consent.tenantId, consent.userId, consent.clientId, consent.grantedAt],
    });
  }

  // -- Subject cleanup (CM-owned, both handlers) ------------------------------

  listMembershipsForUser = async (userId: string): Promise<readonly { readonly tenantId: string; readonly status: string; readonly tenantRole: string }[]> => {
    const rows = (
      await this.session.execute({ text: `SELECT "tenant_id","status","tenant_role" FROM ${this.cm('cm_tenant_memberships')} WHERE "user_id" = $1`, values: [userId] })
    ).rows;
    return rows.map((row) => ({ tenantId: String(row['tenant_id']), status: String(row['status']), tenantRole: String(row['tenant_role']) }));
  };

  listWorkspaceIdsForUser = async (userId: string): Promise<readonly string[]> => {
    const rows = (
      await this.session.execute({ text: `SELECT "workspace_id" FROM ${this.cm('cm_workspace_members')} WHERE "user_id" = $1`, values: [userId] })
    ).rows;
    return rows.map((row) => String(row['workspace_id']));
  };

  countAdminsInWorkspace = async (workspaceId: string): Promise<number> => {
    const rows = (
      await this.session.execute({
        text: `SELECT COUNT(*) AS "count" FROM ${this.cm('cm_workspace_members')} WHERE "workspace_id" = $1 AND "role" = 'admin'`,
        values: [workspaceId],
      })
    ).rows;
    return Number(rows[0]?.['count'] ?? 0);
  };

  roleInWorkspace = async (workspaceId: string, userId: string): Promise<string | null> => {
    const row = await this.one(
      (r) => String(r['role']),
      `SELECT "role" FROM ${this.cm('cm_workspace_members')} WHERE "workspace_id" = $1 AND "user_id" = $2`,
      [workspaceId, userId],
    );
    return row;
  };

  async deleteMembershipsForUser(userId: string): Promise<number> {
    const result = await this.session.execute({ text: `DELETE FROM ${this.cm('cm_tenant_memberships')} WHERE "user_id" = $1`, values: [userId] });
    return result.rowCount ?? 0;
  }

  async deleteWorkspaceMembersForUser(userId: string): Promise<number> {
    const result = await this.session.execute({ text: `DELETE FROM ${this.cm('cm_workspace_members')} WHERE "user_id" = $1`, values: [userId] });
    return result.rowCount ?? 0;
  }

  async deleteWorkspaceMembersIn(workspaceIds: readonly string[]): Promise<number> {
    let total = 0;
    for (const workspaceId of workspaceIds) {
      const result = await this.session.execute({ text: `DELETE FROM ${this.cm('cm_workspace_members')} WHERE "workspace_id" = $1`, values: [workspaceId] });
      total += result.rowCount ?? 0;
    }
    return total;
  }

  async deleteWorkspace(workspaceId: string): Promise<void> {
    await this.session.execute({ text: `DELETE FROM ${this.cm('cm_workspaces')} WHERE "workspace_id" = $1`, values: [workspaceId] });
  }

  async deleteConsentsForUser(userId: string): Promise<number> {
    const result = await this.session.execute({ text: `DELETE FROM ${this.cm('cm_oauth_consents')} WHERE "user_id" = $1`, values: [userId] });
    return result.rowCount ?? 0;
  }

  async deleteConversationsForUser(userId: string): Promise<number> {
    const result = await this.session.execute({ text: `DELETE FROM ${this.t('cm_identity_conversation_sessions' as IdentityTableName)} WHERE "user_id" = $1`, values: [userId] });
    return result.rowCount ?? 0;
  }

  async deleteProofsForUser(userId: string): Promise<number> {
    const result = await this.session.execute({ text: `DELETE FROM ${this.t('identity_proofs')} WHERE "user_id" = $1`, values: [userId] });
    return result.rowCount ?? 0;
  }

  async deleteDeviceCodesForUser(userId: string): Promise<number> {
    const result = await this.session.execute({ text: `DELETE FROM ${this.t('identity_device_codes')} WHERE "approved_user_id" = $1`, values: [userId] });
    return result.rowCount ?? 0;
  }

  async deleteSessionsForUser(userId: string): Promise<number> {
    const ids = (
      await this.session.execute({ text: `SELECT "session_id" FROM ${this.t('identity_login_sessions')} WHERE "user_id" = $1`, values: [userId] })
    ).rows;
    let total = 0;
    for (const row of ids) {
      const sessionId = String(row['session_id']);
      await this.session.execute({ text: `DELETE FROM ${this.t('identity_login_token_bindings')} WHERE "session_id" = $1`, values: [sessionId] });
      const deleted = await this.session.execute({ text: `DELETE FROM ${this.t('identity_login_sessions')} WHERE "session_id" = $1`, values: [sessionId] });
      total += deleted.rowCount ?? 0;
    }
    return total;
  }

  /** Deletes every custody row bound to the subject; returns per-table counts. */
  async cleanupCustodyForUser(userId: string, email: string): Promise<Readonly<Record<string, number>>> {
    const counts: Record<string, number> = {};
    const remove = async (table: IdentityTableName, where: string, values: readonly SqlValue[]): Promise<void> => {
      const result = await this.session.execute({ text: `DELETE FROM ${this.t(table)} WHERE ${where}`, values });
      counts[table] = (counts[table] ?? 0) + (result.rowCount ?? 0);
    };
    await remove('identity_webauthn_credentials', '"user_id" = $1', [userId]);
    await remove('identity_single_use_proofs', '"user_id" = $1', [userId]);
    await remove('identity_single_use_proofs', '"user_id" IS NULL AND "email" = $1', [email]);
    await remove('identity_email_registration_tickets', '"user_id" = $1', [userId]);
    await remove('identity_email_registration_tickets', '"user_id" IS NULL AND "email" = $1', [email]);
    await remove('identity_social_links', '"user_id" = $1', [userId]);
    await remove('identity_account_profiles', '"user_id" = $1', [userId]);
    return counts;
  }

  async revokePendingInvitationsForEmail(email: string): Promise<number> {
    const result = await this.session.execute({
      text: `UPDATE ${this.t('identity_invitation_digests')} SET "status" = 'revoked', "revision" = "revision" + 1 WHERE "email" = $1 AND "status" = 'pending'`,
      values: [email],
    });
    return result.rowCount ?? 0;
  }

  async detachInvitationConsumer(userId: string): Promise<number> {
    const result = await this.session.execute({
      text: `UPDATE ${this.t('identity_invitation_digests')} SET "consumed_by_user_id" = NULL WHERE "consumed_by_user_id" = $1`,
      values: [userId],
    });
    return result.rowCount ?? 0;
  }

  async detachInvitationWorkspace(workspaceId: string): Promise<number> {
    const pending = await this.session.execute({
      text: `UPDATE ${this.t('identity_invitation_digests')} SET "status" = 'revoked', "revision" = "revision" + 1 WHERE "workspace_id" = $1 AND "status" = 'pending'`,
      values: [workspaceId],
    });
    const detached = await this.session.execute({
      text: `UPDATE ${this.t('identity_invitation_digests')} SET "workspace_id" = NULL WHERE "workspace_id" = $1`,
      values: [workspaceId],
    });
    return (pending.rowCount ?? 0) + (detached.rowCount ?? 0);
  }

  /** Zero live identity/business references may remain after deletion. */
  async assertNoLiveReferences(input: { readonly userId: string; readonly accountEmail: string; readonly deletedWorkspaceIds: readonly string[] }): Promise<void> {
    const orphans: Record<string, number> = {};
    const count = async (name: string, text: string, values: readonly SqlValue[]): Promise<void> => {
      const rows = (await this.session.execute({ text, values })).rows;
      const total = Number(rows[0]?.['count'] ?? 0);
      if (total > 0) orphans[name] = total;
    };
    await count('identity_proofs', `SELECT COUNT(*) AS "count" FROM ${this.t('identity_proofs')} WHERE "user_id" = $1`, [input.userId]);
    await count('identity_webauthn_credentials', `SELECT COUNT(*) AS "count" FROM ${this.t('identity_webauthn_credentials')} WHERE "user_id" = $1`, [input.userId]);
    await count('identity_single_use_proofs', `SELECT COUNT(*) AS "count" FROM ${this.t('identity_single_use_proofs')} WHERE "user_id" = $1`, [input.userId]);
    await count('identity_unbound_proofs', `SELECT COUNT(*) AS "count" FROM ${this.t('identity_single_use_proofs')} WHERE "user_id" IS NULL AND "email" = $1`, [input.accountEmail]);
    await count('identity_email_tickets', `SELECT COUNT(*) AS "count" FROM ${this.t('identity_email_registration_tickets')} WHERE "user_id" = $1 OR ("user_id" IS NULL AND "email" = $2)`, [input.userId, input.accountEmail]);
    await count('identity_social_links', `SELECT COUNT(*) AS "count" FROM ${this.t('identity_social_links')} WHERE "user_id" = $1`, [input.userId]);
    await count('identity_login_sessions', `SELECT COUNT(*) AS "count" FROM ${this.t('identity_login_sessions')} WHERE "user_id" = $1`, [input.userId]);
    await count('identity_login_token_bindings', `SELECT COUNT(*) AS "count" FROM ${this.t('identity_login_token_bindings')} WHERE "session_id" IN (SELECT "session_id" FROM ${this.t('identity_login_sessions')} WHERE "user_id" = $1)`, [input.userId]);
    await count('identity_account_profiles', `SELECT COUNT(*) AS "count" FROM ${this.t('identity_account_profiles')} WHERE "user_id" = $1`, [input.userId]);
    await count('identity_user_accounts', `SELECT COUNT(*) AS "count" FROM ${this.t('identity_user_accounts')} WHERE "user_id" = $1`, [input.userId]);
    await count('cm_tenant_memberships', `SELECT COUNT(*) AS "count" FROM ${this.cm('cm_tenant_memberships')} WHERE "user_id" = $1`, [input.userId]);
    await count('cm_workspace_members', `SELECT COUNT(*) AS "count" FROM ${this.cm('cm_workspace_members')} WHERE "user_id" = $1`, [input.userId]);
    await count('cm_oauth_consents', `SELECT COUNT(*) AS "count" FROM ${this.cm('cm_oauth_consents')} WHERE "user_id" = $1`, [input.userId]);
    await count('cm_identity_conversation_sessions', `SELECT COUNT(*) AS "count" FROM ${this.t('cm_identity_conversation_sessions' as IdentityTableName)} WHERE "user_id" = $1`, [input.userId]);
    await count('identity_device_codes', `SELECT COUNT(*) AS "count" FROM ${this.t('identity_device_codes')} WHERE "approved_user_id" = $1`, [input.userId]);
    for (const workspaceId of input.deletedWorkspaceIds) {
      await count(`cm_workspace:${workspaceId}`, `SELECT COUNT(*) AS "count" FROM ${this.cm('cm_workspaces')} WHERE "workspace_id" = $1`, [workspaceId]);
      await count(`cm_workspace_members:${workspaceId}`, `SELECT COUNT(*) AS "count" FROM ${this.cm('cm_workspace_members')} WHERE "workspace_id" = $1`, [workspaceId]);
    }
    const names = Object.keys(orphans);
    if (names.length > 0) throw new IdentityCustodyErrorV1('identity_orphan_detected');
  }

  static rollbackReceipt(input: {
    readonly userId: string;
    readonly failedStep: RevocationStepKind;
    readonly completedBeforeFailure: ReadonlySet<RevocationStepKind>;
    readonly at: string;
  }): PersonDeletionReceiptV2 {
    const order: readonly RevocationStepKind[] = ['login_sessions', 'remote_reader_sessions', 'connector_grants', 'tenant_memberships', 'agent_plane', 'purpose_grants', 'catalogue', 'account'];
    const failedIndex = order.indexOf(input.failedStep);
    const steps: AtomicRevocationStepReceiptV2[] = order.map((step, index): AtomicRevocationStepReceiptV2 => {
      if (step === input.failedStep) return { step, outcome: 'queued', detail: 'required_local_step_failed' };
      if (step === 'remote_reader_sessions' || step === 'connector_grants' || step === 'purpose_grants' || step === 'catalogue') {
        return { step, outcome: 'not_applicable', detail: 'plane absent' };
      }
      if (step === 'agent_plane') return { step, outcome: 'not_applicable', detail: 'agent-plane hook not bound' };
      if (index < failedIndex && input.completedBeforeFailure.has(step)) {
        return { step, outcome: 'rolled_back', detail: 'transaction_rolled_back' };
      }
      return { step, outcome: 'queued', detail: 'not_attempted_after_failure' };
    });
    return {
      userId: input.userId,
      mode: 'delete',
      transaction: 'rolled_back',
      resultCode: 'identity_cascade_rolled_back',
      complete: false,
      steps,
      business: null,
      cleanup: {},
      at: input.at,
    };
  }
}
