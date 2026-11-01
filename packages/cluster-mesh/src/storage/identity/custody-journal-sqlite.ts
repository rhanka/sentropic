// A2.0b deletion journal, revocation outbox and core-table transaction layer
// on the SQLite local profile. Shares the caller's connection — and therefore
// the exclusive transaction — with the custody stores.

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
import type { SqliteConnection } from '../sqlite/connection.js';
import type { SqliteValue } from './custody-sqlite.js';

export class SqliteCustodyJournal {
  constructor(readonly connection: SqliteConnection) {}

  private readonly one = async <T>(decode: (row: Record<string, unknown>) => T, text: string, values: readonly SqliteValue[]): Promise<T | null> => {
    const row = this.connection.prepare(text).get(...values) as Record<string, unknown> | undefined;
    return row === undefined ? null : decode(row);
  };

  // -- Subject fences -------------------------------------------------------

  async ensureLiveFence(userId: string, at: string): Promise<void> {
    this.connection.prepare(`INSERT INTO "identity_subject_fences" ("user_id","revision","updated_at","retired_at") VALUES (?,0,?,NULL) ON CONFLICT("user_id") DO NOTHING`).run(userId, at);
    const fence = await this.one(
      (row) => ({ retiredAt: (row['retired_at'] as string | null) ?? null }),
      `SELECT "retired_at" FROM "identity_subject_fences" WHERE "user_id" = ?`,
      [userId],
    );
    if (fence?.retiredAt !== null && fence?.retiredAt !== undefined) throw new IdentityCustodyErrorV1('identity_subject_retired');
  }

  async retireFence(userId: string, at: string): Promise<void> {
    const changed = Number((this.connection.prepare(`UPDATE "identity_subject_fences" SET "retired_at" = ?, "revision" = "revision" + 1, "updated_at" = ? WHERE "user_id" = ? AND "retired_at" IS NULL`).run(at, at, userId) as { changes: number | bigint }).changes);
    if (changed === 0) throw new IdentityCustodyErrorV1('identity_subject_retired');
  }

  // -- Deletion operations --------------------------------------------------

  static requestDigestV1(userId: string, actorId: string, handlerId: string, operationId: string): string {
    return createHash('sha256').update(JSON.stringify(['A2.0b', '2.0.0', userId, actorId, handlerId, operationId]), 'utf8').digest('hex');
  }

  async reserveOperation(op: IdentityDeletionOperationV2): Promise<'reserved' | 'committed'> {
    try {
      this.connection.prepare(`INSERT INTO "identity_deletion_operations" ("operation_id","user_id","actor_id","handler_id","request_digest","state","created_at","committed_at","committed_receipt_json") VALUES (?,?,?,?,?,'queued',?,NULL,NULL)`).run(op.operationId, op.userId, op.actorId, op.handlerId, op.requestDigest, op.createdAt);
      return 'reserved';
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes('UNIQUE constraint failed')) throw error;
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
      `SELECT * FROM "identity_deletion_operations" WHERE "operation_id" = ?`,
      [operationId],
    );

  async markOperationCommitted(operationId: string, receipt: PersonDeletionReceiptV2, at: string): Promise<void> {
    const changed = Number((this.connection.prepare(`UPDATE "identity_deletion_operations" SET "state" = 'committed', "committed_at" = ?, "committed_receipt_json" = ? WHERE "operation_id" = ? AND "state" = 'queued'`).run(at, JSON.stringify(receipt), operationId) as { changes: number | bigint }).changes);
    if (changed === 0) throw new IdentityCustodyErrorV1('identity_operation_conflict');
  }

  async appendAttempt(attempt: IdentityDeletionAttemptV2): Promise<void> {
    if (attempt.receipt.transaction !== 'rolled_back') throw new IdentityCustodyErrorV1('identity_material_invalid');
    this.connection.prepare(`INSERT INTO "identity_deletion_attempts" ("attempt_id","operation_id","at","receipt_json") VALUES (?,?,?,?)`).run(attempt.attemptId, attempt.operationId, attempt.at, JSON.stringify(attempt.receipt));
  }

  latestReceipt = async (operationId: string): Promise<PersonDeletionReceiptV2 | null> => {
    const committed = await this.one(
      (row) => (row['committed_receipt_json'] as string | null) ?? null,
      `SELECT "committed_receipt_json" FROM "identity_deletion_operations" WHERE "operation_id" = ? AND "state" = 'committed'`,
      [operationId],
    );
    if (committed) return JSON.parse(committed) as PersonDeletionReceiptV2;
    const attempt = await this.one(
      (row) => String(row['receipt_json']),
      `SELECT "receipt_json" FROM "identity_deletion_attempts" WHERE "operation_id" = ? ORDER BY "at" DESC, "attempt_id" DESC LIMIT 1`,
      [operationId],
    );
    return attempt ? (JSON.parse(attempt) as PersonDeletionReceiptV2) : null;
  };

  // -- Revocation outbox ----------------------------------------------------

  async enqueueDelivery(delivery: IdentityExternalRevocationV1): Promise<void> {
    try {
      this.connection.prepare(`INSERT INTO "identity_revocation_outbox" ("delivery_id","operation_id","step","subject_id","target_kind","target_ref","state","created_at","next_attempt_at","custody_ref","delivered_at","claim_owner","lease_until","claim_version","attempt_count") VALUES (?,?,?,?,?,?,'pending',?,?,NULL,NULL,NULL,NULL,0,0)`).run(delivery.deliveryId, delivery.operationId, delivery.step, delivery.subjectId, delivery.targetKind, delivery.targetRef, delivery.createdAt, delivery.nextAttemptAt, null);
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes('UNIQUE constraint failed')) throw error;
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
      `SELECT * FROM "identity_revocation_outbox" WHERE "delivery_id" = ?`,
      [deliveryId],
    );

  async claimPending(now: string, owner: string, leaseUntil: string, limit: number): Promise<readonly (IdentityExternalRevocationV1 & { readonly claimVersion: number })[]> {
    if (!Number.isInteger(limit) || limit <= 0) throw new IdentityCustodyErrorV1('identity_material_invalid');
    if (!(leaseUntil > now)) throw new IdentityCustodyErrorV1('identity_material_invalid');
    const candidates = this.connection.prepare(`SELECT "delivery_id" FROM "identity_revocation_outbox" WHERE "state" = 'pending' AND "next_attempt_at" <= ? AND ("lease_until" IS NULL OR "lease_until" <= ?) ORDER BY "next_attempt_at", "created_at", "delivery_id" LIMIT ?`).all(now, now, limit) as readonly Record<string, unknown>[];
    const claimed: (IdentityExternalRevocationV1 & { readonly claimVersion: number })[] = [];
    for (const candidate of candidates) {
      const deliveryId = String(candidate['delivery_id']);
      const updated = await this.one(
        (row) => ({ version: Number(row['claim_version']), row }),
        `UPDATE "identity_revocation_outbox" SET "claim_owner" = ?, "lease_until" = ?, "claim_version" = "claim_version" + 1, "attempt_count" = "attempt_count" + 1 WHERE "delivery_id" = ? AND "state" = 'pending' AND ("lease_until" IS NULL OR "lease_until" <= ?) RETURNING *`,
        [owner, leaseUntil, deliveryId, now],
      );
      if (!updated) continue;
      const record = updated.row;
      claimed.push({
        deliveryId: String(record['delivery_id']),
        operationId: String(record['operation_id']),
        step: String(record['step']),
        subjectId: String(record['subject_id']),
        targetKind: String(record['target_kind']),
        targetRef: String(record['target_ref']),
        state: record['state'] as IdentityExternalRevocationV1['state'],
        createdAt: String(record['created_at']),
        nextAttemptAt: String(record['next_attempt_at']),
        claimVersion: updated.version,
      });
    }
    return claimed;
  }

  async acknowledgeDelivery(deliveryId: string, owner: string, version: number, at: string): Promise<void> {
    const changed = Number((this.connection.prepare(`UPDATE "identity_revocation_outbox" SET "state" = 'delivered', "delivered_at" = ?, "claim_owner" = NULL, "lease_until" = NULL WHERE "delivery_id" = ? AND "state" = 'pending' AND "claim_owner" = ? AND "claim_version" = ? AND "lease_until" > ?`).run(at, deliveryId, owner, version, at) as { changes: number | bigint }).changes);
    if (changed === 0) throw new IdentityCustodyErrorV1('identity_delivery_claim_conflict');
  }

  async releaseClaim(deliveryId: string, owner: string, version: number, nextAttemptAt: string): Promise<void> {
    const changed = Number((this.connection.prepare(`UPDATE "identity_revocation_outbox" SET "claim_owner" = NULL, "lease_until" = NULL, "next_attempt_at" = ? WHERE "delivery_id" = ? AND "state" = 'pending' AND "claim_owner" = ? AND "claim_version" = ?`).run(nextAttemptAt, deliveryId, owner, version) as { changes: number | bigint }).changes);
    if (changed === 0) throw new IdentityCustodyErrorV1('identity_delivery_claim_conflict');
  }

  listPendingByOperation = async (operationId: string): Promise<readonly IdentityExternalRevocationV1[]> => {
    const rows = this.connection.prepare(`SELECT * FROM "identity_revocation_outbox" WHERE "operation_id" = ? ORDER BY "next_attempt_at", "created_at", "delivery_id"`).all(operationId) as readonly Record<string, unknown>[];
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
      `SELECT "receipt_json" FROM "identity_import_receipts" WHERE "migration_id" = ?`,
      [migrationId],
    );

  async insertImportReceipt(migrationId: string, row: { readonly sourceSnapshotRef: string; readonly sourceSnapshotDigest: string; readonly manifestDigest: string; readonly importedAt: string }, receipt: IdentityImportReceiptV1): Promise<void> {
    this.connection.prepare(`INSERT INTO "identity_import_receipts" ("migration_id","source_snapshot_ref","source_snapshot_digest","manifest_digest","contract_version","imported_at","receipt_json") VALUES (?,?,?,?,'1.1.0',?,?)`).run(migrationId, row.sourceSnapshotRef, row.sourceSnapshotDigest, row.manifestDigest, row.importedAt, JSON.stringify(receipt));
  }

  // -- Core account rows (import + deletion) --------------------------------

  async insertAccountCore(record: UserAccount): Promise<void> {
    try {
      this.connection.prepare(`INSERT INTO "identity_user_accounts" ("user_id","email","account_status","global_role","created_at","updated_at") VALUES (?,?,?,?,?,?)`).run(record.userId, record.email, record.accountStatus, record.globalRole, record.createdAt, record.updatedAt);
    } catch (error) {
      if (error instanceof Error && error.message.includes('UNIQUE constraint failed')) throw new IdentityCustodyErrorV1('identity_record_conflict');
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
      `SELECT * FROM "identity_user_accounts" WHERE "user_id" = ?`,
      [userId],
    );

  async deleteAccountCore(userId: string): Promise<void> {
    this.connection.prepare(`DELETE FROM "identity_user_accounts" WHERE "user_id" = ?`).run(userId);
  }

  // -- Tenancy / workspace rows (import + deletion) --------------------------

  async insertTenantCore(tenant: { readonly tenantId: string; readonly slug: string; readonly status: string; readonly createdAt: string }): Promise<void> {
    this.connection.prepare(`INSERT INTO "cm_tenants" ("tenant_id","slug","status","created_at") VALUES (?,?,?,?) ON CONFLICT("tenant_id") DO NOTHING`).run(tenant.tenantId, tenant.slug, tenant.status, tenant.createdAt);
  }

  async insertMembershipCore(membership: { readonly userId: string; readonly tenantId: string; readonly status: string; readonly tenantRole: string; readonly decidedBy?: string; readonly decidedAt?: string; readonly updatedAt: string }): Promise<void> {
    this.connection.prepare(`INSERT INTO "cm_tenant_memberships" ("user_id","tenant_id","status","tenant_role","decided_by","decided_at","updated_at") VALUES (?,?,?,?,?,?,?) ON CONFLICT("user_id","tenant_id") DO NOTHING`).run(membership.userId, membership.tenantId, membership.status, membership.tenantRole, membership.decidedBy ?? null, membership.decidedAt ?? null, membership.updatedAt);
  }

  async insertWorkspaceCore(workspace: { readonly workspaceId: string; readonly tenantId: string; readonly repoIdentity: string | null; readonly aliases: readonly string[]; readonly enrolledAt: string }): Promise<void> {
    this.connection.prepare(`INSERT INTO "cm_workspaces" ("workspace_id","tenant_id","repo_identity","aliases","enrolled_at") VALUES (?,?,?,?,?) ON CONFLICT("workspace_id") DO NOTHING`).run(workspace.workspaceId, workspace.tenantId, workspace.repoIdentity, JSON.stringify(workspace.aliases), workspace.enrolledAt);
  }

  async insertWorkspaceMemberCore(member: { readonly workspaceId: string; readonly userId: string; readonly role: string }): Promise<void> {
    this.connection.prepare(`INSERT INTO "cm_workspace_members" ("workspace_id","user_id","role") VALUES (?,?,?) ON CONFLICT("workspace_id","user_id") DO NOTHING`).run(member.workspaceId, member.userId, member.role);
  }

  findTenantCore = (tenantId: string): Promise<{ readonly tenantId: string; readonly slug: string; readonly status: string; readonly createdAt: string } | null> =>
    this.one(
      (row) => ({ tenantId: String(row['tenant_id']), slug: String(row['slug']), status: String(row['status']), createdAt: String(row['created_at']) }),
      `SELECT * FROM "cm_tenants" WHERE "tenant_id" = ?`,
      [tenantId],
    );

  findWorkspaceCore = (workspaceId: string): Promise<{ readonly workspaceId: string; readonly tenantId: string } | null> =>
    this.one(
      (row) => ({ workspaceId: String(row['workspace_id']), tenantId: String(row['tenant_id']) }),
      `SELECT * FROM "cm_workspaces" WHERE "workspace_id" = ?`,
      [workspaceId],
    );

  async setImportedSessionBase(sessionId: string, status: 'active' | 'expired' | 'revoked', revokedAt: string | null): Promise<void> {
    const changed = Number((this.connection.prepare(`UPDATE "identity_login_sessions" SET "status" = ?, "revoked_at" = ? WHERE "session_id" = ?`).run(status, revokedAt, sessionId) as { changes: number | bigint }).changes);
    if (changed === 0) throw new IdentityCustodyErrorV1('identity_material_missing');
  }

  async insertConsentCore(consent: { readonly consentId: string; readonly tenantId: string; readonly userId: string; readonly clientId: string; readonly grantedAt: string }): Promise<void> {
    this.connection.prepare(`INSERT INTO "cm_oauth_consents" ("consent_id","tenant_id","user_id","client_id","granted_at","revoked_at") VALUES (?,?,?,?,?,NULL) ON CONFLICT("consent_id") DO NOTHING`).run(consent.consentId, consent.tenantId, consent.userId, consent.clientId, consent.grantedAt);
  }

  // -- Subject cleanup (CM-owned, both handlers) ------------------------------

  listMembershipsForUser = async (userId: string): Promise<readonly { readonly tenantId: string; readonly status: string; readonly tenantRole: string }[]> => {
    const rows = this.connection.prepare(`SELECT "tenant_id","status","tenant_role" FROM "cm_tenant_memberships" WHERE "user_id" = ?`).all(userId) as readonly Record<string, unknown>[];
    return rows.map((row) => ({ tenantId: String(row['tenantId'] ?? row['tenant_id']), status: String(row['status']), tenantRole: String(row['tenant_role']) }));
  };

  listWorkspaceIdsForUser = async (userId: string): Promise<readonly string[]> => {
    const rows = this.connection.prepare(`SELECT "workspace_id" FROM "cm_workspace_members" WHERE "user_id" = ?`).all(userId) as readonly Record<string, unknown>[];
    return rows.map((row) => String(row['workspace_id']));
  };

  countAdminsInWorkspace = async (workspaceId: string): Promise<number> => {
    const row = this.connection.prepare(`SELECT COUNT(*) AS "count" FROM "cm_workspace_members" WHERE "workspace_id" = ? AND "role" = 'admin'`).get(workspaceId) as Record<string, unknown>;
    return Number(row['count'] ?? 0);
  };

  roleInWorkspace = async (workspaceId: string, userId: string): Promise<string | null> => {
    const row = await this.one(
      (r) => String(r['role']),
      `SELECT "role" FROM "cm_workspace_members" WHERE "workspace_id" = ? AND "user_id" = ?`,
      [workspaceId, userId],
    );
    return row;
  };

  async deleteMembershipsForUser(userId: string): Promise<number> {
    return Number((this.connection.prepare(`DELETE FROM "cm_tenant_memberships" WHERE "user_id" = ?`).run(userId) as { changes: number | bigint }).changes);
  }

  async deleteWorkspaceMembersForUser(userId: string): Promise<number> {
    return Number((this.connection.prepare(`DELETE FROM "cm_workspace_members" WHERE "user_id" = ?`).run(userId) as { changes: number | bigint }).changes);
  }

  async deleteWorkspaceMembersIn(workspaceIds: readonly string[]): Promise<number> {
    let total = 0;
    for (const workspaceId of workspaceIds) {
      total += Number((this.connection.prepare(`DELETE FROM "cm_workspace_members" WHERE "workspace_id" = ?`).run(workspaceId) as { changes: number | bigint }).changes);
    }
    return total;
  }

  async deleteWorkspace(workspaceId: string): Promise<void> {
    this.connection.prepare(`DELETE FROM "cm_workspaces" WHERE "workspace_id" = ?`).run(workspaceId);
  }

  async deleteConsentsForUser(userId: string): Promise<number> {
    return Number((this.connection.prepare(`DELETE FROM "cm_oauth_consents" WHERE "user_id" = ?`).run(userId) as { changes: number | bigint }).changes);
  }

  async deleteConversationsForUser(userId: string): Promise<number> {
    return Number((this.connection.prepare(`DELETE FROM "cm_identity_conversation_sessions" WHERE "user_id" = ?`).run(userId) as { changes: number | bigint }).changes);
  }

  async deleteProofsForUser(userId: string): Promise<number> {
    return Number((this.connection.prepare(`DELETE FROM "identity_proofs" WHERE "user_id" = ?`).run(userId) as { changes: number | bigint }).changes);
  }

  async deleteDeviceCodesForUser(userId: string): Promise<number> {
    return Number((this.connection.prepare(`DELETE FROM "identity_device_codes" WHERE "approved_user_id" = ?`).run(userId) as { changes: number | bigint }).changes);
  }

  async deleteSessionsForUser(userId: string): Promise<number> {
    const ids = this.connection.prepare(`SELECT "session_id" FROM "identity_login_sessions" WHERE "user_id" = ?`).all(userId) as readonly Record<string, unknown>[];
    let total = 0;
    for (const row of ids) {
      const sessionId = String(row['session_id']);
      this.connection.prepare(`DELETE FROM "identity_login_token_bindings" WHERE "session_id" = ?`).run(sessionId);
      total += Number((this.connection.prepare(`DELETE FROM "identity_login_sessions" WHERE "session_id" = ?`).run(sessionId) as { changes: number | bigint }).changes);
    }
    return total;
  }

  /** Deletes every custody row bound to the subject; returns per-table counts. */
  async cleanupCustodyForUser(userId: string, email: string): Promise<Readonly<Record<string, number>>> {
    const counts: Record<string, number> = {};
    const remove = (table: string, where: string, values: readonly SqliteValue[]): void => {
      const changed = Number((this.connection.prepare(`DELETE FROM "${table}" WHERE ${where}`).run(...values) as { changes: number | bigint }).changes);
      counts[table] = (counts[table] ?? 0) + changed;
    };
    remove('identity_webauthn_credentials', '"user_id" = ?', [userId]);
    remove('identity_single_use_proofs', '"user_id" = ?', [userId]);
    remove('identity_single_use_proofs', '"user_id" IS NULL AND "email" = ?', [email]);
    remove('identity_email_registration_tickets', '"user_id" = ?', [userId]);
    remove('identity_email_registration_tickets', '"user_id" IS NULL AND "email" = ?', [email]);
    remove('identity_social_links', '"user_id" = ?', [userId]);
    remove('identity_account_profiles', '"user_id" = ?', [userId]);
    return counts;
  }

  async revokePendingInvitationsForEmail(email: string): Promise<number> {
    return Number((this.connection.prepare(`UPDATE "identity_invitation_digests" SET "status" = 'revoked', "revision" = "revision" + 1 WHERE "email" = ? AND "status" = 'pending'`).run(email) as { changes: number | bigint }).changes);
  }

  async detachInvitationConsumer(userId: string): Promise<number> {
    return Number((this.connection.prepare(`UPDATE "identity_invitation_digests" SET "consumed_by_user_id" = NULL WHERE "consumed_by_user_id" = ?`).run(userId) as { changes: number | bigint }).changes);
  }

  async detachInvitationWorkspace(workspaceId: string): Promise<number> {
    const pending = Number((this.connection.prepare(`UPDATE "identity_invitation_digests" SET "status" = 'revoked', "revision" = "revision" + 1 WHERE "workspace_id" = ? AND "status" = 'pending'`).run(workspaceId) as { changes: number | bigint }).changes);
    const detached = Number((this.connection.prepare(`UPDATE "identity_invitation_digests" SET "workspace_id" = NULL WHERE "workspace_id" = ?`).run(workspaceId) as { changes: number | bigint }).changes);
    return pending + detached;
  }

  /** Zero live identity/business references may remain after deletion. */
  async assertNoLiveReferences(input: { readonly userId: string; readonly accountEmail: string; readonly deletedWorkspaceIds: readonly string[] }): Promise<void> {
    const count = (text: string, values: readonly SqliteValue[]): number => {
      const row = this.connection.prepare(text).get(...values) as Record<string, unknown>;
      return Number(row['count'] ?? 0);
    };
    const orphans: string[] = [];
    const check = (name: string, text: string, values: readonly SqliteValue[]): void => {
      if (count(text, values) > 0) orphans.push(name);
    };
    check('identity_proofs', `SELECT COUNT(*) AS "count" FROM "identity_proofs" WHERE "user_id" = ?`, [input.userId]);
    check('identity_webauthn_credentials', `SELECT COUNT(*) AS "count" FROM "identity_webauthn_credentials" WHERE "user_id" = ?`, [input.userId]);
    check('identity_single_use_proofs', `SELECT COUNT(*) AS "count" FROM "identity_single_use_proofs" WHERE "user_id" = ?`, [input.userId]);
    check('identity_unbound_proofs', `SELECT COUNT(*) AS "count" FROM "identity_single_use_proofs" WHERE "user_id" IS NULL AND "email" = ?`, [input.accountEmail]);
    check('identity_email_tickets', `SELECT COUNT(*) AS "count" FROM "identity_email_registration_tickets" WHERE "user_id" = ? OR ("user_id" IS NULL AND "email" = ?)`, [input.userId, input.accountEmail]);
    check('identity_social_links', `SELECT COUNT(*) AS "count" FROM "identity_social_links" WHERE "user_id" = ?`, [input.userId]);
    check('identity_login_sessions', `SELECT COUNT(*) AS "count" FROM "identity_login_sessions" WHERE "user_id" = ?`, [input.userId]);
    check('identity_login_token_bindings', `SELECT COUNT(*) AS "count" FROM "identity_login_token_bindings" WHERE "session_id" IN (SELECT "session_id" FROM "identity_login_sessions" WHERE "user_id" = ?)`, [input.userId]);
    check('identity_account_profiles', `SELECT COUNT(*) AS "count" FROM "identity_account_profiles" WHERE "user_id" = ?`, [input.userId]);
    check('identity_user_accounts', `SELECT COUNT(*) AS "count" FROM "identity_user_accounts" WHERE "user_id" = ?`, [input.userId]);
    check('cm_tenant_memberships', `SELECT COUNT(*) AS "count" FROM "cm_tenant_memberships" WHERE "user_id" = ?`, [input.userId]);
    check('cm_workspace_members', `SELECT COUNT(*) AS "count" FROM "cm_workspace_members" WHERE "user_id" = ?`, [input.userId]);
    check('cm_oauth_consents', `SELECT COUNT(*) AS "count" FROM "cm_oauth_consents" WHERE "user_id" = ?`, [input.userId]);
    check('cm_identity_conversation_sessions', `SELECT COUNT(*) AS "count" FROM "cm_identity_conversation_sessions" WHERE "user_id" = ?`, [input.userId]);
    check('identity_device_codes', `SELECT COUNT(*) AS "count" FROM "identity_device_codes" WHERE "approved_user_id" = ?`, [input.userId]);
    for (const workspaceId of input.deletedWorkspaceIds) {
      check(`cm_workspace:${workspaceId}`, `SELECT COUNT(*) AS "count" FROM "cm_workspaces" WHERE "workspace_id" = ?`, [workspaceId]);
      check(`cm_workspace_members:${workspaceId}`, `SELECT COUNT(*) AS "count" FROM "cm_workspace_members" WHERE "workspace_id" = ?`, [workspaceId]);
    }
    if (orphans.length > 0) throw new IdentityCustodyErrorV1('identity_orphan_detected');
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
