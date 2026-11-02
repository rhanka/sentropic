// A2.3 identity slice: the SQLite profile of this lot's store slice — the
// conversation authority store and the audit/escalation ledger over the
// kernel's published `SqliteConnection` contract (opened via
// `openSqliteEngine({ path, moduleId })`, which owns process isolation and
// the module identity). The `cm_identity_*` schema is idempotent; entries
// seal through the same shared digest and verifier as the in-memory double
// and the PostgreSQL profile, so chain tamper detection is one behavior.

import type { SqliteConnection } from '../storage/sqlite/connection.js';
import { applyAtomicSqliteDdl } from '../storage/identity/sqlite-schema.js';
import { ConversationSessionError, type ConversationAuthorityStore, type ConversationSessionRecord } from './conversation.js';
import {
  escalationEntryDigest,
  verifyEscalationChainsOf,
  type EscalationChainVerification,
  type EscalationLedgerEntry,
  type EscalationLedgerEntryDraft,
  type EscalationLedgerQuery,
  type IdentityLedgerStore,
} from './ledger.js';
import type { IdentityAuditEvent } from '../identity-contracts/types.js';

/** Idempotent `cm_identity_*` schema set; safe on every open. */
export const IDENTITY_SQLITE_SCHEMA: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS cm_identity_conversation_sessions (
    conversation_session_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    status TEXT NOT NULL,
    opened_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    revoked_at TEXT)`,
  `CREATE INDEX IF NOT EXISTS cm_identity_conversation_sessions_user
    ON cm_identity_conversation_sessions (user_id)`,
  `CREATE TABLE IF NOT EXISTS cm_identity_audit_events (
    ordinal INTEGER PRIMARY KEY AUTOINCREMENT,
    at TEXT NOT NULL,
    kind TEXT NOT NULL,
    actor_id TEXT,
    subject_id TEXT,
    detail TEXT)`,
  `CREATE TABLE IF NOT EXISTS cm_identity_escalation_entries (
    ordinal INTEGER PRIMARY KEY AUTOINCREMENT,
    escalation_id TEXT NOT NULL,
    owner_user_id TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    target_ref TEXT NOT NULL,
    entry_json TEXT NOT NULL,
    prev_entry_hash TEXT,
    entry_hash TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS cm_identity_escalation_entries_escalation
    ON cm_identity_escalation_entries (escalation_id)`,
];

export function applyIdentitySqliteSchema(db: SqliteConnection): void {
  applyAtomicSqliteDdl(db, IDENTITY_SQLITE_SCHEMA);
}

const rowToConversationSession = (row: Record<string, unknown>): ConversationSessionRecord => ({
  conversationSessionId: row.conversation_session_id as string,
  userId: row.user_id as string,
  workspaceId: row.workspace_id as string,
  status: row.status as ConversationSessionRecord['status'],
  openedAt: row.opened_at as string,
  expiresAt: row.expires_at as string,
  revokedAt: (row.revoked_at as string | null) ?? undefined,
});

const rowToEscalationEntry = (row: Record<string, unknown>): EscalationLedgerEntry => ({
  ...(JSON.parse(row.entry_json as string) as EscalationLedgerEntryDraft),
  prevEntryHash: (row.prev_entry_hash as string | null) ?? null,
  entryHash: row.entry_hash as string,
});

const rowToAuditEvent = (row: Record<string, unknown>): IdentityAuditEvent => ({
  at: row.at as string,
  kind: row.kind as string,
  actorId: (row.actor_id as string | null) ?? undefined,
  subjectId: (row.subject_id as string | null) ?? undefined,
  detail: (row.detail as string | null) ?? undefined,
});

/** One transaction per call; the engine's exclusive lock serializes writers. */
const withTransaction = <T>(db: SqliteConnection, operation: () => T): T => {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = operation();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
};

export function createIdentityEnforcementSqliteStores(input: {
  readonly db: SqliteConnection;
}): {
  readonly conversations: ConversationAuthorityStore;
  readonly ledger: IdentityLedgerStore;
} {
  const db = input.db;
  applyIdentitySqliteSchema(db);

  const conversations: ConversationAuthorityStore = {
    async saveSession(record) {
      withTransaction(db, () =>
        db
          .prepare(
            `INSERT INTO cm_identity_conversation_sessions
              (conversation_session_id, user_id, workspace_id, status, opened_at, expires_at, revoked_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT (conversation_session_id) DO UPDATE SET
              user_id = excluded.user_id,
              workspace_id = excluded.workspace_id,
              status = excluded.status,
              opened_at = excluded.opened_at,
              expires_at = excluded.expires_at,
              revoked_at = excluded.revoked_at`,
          )
          .run(
            record.conversationSessionId,
            record.userId,
            record.workspaceId,
            record.status,
            record.openedAt,
            record.expiresAt,
            record.revokedAt ?? null,
          ),
      );
    },
    async findSession(conversationSessionId) {
      const row = withTransaction(db, () =>
        db
          .prepare('SELECT * FROM cm_identity_conversation_sessions WHERE conversation_session_id = ?')
          .get(conversationSessionId),
      ) as Record<string, unknown> | undefined;
      return row ? rowToConversationSession(row) : null;
    },
    async revokeSession(conversationSessionId, at) {
      const row = withTransaction(db, () => {
        const existing = db
          .prepare('SELECT * FROM cm_identity_conversation_sessions WHERE conversation_session_id = ?')
          .get(conversationSessionId) as Record<string, unknown> | undefined;
        if (!existing) return undefined;
        db.prepare(
          `UPDATE cm_identity_conversation_sessions
           SET status = 'revoked', revoked_at = ?
           WHERE conversation_session_id = ?`,
        ).run(at, conversationSessionId);
        return db
          .prepare('SELECT * FROM cm_identity_conversation_sessions WHERE conversation_session_id = ?')
          .get(conversationSessionId) as Record<string, unknown>;
      });
      if (!row) throw new ConversationSessionError('not_found');
      return rowToConversationSession(row);
    },
    async listSessionsForUser(userId) {
      const rows = withTransaction(db, () =>
        db
          .prepare('SELECT * FROM cm_identity_conversation_sessions WHERE user_id = ? ORDER BY opened_at, conversation_session_id')
          .all(userId),
      ) as Record<string, unknown>[];
      return rows.map(rowToConversationSession);
    },
  };

  const ledger: IdentityLedgerStore = {
    async append(event) {
      withTransaction(db, () =>
        db
          .prepare(
            `INSERT INTO cm_identity_audit_events (at, kind, actor_id, subject_id, detail)
             VALUES (?, ?, ?, ?, ?)`,
          )
          .run(event.at, event.kind, event.actorId ?? null, event.subjectId ?? null, event.detail ?? null),
      );
    },
    async listAuditEvents() {
      const rows = withTransaction(db, () =>
        db.prepare('SELECT * FROM cm_identity_audit_events ORDER BY ordinal').all(),
      ) as Record<string, unknown>[];
      return rows.map(rowToAuditEvent);
    },
    async appendEscalationEntry(draft) {
      return withTransaction(db, () => {
        const tail = db
          .prepare(
            `SELECT entry_hash FROM cm_identity_escalation_entries
             WHERE escalation_id = ? ORDER BY ordinal DESC LIMIT 1`,
          )
          .get(draft.escalationId) as Record<string, unknown> | undefined;
        const prevEntryHash = (tail?.entry_hash as string | undefined) ?? null;
        const entry: EscalationLedgerEntry = {
          ...draft,
          prevEntryHash,
          entryHash: escalationEntryDigest(draft, prevEntryHash),
        };
        db.prepare(
          `INSERT INTO cm_identity_escalation_entries
            (escalation_id, owner_user_id, workspace_id, target_ref, entry_json, prev_entry_hash, entry_hash)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          draft.escalationId,
          draft.ownerUserId,
          draft.workspaceId,
          draft.targetRef,
          JSON.stringify(draft),
          prevEntryHash,
          entry.entryHash,
        );
        return entry;
      });
    },
    async listEscalationChain(escalationId) {
      const rows = withTransaction(db, () =>
        db
          .prepare('SELECT * FROM cm_identity_escalation_entries WHERE escalation_id = ? ORDER BY ordinal')
          .all(escalationId),
      ) as Record<string, unknown>[];
      return rows.map(rowToEscalationEntry);
    },
    async listEscalations(query: EscalationLedgerQuery) {
      const clauses: string[] = [];
      const values: (string | null)[] = [];
      if (query.ownerUserId !== undefined) {
        values.push(query.ownerUserId);
        clauses.push('owner_user_id = ?');
      }
      if (query.workspaceId !== undefined) {
        values.push(query.workspaceId);
        clauses.push('workspace_id = ?');
      }
      if (query.targetRef !== undefined) {
        values.push(query.targetRef);
        clauses.push('target_ref = ?');
      }
      const where = clauses.length > 0 ? ` WHERE ${clauses.join(' AND ')}` : '';
      const rows = withTransaction(db, () =>
        db.prepare(`SELECT * FROM cm_identity_escalation_entries${where} ORDER BY ordinal`).all(...values),
      ) as Record<string, unknown>[];
      return rows.map(rowToEscalationEntry);
    },
    async verifyEscalationChains(): Promise<readonly EscalationChainVerification[]> {
      const rows = withTransaction(db, () =>
        db
          .prepare('SELECT * FROM cm_identity_escalation_entries ORDER BY escalation_id, ordinal')
          .all(),
      ) as Record<string, unknown>[];
      return verifyEscalationChainsOf(rows.map(rowToEscalationEntry));
    },
  };

  return { conversations, ledger };
}
