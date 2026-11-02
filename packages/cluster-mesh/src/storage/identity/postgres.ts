// PostgreSQL profile of the A2.1 identity slice (spec r2 §2.9). Stores ride
// the frozen `InjectedPgDriver` seam — one SERIALIZABLE transaction per store
// method, no schema-fingerprint coupling to the shared migration chain, so
// parallel lots cannot collide. Conditional UPDATEs give consume/approve
// their atomicity; serialization failures retry with a small bound.

import type {
  DeviceCodeStore,
  IdentityAuditPort,
  IdentityProofStore,
  InvitationStore,
  LoginSessionStore,
  UserAccountStore,
} from '../../identity-contracts/index.js';
import type { DeviceCodeRecord, IdentityAuditEvent, IdentityProof, InvitationRecord, LoginSession, UserAccount } from '../../identity-contracts/index.js';
import type { InjectedPgDriver, PgSession, SqlValue } from '../postgres/protocol.js';
import { PostgresStorageError } from '../postgres/errors.js';
import { decodeDeviceCode, decodeInvitation, decodeProof, decodeSession, decodeUserAccount } from './records.js';
import { IDENTITY_TABLES, identitySchemaStatements, identityTable, type IdentityTableName } from './schema.js';
import type { IdentityAccountStores } from './stores.js';

export const IDENTITY_TX_DEADLINE_MS = 5000;
const SERIALIZATION_CODES = new Set(['40001', '40P01']);

const isSerializationFailure = (error: unknown): boolean => {
  if (error instanceof PostgresStorageError && error.retryable) return true;
  const fields = (error ?? {}) as { readonly code?: unknown; readonly sqlState?: unknown };
  return SERIALIZATION_CODES.has(String(fields.code ?? fields.sqlState ?? ''));
};

export interface PostgresIdentityOptions {
  readonly driver: InjectedPgDriver;
  /** PostgreSQL schema the identity tables live in (hosted control schema). */
  readonly schema: string;
  readonly deadlineMs?: number;
}

/** Applies the idempotent identity DDL; safe to call concurrently. */
export const applyPostgresIdentityCoreSchema = async (options: PostgresIdentityOptions): Promise<void> => {
  const { driver, schema, deadlineMs = IDENTITY_TX_DEADLINE_MS } = options;
  await driver.transaction({ isolation: 'serializable', readOnly: false, deadlineMs }, async (session) => {
    await session.execute({ text: `CREATE SCHEMA IF NOT EXISTS "${schema}"`, values: [] });
    // One probe instead of 34 round trips when the schema was provisioned
    // atomically beforehand (the DDL below is all IF NOT EXISTS, so a
    // complete table set means the whole batch already committed).
    const present = await session.execute({
      text: 'SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = $1 AND table_name = ANY($2)',
      values: [schema, [...IDENTITY_TABLES]],
    });
    if (Number(present.rows[0]?.['n']) !== IDENTITY_TABLES.length) {
      for (const ddl of identitySchemaStatements('postgres', schema)) {
        await session.execute({ text: ddl, values: [] });
      }
    }
  });
};

class PostgresSlice {
  private static readonly schemaReady = new WeakMap<InjectedPgDriver, Map<string, Promise<void>>>();

  constructor(private readonly options: PostgresIdentityOptions) {}

  protected readonly table = (name: IdentityTableName): string => identityTable('postgres', this.options.schema, name);

  protected readonly run = async <T>(readOnly: boolean, operation: (session: PgSession) => Promise<T>): Promise<T> => {
    const { driver, deadlineMs = IDENTITY_TX_DEADLINE_MS } = this.options;
    const attempt = async (remaining: number): Promise<T> => {
      try {
        return await driver.transaction({ isolation: 'serializable', readOnly, deadlineMs }, operation);
      } catch (error) {
        if (remaining > 0 && isSerializationFailure(error)) return attempt(remaining - 1);
        throw error;
      }
    };
    await this.ensureSchema();
    return attempt(2);
  };

  /** One apply per (driver, schema), shared by every store of the slice. */
  private ensureSchema(): Promise<void> {
    const { driver, schema } = this.options;
    let bySchema = PostgresSlice.schemaReady.get(driver);
    if (!bySchema) {
      bySchema = new Map();
      PostgresSlice.schemaReady.set(driver, bySchema);
    }
    let ready = bySchema.get(schema);
    if (!ready) {
      ready = applyPostgresIdentityCoreSchema(this.options).catch((error) => {
        bySchema.delete(schema);
        throw error;
      });
      bySchema.set(schema, ready);
    }
    return ready;
  }

  protected static readonly rowOrNull =
    <T>(decode: (row: Record<string, unknown>) => T) =>
    (rows: readonly Record<string, unknown>[]): T | null =>
      rows.length > 0 ? decode(rows[0]) : null;

  protected static readonly rowsOf =
    <T>(decode: (row: Record<string, unknown>) => T) =>
    (rows: readonly Record<string, unknown>[]): readonly T[] =>
    rows.map(decode);
}

const ACCOUNT_COLUMNS = '"user_id","email","account_status","global_role","created_at","updated_at"';
const PROOF_COLUMNS = '"proof_id","user_id","kind","provider","expires_at","consumed_at","revoked_at","created_at"';
const INVITATION_COLUMNS = '"invitation_id","email","tenant_id","workspace_id","token","status","expires_at","consumed_at"';
const DEVICE_COLUMNS = '"device_code","user_code","device_name","status","approved_user_id","approved_at","issued_at","expires_at"';
const SESSION_COLUMNS = '"session_id","user_id","status","mfa_state","created_at","expires_at","revoked_at","refresh_count"';

const accountValues = (record: UserAccount): readonly SqlValue[] => [
  record.userId, record.email, record.accountStatus, record.globalRole, record.createdAt, record.updatedAt,
];
const proofValues = (record: IdentityProof): readonly SqlValue[] => [
  record.proofId, record.userId, record.kind, record.provider ?? null, record.expiresAt ?? null,
  record.consumedAt ?? null, record.revokedAt ?? null, record.createdAt,
];
const invitationValues = (record: InvitationRecord): readonly SqlValue[] => [
  record.invitationId, record.email, record.tenantId ?? null, record.workspaceId ?? null, record.token,
  record.status, record.expiresAt, record.consumedAt ?? null,
];
const deviceValues = (record: DeviceCodeRecord): readonly SqlValue[] => [
  record.deviceCode, record.userCode, record.deviceName, record.status, record.approvedUserId ?? null,
  record.approvedAt ?? null, record.issuedAt, record.expiresAt,
];
const sessionValues = (record: LoginSession): readonly SqlValue[] => [
  record.sessionId, record.userId, record.status, record.mfaState, record.createdAt, record.expiresAt,
  record.revokedAt ?? null, record.refreshCount,
];

class PostgresUserAccountStore extends PostgresSlice implements UserAccountStore {
  async createAccount(record: UserAccount): Promise<void> {
    await this.run(false, async (session) => {
      await session.execute({
        text: `INSERT INTO ${this.table('identity_user_accounts')} (${ACCOUNT_COLUMNS}) VALUES ($1,$2,$3,$4,$5,$6)`,
        values: accountValues(record),
      });
    });
  }

  private async find(selector: string, value: string): Promise<UserAccount | null> {
    return this.run(true, async (session) =>
      PostgresSlice.rowOrNull(decodeUserAccount)(
        (await session.execute({ text: `SELECT ${ACCOUNT_COLUMNS} FROM ${this.table('identity_user_accounts')} WHERE ${selector} = $1`, values: [value] })).rows,
      ));
  }

  async findAccount(userId: string): Promise<UserAccount | null> {
    return this.find('"user_id"', userId);
  }

  async findAccountByEmail(email: string): Promise<UserAccount | null> {
    return this.find('"email"', email);
  }

  async listAccounts(): Promise<readonly UserAccount[]> {
    return this.run(true, async (session) =>
      PostgresSlice.rowsOf(decodeUserAccount)(
        (await session.execute({
          text: `SELECT ${ACCOUNT_COLUMNS} FROM ${this.table('identity_user_accounts')} ORDER BY "created_at", "user_id"`,
          values: [],
        })).rows,
      ));
  }

  private async patch(userId: string, assignments: string, values: readonly SqlValue[]): Promise<UserAccount> {
    return this.run(false, async (session) => {
      await session.execute({
        text: `UPDATE ${this.table('identity_user_accounts')} SET ${assignments} WHERE "user_id" = $1`,
        values: [userId, ...values],
      });
      const found = PostgresSlice.rowOrNull(decodeUserAccount)(
        (await session.execute({ text: `SELECT ${ACCOUNT_COLUMNS} FROM ${this.table('identity_user_accounts')} WHERE "user_id" = $1`, values: [userId] })).rows,
      );
      if (!found) throw new Error(`Account not found: ${userId}`);
      return found;
    });
  }

  async setAccountStatus(userId: string, status: UserAccount['accountStatus'], at: string): Promise<UserAccount> {
    return this.patch(userId, '"account_status" = $2, "updated_at" = $3', [status, at]);
  }

  async setGlobalRole(userId: string, role: UserAccount['globalRole'], at: string): Promise<UserAccount> {
    return this.patch(userId, '"global_role" = $2, "updated_at" = $3', [role, at]);
  }

  async deleteAccount(userId: string, _at: string): Promise<void> {
    await this.run(false, async (session) => {
      await session.execute({ text: `DELETE FROM ${this.table('identity_user_accounts')} WHERE "user_id" = $1`, values: [userId] });
    });
  }
}

class PostgresIdentityProofStore extends PostgresSlice implements IdentityProofStore {
  async addProof(record: IdentityProof): Promise<void> {
    await this.run(false, async (session) => {
      await session.execute({
        text: `INSERT INTO ${this.table('identity_proofs')} (${PROOF_COLUMNS}) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
               ON CONFLICT ("proof_id") DO UPDATE SET "kind" = EXCLUDED."kind", "provider" = EXCLUDED."provider",
                 "expires_at" = EXCLUDED."expires_at", "consumed_at" = EXCLUDED."consumed_at",
                 "revoked_at" = EXCLUDED."revoked_at", "created_at" = EXCLUDED."created_at"`,
        values: proofValues(record),
      });
    });
  }

  async findProof(proofId: string): Promise<IdentityProof | null> {
    return this.run(true, async (session) =>
      PostgresSlice.rowOrNull(decodeProof)(
        (await session.execute({ text: `SELECT ${PROOF_COLUMNS} FROM ${this.table('identity_proofs')} WHERE "proof_id" = $1`, values: [proofId] })).rows,
      ));
  }

  async listProofsForUser(userId: string): Promise<readonly IdentityProof[]> {
    return this.run(true, async (session) =>
      PostgresSlice.rowsOf(decodeProof)(
        (await session.execute({
          text: `SELECT ${PROOF_COLUMNS} FROM ${this.table('identity_proofs')} WHERE "user_id" = $1 ORDER BY "created_at", "proof_id"`,
          values: [userId],
        })).rows,
      ));
  }

  private async patchProof(proofId: string, assignments: string, values: readonly SqlValue[]): Promise<IdentityProof> {
    return this.run(false, async (session) => {
      await session.execute({
        text: `UPDATE ${this.table('identity_proofs')} SET ${assignments} WHERE "proof_id" = $1`,
        values: [proofId, ...values],
      });
      const found = PostgresSlice.rowOrNull(decodeProof)(
        (await session.execute({ text: `SELECT ${PROOF_COLUMNS} FROM ${this.table('identity_proofs')} WHERE "proof_id" = $1`, values: [proofId] })).rows,
      );
      if (!found) throw new Error(`Proof not found: ${proofId}`);
      return found;
    });
  }

  async markProofConsumed(proofId: string, at: string): Promise<IdentityProof> {
    return this.patchProof(proofId, '"consumed_at" = $2', [at]);
  }

  async revokeProof(proofId: string, at: string): Promise<IdentityProof> {
    return this.patchProof(proofId, '"revoked_at" = $2', [at]);
  }
}

class PostgresInvitationStore extends PostgresSlice implements InvitationStore {
  async saveInvitation(record: InvitationRecord): Promise<void> {
    await this.run(false, async (session) => {
      await session.execute({
        text: `INSERT INTO ${this.table('identity_invitations')} (${INVITATION_COLUMNS}) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
               ON CONFLICT ("invitation_id") DO UPDATE SET "email" = EXCLUDED."email", "tenant_id" = EXCLUDED."tenant_id",
                 "workspace_id" = EXCLUDED."workspace_id", "token" = EXCLUDED."token", "status" = EXCLUDED."status",
                 "expires_at" = EXCLUDED."expires_at", "consumed_at" = EXCLUDED."consumed_at"`,
        values: invitationValues(record),
      });
    });
  }

  private async select(selector: string, value: string): Promise<InvitationRecord | null> {
    return this.run(true, async (session) =>
      PostgresSlice.rowOrNull(decodeInvitation)(
        (await session.execute({ text: `SELECT ${INVITATION_COLUMNS} FROM ${this.table('identity_invitations')} WHERE ${selector} = $1`, values: [value] })).rows,
      ));
  }

  async findInvitation(invitationId: string): Promise<InvitationRecord | null> {
    return this.select('"invitation_id"', invitationId);
  }

  async findInvitationByToken(token: string): Promise<InvitationRecord | null> {
    return this.select('"token"', token);
  }

  async markInvitationConsumed(token: string, at: string): Promise<boolean> {
    return this.run(false, async (session) => {
      const result = await session.execute({
        text: `UPDATE ${this.table('identity_invitations')} SET "status" = 'consumed', "consumed_at" = $2
               WHERE "token" = $1 AND "status" = 'pending'`,
        values: [token, at],
      });
      return (result.rowCount ?? 0) > 0;
    });
  }

  async revokeInvitation(invitationId: string): Promise<InvitationRecord> {
    return this.run(false, async (session) => {
      const result = await session.execute({
        text: `UPDATE ${this.table('identity_invitations')} SET "status" = 'revoked' WHERE "invitation_id" = $1`,
        values: [invitationId],
      });
      const found = PostgresSlice.rowOrNull(decodeInvitation)((await session.execute({
        text: `SELECT ${INVITATION_COLUMNS} FROM ${this.table('identity_invitations')} WHERE "invitation_id" = $1`,
        values: [invitationId],
      })).rows);
      if ((result.rowCount ?? 0) === 0 || !found) throw new Error(`Invitation not found: ${invitationId}`);
      return found;
    });
  }
}

class PostgresDeviceCodeStore extends PostgresSlice implements DeviceCodeStore {
  async saveDeviceCode(record: DeviceCodeRecord): Promise<void> {
    await this.run(false, async (session) => {
      await session.execute({
        text: `INSERT INTO ${this.table('identity_device_codes')} (${DEVICE_COLUMNS}) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
               ON CONFLICT ("device_code") DO UPDATE SET "user_code" = EXCLUDED."user_code",
                 "device_name" = EXCLUDED."device_name", "status" = EXCLUDED."status",
                 "approved_user_id" = EXCLUDED."approved_user_id", "approved_at" = EXCLUDED."approved_at",
                 "issued_at" = EXCLUDED."issued_at", "expires_at" = EXCLUDED."expires_at"`,
        values: deviceValues(record),
      });
    });
  }

  private async select(selector: string, value: string): Promise<DeviceCodeRecord | null> {
    return this.run(true, async (session) =>
      PostgresSlice.rowOrNull(decodeDeviceCode)(
        (await session.execute({ text: `SELECT ${DEVICE_COLUMNS} FROM ${this.table('identity_device_codes')} WHERE ${selector} = $1`, values: [value] })).rows,
      ));
  }

  async findDeviceCode(deviceCode: string): Promise<DeviceCodeRecord | null> {
    return this.select('"device_code"', deviceCode);
  }

  async findDeviceCodeByUser(userCode: string): Promise<DeviceCodeRecord | null> {
    return this.select('"user_code"', userCode);
  }

  async approveDeviceCode(userCode: string, approvedUserId: string, at: string): Promise<boolean> {
    return this.run(false, async (session) => {
      const result = await session.execute({
        text: `UPDATE ${this.table('identity_device_codes')} SET "status" = 'approved', "approved_user_id" = $2, "approved_at" = $3
               WHERE "user_code" = $1 AND "status" = 'pending'`,
        values: [userCode, approvedUserId, at],
      });
      return (result.rowCount ?? 0) > 0;
    });
  }
}

class PostgresLoginSessionStore extends PostgresSlice implements LoginSessionStore {
  async createSession(record: LoginSession): Promise<void> {
    await this.run(false, async (session) => {
      await session.execute({
        text: `INSERT INTO ${this.table('identity_login_sessions')} (${SESSION_COLUMNS}) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
               ON CONFLICT ("session_id") DO UPDATE SET "user_id" = EXCLUDED."user_id", "status" = EXCLUDED."status",
                 "mfa_state" = EXCLUDED."mfa_state", "created_at" = EXCLUDED."created_at",
                 "expires_at" = EXCLUDED."expires_at", "revoked_at" = EXCLUDED."revoked_at",
                 "refresh_count" = EXCLUDED."refresh_count"`,
        values: sessionValues(record),
      });
    });
  }

  async findSession(sessionId: string): Promise<LoginSession | null> {
    return this.run(true, async (session) =>
      PostgresSlice.rowOrNull(decodeSession)(
        (await session.execute({ text: `SELECT ${SESSION_COLUMNS} FROM ${this.table('identity_login_sessions')} WHERE "session_id" = $1`, values: [sessionId] })).rows,
      ));
  }

  private async writeThenRead(
    statementText: string,
    values: readonly SqlValue[],
    sessionId: string,
  ): Promise<LoginSession> {
    return this.run(false, async (session) => {
      const result = await session.execute({ text: statementText, values });
      if ((result.rowCount ?? 0) === 0) throw new Error(`Session not found: ${sessionId}`);
      const found = PostgresSlice.rowOrNull(decodeSession)(
        (await session.execute({ text: `SELECT ${SESSION_COLUMNS} FROM ${this.table('identity_login_sessions')} WHERE "session_id" = $1`, values: [sessionId] })).rows,
      );
      if (!found) throw new Error(`Session not found: ${sessionId}`);
      return found;
    });
  }

  async touchSession(sessionId: string, update: Pick<LoginSession, 'expiresAt' | 'refreshCount'>): Promise<LoginSession> {
    return this.writeThenRead(
      `UPDATE ${this.table('identity_login_sessions')} SET "expires_at" = $2, "refresh_count" = $3 WHERE "session_id" = $1`,
      [sessionId, update.expiresAt, update.refreshCount],
      sessionId,
    );
  }

  async revokeSession(sessionId: string, at: string): Promise<LoginSession> {
    return this.writeThenRead(
      `UPDATE ${this.table('identity_login_sessions')} SET "status" = 'revoked', "revoked_at" = $2 WHERE "session_id" = $1`,
      [sessionId, at],
      sessionId,
    );
  }

  async revokeAllSessionsForUser(userId: string, at: string): Promise<number> {
    return this.run(false, async (session) => {
      const result = await session.execute({
        text: `UPDATE ${this.table('identity_login_sessions')} SET "status" = 'revoked', "revoked_at" = $2
               WHERE "user_id" = $1 AND "status" = 'active'`,
        values: [userId, at],
      });
      return result.rowCount ?? 0;
    });
  }

  async listSessionsForUser(userId: string): Promise<readonly LoginSession[]> {
    return this.run(true, async (session) =>
      PostgresSlice.rowsOf(decodeSession)(
        (await session.execute({
          text: `SELECT ${SESSION_COLUMNS} FROM ${this.table('identity_login_sessions')} WHERE "user_id" = $1 ORDER BY "created_at", "session_id"`,
          values: [userId],
        })).rows,
      ));
  }
}

class PostgresIdentityAudit extends PostgresSlice implements IdentityAuditPort {
  async append(event: IdentityAuditEvent): Promise<void> {
    await this.run(false, async (session) => {
      await session.execute({
        text: `INSERT INTO ${this.table('identity_audit_events')} ("at","kind","actor_id","subject_id","detail") VALUES ($1,$2,$3,$4,$5)`,
        values: [event.at, event.kind, event.actorId ?? null, event.subjectId ?? null, event.detail ?? null],
      });
    });
  }
}

/** Durable A2.1 stores over one PostgreSQL control schema. */
export const createPostgresIdentityCoreStores = (options: PostgresIdentityOptions): IdentityAccountStores => {
  const accounts = new PostgresUserAccountStore(options);
  return {
    accounts,
    proofs: new PostgresIdentityProofStore(options),
    invitations: new PostgresInvitationStore(options),
    deviceCodes: new PostgresDeviceCodeStore(options),
    sessions: new PostgresLoginSessionStore(options),
    audit: new PostgresIdentityAudit(options),
  };
};
