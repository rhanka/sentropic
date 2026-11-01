// SQLite local profile of the A2.1 identity slice (spec r2 §2.9). Stores ride
// the existing `node:sqlite` engine (isolated owner process, EXCLUSIVE
// single-writer), so statement-level atomicity is inherited: the conditional
// consume/approve UPDATEs commit exactly once, and the per-method single
// write keeps read-back sequences consistent under the engine's lock.
// Methods are async to satisfy the frozen ports; each body is one
// synchronous IPC round-trip.

import type {
  DeviceCodeStore,
  IdentityAuditPort,
  IdentityProofStore,
  InvitationStore,
  LoginSessionStore,
  UserAccountStore,
} from '../../identity-contracts/index.js';
import type { DeviceCodeRecord, IdentityAuditEvent, IdentityProof, InvitationRecord, LoginSession, UserAccount } from '../../identity-contracts/index.js';
import type { SqliteConnection } from '../sqlite/connection.js';
import { openSqliteEngine, type SqliteEngine } from '../sqlite/engine.js';
import { decodeDeviceCode, decodeInvitation, decodeProof, decodeSession, decodeUserAccount } from './records.js';
import { identitySchemaStatements, identityTable, type IdentityTableName } from './schema.js';
import type { IdentityAccountStores } from './stores.js';

/** Idempotent identity DDL on an existing SQLite connection. */
export const applySqliteIdentityCoreSchema = (connection: SqliteConnection): void => {
  for (const ddl of identitySchemaStatements('sqlite', '')) connection.exec(ddl);
};

export interface SqliteIdentityStoresOptions {
  readonly connection: SqliteConnection;
}

/** Values bound into node:sqlite statements (SQL NULL for absent fields). */
type SqliteValue = string | number | null;

class SqliteSlice {
  constructor(protected readonly connection: SqliteConnection) {
    applySqliteIdentityCoreSchema(connection);
  }

  protected readonly table = (name: IdentityTableName): string => identityTable('sqlite', null, name);

  protected readonly get = <T>(decode: (row: Record<string, unknown>) => T, sql: string, values: readonly SqliteValue[]): T | null => {
    const row = this.connection.prepare(sql).get(...values) as Record<string, unknown> | undefined;
    return row === undefined ? null : decode(row);
  };

  protected readonly list = <T>(decode: (row: Record<string, unknown>) => T, sql: string, values: readonly SqliteValue[]): readonly T[] =>
    (this.connection.prepare(sql).all(...values) as readonly Record<string, unknown>[]).map(decode);

  protected readonly changes = (sql: string, values: readonly SqliteValue[]): number =>
    Number((this.connection.prepare(sql).run(...values) as { changes: number | bigint }).changes);
}

const ACCOUNT_COLUMNS = '"user_id","email","account_status","global_role","created_at","updated_at"';
const PROOF_COLUMNS = '"proof_id","user_id","kind","provider","expires_at","consumed_at","revoked_at","created_at"';
const INVITATION_COLUMNS = '"invitation_id","email","tenant_id","workspace_id","token","status","expires_at","consumed_at"';
const DEVICE_COLUMNS = '"device_code","user_code","device_name","status","approved_user_id","approved_at","issued_at","expires_at"';
const SESSION_COLUMNS = '"session_id","user_id","status","mfa_state","created_at","expires_at","revoked_at","refresh_count"';

const accountValues = (record: UserAccount): readonly SqliteValue[] => [
  record.userId, record.email, record.accountStatus, record.globalRole, record.createdAt, record.updatedAt,
];
const proofValues = (record: IdentityProof): readonly SqliteValue[] => [
  record.proofId, record.userId, record.kind, record.provider ?? null, record.expiresAt ?? null,
  record.consumedAt ?? null, record.revokedAt ?? null, record.createdAt,
];
const invitationValues = (record: InvitationRecord): readonly SqliteValue[] => [
  record.invitationId, record.email, record.tenantId ?? null, record.workspaceId ?? null, record.token,
  record.status, record.expiresAt, record.consumedAt ?? null,
];
const deviceValues = (record: DeviceCodeRecord): readonly SqliteValue[] => [
  record.deviceCode, record.userCode, record.deviceName, record.status, record.approvedUserId ?? null,
  record.approvedAt ?? null, record.issuedAt, record.expiresAt,
];
const sessionValues = (record: LoginSession): readonly SqliteValue[] => [
  record.sessionId, record.userId, record.status, record.mfaState, record.createdAt, record.expiresAt,
  record.revokedAt ?? null, record.refreshCount,
];

class SqliteUserAccountStore extends SqliteSlice implements UserAccountStore {
  async createAccount(record: UserAccount): Promise<void> {
    this.connection
      .prepare(`INSERT INTO ${this.table('identity_user_accounts')} (${ACCOUNT_COLUMNS}) VALUES (?,?,?,?,?,?)`)
      .run(...accountValues(record));
  }

  async findAccount(userId: string): Promise<UserAccount | null> {
    return this.get(decodeUserAccount, `SELECT ${ACCOUNT_COLUMNS} FROM ${this.table('identity_user_accounts')} WHERE "user_id" = ?`, [userId]);
  }

  async findAccountByEmail(email: string): Promise<UserAccount | null> {
    return this.get(decodeUserAccount, `SELECT ${ACCOUNT_COLUMNS} FROM ${this.table('identity_user_accounts')} WHERE "email" = ?`, [email]);
  }

  async listAccounts(): Promise<readonly UserAccount[]> {
    return this.list(
      decodeUserAccount,
      `SELECT ${ACCOUNT_COLUMNS} FROM ${this.table('identity_user_accounts')} ORDER BY "created_at", "user_id"`,
      [],
    );
  }

  private async patch(userId: string, assignments: string, values: readonly SqliteValue[]): Promise<UserAccount> {
    this.changes(`UPDATE ${this.table('identity_user_accounts')} SET ${assignments} WHERE "user_id" = ?`, [...values, userId]);
    const updated = await this.findAccount(userId);
    if (!updated) throw new Error(`Account not found: ${userId}`);
    return updated;
  }

  async setAccountStatus(userId: string, status: UserAccount['accountStatus'], at: string): Promise<UserAccount> {
    return this.patch(userId, '"account_status" = ?, "updated_at" = ?', [status, at]);
  }

  async setGlobalRole(userId: string, role: UserAccount['globalRole'], at: string): Promise<UserAccount> {
    return this.patch(userId, '"global_role" = ?, "updated_at" = ?', [role, at]);
  }

  async deleteAccount(userId: string, _at: string): Promise<void> {
    this.changes(`DELETE FROM ${this.table('identity_user_accounts')} WHERE "user_id" = ?`, [userId]);
  }
}

class SqliteIdentityProofStore extends SqliteSlice implements IdentityProofStore {
  async addProof(record: IdentityProof): Promise<void> {
    this.connection
      .prepare(
        `INSERT INTO ${this.table('identity_proofs')} (${PROOF_COLUMNS}) VALUES (?,?,?,?,?,?,?,?)
         ON CONFLICT("proof_id") DO UPDATE SET "kind" = excluded."kind", "provider" = excluded."provider",
           "expires_at" = excluded."expires_at", "consumed_at" = excluded."consumed_at",
           "revoked_at" = excluded."revoked_at", "created_at" = excluded."created_at"`,
      )
      .run(...proofValues(record));
  }

  async findProof(proofId: string): Promise<IdentityProof | null> {
    return this.get(decodeProof, `SELECT ${PROOF_COLUMNS} FROM ${this.table('identity_proofs')} WHERE "proof_id" = ?`, [proofId]);
  }

  async listProofsForUser(userId: string): Promise<readonly IdentityProof[]> {
    return this.list(
      decodeProof,
      `SELECT ${PROOF_COLUMNS} FROM ${this.table('identity_proofs')} WHERE "user_id" = ? ORDER BY "created_at", "proof_id"`,
      [userId],
    );
  }

  private async patchProof(proofId: string, assignments: string, values: readonly SqliteValue[]): Promise<IdentityProof> {
    this.changes(`UPDATE ${this.table('identity_proofs')} SET ${assignments} WHERE "proof_id" = ?`, [...values, proofId]);
    const found = await this.findProof(proofId);
    if (!found) throw new Error(`Proof not found: ${proofId}`);
    return found;
  }

  async markProofConsumed(proofId: string, at: string): Promise<IdentityProof> {
    return this.patchProof(proofId, '"consumed_at" = ?', [at]);
  }

  async revokeProof(proofId: string, at: string): Promise<IdentityProof> {
    return this.patchProof(proofId, '"revoked_at" = ?', [at]);
  }
}

class SqliteInvitationStore extends SqliteSlice implements InvitationStore {
  async saveInvitation(record: InvitationRecord): Promise<void> {
    this.connection
      .prepare(
        `INSERT INTO ${this.table('identity_invitations')} (${INVITATION_COLUMNS}) VALUES (?,?,?,?,?,?,?,?)
         ON CONFLICT("invitation_id") DO UPDATE SET "email" = excluded."email", "tenant_id" = excluded."tenant_id",
           "workspace_id" = excluded."workspace_id", "token" = excluded."token", "status" = excluded."status",
           "expires_at" = excluded."expires_at", "consumed_at" = excluded."consumed_at"`,
      )
      .run(...invitationValues(record));
  }

  async findInvitation(invitationId: string): Promise<InvitationRecord | null> {
    return this.get(decodeInvitation, `SELECT ${INVITATION_COLUMNS} FROM ${this.table('identity_invitations')} WHERE "invitation_id" = ?`, [invitationId]);
  }

  async findInvitationByToken(token: string): Promise<InvitationRecord | null> {
    return this.get(decodeInvitation, `SELECT ${INVITATION_COLUMNS} FROM ${this.table('identity_invitations')} WHERE "token" = ?`, [token]);
  }

  async markInvitationConsumed(token: string, at: string): Promise<boolean> {
    return (
      this.changes(
        `UPDATE ${this.table('identity_invitations')} SET "status" = 'consumed', "consumed_at" = ?
         WHERE "token" = ? AND "status" = 'pending'`,
        [at, token],
      ) > 0
    );
  }

  async revokeInvitation(invitationId: string): Promise<InvitationRecord> {
    const changed = this.changes(
      `UPDATE ${this.table('identity_invitations')} SET "status" = 'revoked' WHERE "invitation_id" = ?`,
      [invitationId],
    );
    if (changed === 0) throw new Error(`Invitation not found: ${invitationId}`);
    const found = await this.findInvitation(invitationId);
    if (!found) throw new Error(`Invitation not found: ${invitationId}`);
    return found;
  }
}

class SqliteDeviceCodeStore extends SqliteSlice implements DeviceCodeStore {
  async saveDeviceCode(record: DeviceCodeRecord): Promise<void> {
    this.connection
      .prepare(
        `INSERT INTO ${this.table('identity_device_codes')} (${DEVICE_COLUMNS}) VALUES (?,?,?,?,?,?,?,?)
         ON CONFLICT("device_code") DO UPDATE SET "user_code" = excluded."user_code",
           "device_name" = excluded."device_name", "status" = excluded."status",
           "approved_user_id" = excluded."approved_user_id", "approved_at" = excluded."approved_at",
           "issued_at" = excluded."issued_at", "expires_at" = excluded."expires_at"`,
      )
      .run(...deviceValues(record));
  }

  async findDeviceCode(deviceCode: string): Promise<DeviceCodeRecord | null> {
    return this.get(decodeDeviceCode, `SELECT ${DEVICE_COLUMNS} FROM ${this.table('identity_device_codes')} WHERE "device_code" = ?`, [deviceCode]);
  }

  async findDeviceCodeByUser(userCode: string): Promise<DeviceCodeRecord | null> {
    return this.get(decodeDeviceCode, `SELECT ${DEVICE_COLUMNS} FROM ${this.table('identity_device_codes')} WHERE "user_code" = ?`, [userCode]);
  }

  async approveDeviceCode(userCode: string, approvedUserId: string, at: string): Promise<boolean> {
    return (
      this.changes(
        `UPDATE ${this.table('identity_device_codes')} SET "status" = 'approved', "approved_user_id" = ?, "approved_at" = ?
         WHERE "user_code" = ? AND "status" = 'pending'`,
        [approvedUserId, at, userCode],
      ) > 0
    );
  }
}

class SqliteLoginSessionStore extends SqliteSlice implements LoginSessionStore {
  async createSession(record: LoginSession): Promise<void> {
    this.connection
      .prepare(
        `INSERT INTO ${this.table('identity_login_sessions')} (${SESSION_COLUMNS}) VALUES (?,?,?,?,?,?,?,?)
         ON CONFLICT("session_id") DO UPDATE SET "user_id" = excluded."user_id", "status" = excluded."status",
           "mfa_state" = excluded."mfa_state", "created_at" = excluded."created_at",
           "expires_at" = excluded."expires_at", "revoked_at" = excluded."revoked_at",
           "refresh_count" = excluded."refresh_count"`,
      )
      .run(...sessionValues(record));
  }

  async findSession(sessionId: string): Promise<LoginSession | null> {
    return this.get(decodeSession, `SELECT ${SESSION_COLUMNS} FROM ${this.table('identity_login_sessions')} WHERE "session_id" = ?`, [sessionId]);
  }

  async touchSession(sessionId: string, update: Pick<LoginSession, 'expiresAt' | 'refreshCount'>): Promise<LoginSession> {
    const changed = this.changes(
      `UPDATE ${this.table('identity_login_sessions')} SET "expires_at" = ?, "refresh_count" = ? WHERE "session_id" = ?`,
      [update.expiresAt, update.refreshCount, sessionId],
    );
    if (changed === 0) throw new Error(`Session not found: ${sessionId}`);
    const found = await this.findSession(sessionId);
    if (!found) throw new Error(`Session not found: ${sessionId}`);
    return found;
  }

  async revokeSession(sessionId: string, at: string): Promise<LoginSession> {
    const changed = this.changes(
      `UPDATE ${this.table('identity_login_sessions')} SET "status" = 'revoked', "revoked_at" = ? WHERE "session_id" = ?`,
      [at, sessionId],
    );
    if (changed === 0) throw new Error(`Session not found: ${sessionId}`);
    const found = await this.findSession(sessionId);
    if (!found) throw new Error(`Session not found: ${sessionId}`);
    return found;
  }

  async revokeAllSessionsForUser(userId: string, at: string): Promise<number> {
    return this.changes(
      `UPDATE ${this.table('identity_login_sessions')} SET "status" = 'revoked', "revoked_at" = ?
       WHERE "user_id" = ? AND "status" = 'active'`,
      [at, userId],
    );
  }

  async listSessionsForUser(userId: string): Promise<readonly LoginSession[]> {
    return this.list(
      decodeSession,
      `SELECT ${SESSION_COLUMNS} FROM ${this.table('identity_login_sessions')} WHERE "user_id" = ? ORDER BY "created_at", "session_id"`,
      [userId],
    );
  }
}

class SqliteIdentityAudit extends SqliteSlice implements IdentityAuditPort {
  async append(event: IdentityAuditEvent): Promise<void> {
    this.connection
      .prepare(`INSERT INTO ${this.table('identity_audit_events')} ("at","kind","actor_id","subject_id","detail") VALUES (?,?,?,?,?)`)
      .run(event.at, event.kind, event.actorId ?? null, event.subjectId ?? null, event.detail ?? null);
  }
}

/** Durable A2.1 stores over an existing SQLite connection (local profile). */
export const createSqliteIdentityCoreStores = (options: SqliteIdentityStoresOptions): IdentityAccountStores => {
  const { connection } = options;
  return {
    accounts: new SqliteUserAccountStore(connection),
    proofs: new SqliteIdentityProofStore(connection),
    invitations: new SqliteInvitationStore(connection),
    deviceCodes: new SqliteDeviceCodeStore(connection),
    sessions: new SqliteLoginSessionStore(connection),
    audit: new SqliteIdentityAudit(connection),
  };
};

export interface SqliteIdentityStoresHandle {
  readonly stores: IdentityAccountStores;
  readonly engine: SqliteEngine;
  close(): void;
}

export interface OpenSqliteIdentityStoresOptions {
  readonly path: string;
  /** Owning module id persisted by the engine; the composition picks one
   * shared id so later slices reopen the same local store file. */
  readonly moduleId: string;
}

/** Opens the local-profile store file and returns durable A2.1 stores. */
export const openSqliteIdentityStores = (options: OpenSqliteIdentityStoresOptions): SqliteIdentityStoresHandle => {
  const engine = openSqliteEngine({ path: options.path, moduleId: options.moduleId });
  return {
    engine,
    stores: createSqliteIdentityCoreStores({ connection: engine.db }),
    close: (): void => engine.close(),
  };
};
