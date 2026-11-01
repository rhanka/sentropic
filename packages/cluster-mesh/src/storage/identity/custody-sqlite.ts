// A2.0b custody stores on the SQLite local profile. Methods run on the
// caller-supplied connection; the exclusive unit of work owns BEGIN/COMMIT.
// Statement-level atomicity is inherited from the engine's write scheduling.
import type {
  BoundLoginSessionStoreV1,
  BoundLoginSessionV1,
  DigestInvitationStoreV1,
  DigestInvitationV1,
  EmailCodeProofV1,
  EmailRegistrationTicketStoreV1,
  EmailRegistrationTicketV1,
  IdentityAccountProfileStoreV1,
  IdentityCustodyStoresV1,
  IdentityRunOptionsV1,
  IdentityTransactionV1,
  IdentityUnitOfWorkV1,
  MagicLinkProofV1,
  SingleUseProofKeyV1,
  SingleUseProofMatchV1,
  SingleUseProofStoreV1,
  SingleUseProofV1,
  SocialIdentityStoreV1,
  SocialIdentityV1,
  WebAuthnChallengeV1,
  WebAuthnCredentialStoreV1,
  WebAuthnCredentialV1,
} from '../../identity-contracts/custody.js';
import { IdentityCustodyErrorV1 } from '../../identity-contracts/custody-errors.js';
import type { SqliteConnection } from '../sqlite/connection.js';
import { decodeSession } from './records.js';
import { InvitationError } from '../../identity-contracts/errors.js';
import { identitySchemaStatements, identityTable, type IdentityTableName } from './schema.js';
import {
  identityCustodySchemaAssetV1,
  isSocialRaceRetry,
  type IdentityCustodySchemaAssetV1,
  type IdentityCustodySchemaReceiptV1,
} from './custody-shared.js';
import { SqliteCustodyJournal } from './custody-journal-sqlite.js';
import {
  decodeAccountProfile,
  decodeBoundSession,
  decodeDigestInvitation,
  decodeEmailTicket,
  decodeSingleUseProof,
  decodeSocialLink,
  decodeWebAuthnCredential,
} from './custody-records.js';

export const SQLITE_CUSTODY_DEADLINE_MS = 5000;

export type SqliteValue = string | number | null;

export const sqliteCustodyTable = (table: IdentityTableName): string => identityTable('sqlite', null, table);

const isUniqueViolation = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('UNIQUE constraint failed');
};

export const requireSqliteWriteOptions = (options: IdentityRunOptionsV1): void => {
  if (options.mode !== 'write' && options.mode !== 'import' && options.mode !== 'delete') {
    throw new IdentityCustodyErrorV1('identity_transaction_unbound');
  }
  if (!Number.isInteger(options.deadlineMs) || options.deadlineMs <= 0) {
    throw new IdentityCustodyErrorV1('identity_material_invalid');
  }
};

const toBool = (value: boolean): number => (value ? 1 : 0);

/** Transaction-scoped custody bundle over one SQLite connection. */
export class SqliteCustodyTx implements IdentityCustodyStoresV1 {
  readonly profiles: IdentityAccountProfileStoreV1;
  readonly credentials: WebAuthnCredentialStoreV1;
  readonly singleUseProofs: SingleUseProofStoreV1;
  readonly emailTickets: EmailRegistrationTicketStoreV1;
  readonly invitations: DigestInvitationStoreV1;
  readonly sessions: BoundLoginSessionStoreV1;
  readonly social: SocialIdentityStoreV1;

  constructor(readonly connection: SqliteConnection) {
    this.profiles = {
      find: (userId) =>
        this.one(decodeAccountProfile, `SELECT * FROM "identity_account_profiles" WHERE "user_id" = ?`, [userId]),
      put: async (record) => {
        connection
          .prepare(
            `INSERT INTO "identity_account_profiles" ("user_id","email_verified","display_name","approval_due_at","approved_at","approved_by_user_id","disabled_at","disabled_reason","legacy_account_status") VALUES (?,?,?,?,?,?,?,?,?)
             ON CONFLICT("user_id") DO UPDATE SET "email_verified" = excluded."email_verified", "display_name" = excluded."display_name", "approval_due_at" = excluded."approval_due_at", "approved_at" = excluded."approved_at", "approved_by_user_id" = excluded."approved_by_user_id", "disabled_at" = excluded."disabled_at", "disabled_reason" = excluded."disabled_reason", "legacy_account_status" = excluded."legacy_account_status"`,
          )
          .run(record.userId, toBool(record.emailVerified), record.displayName, record.approvalDueAt, record.approvedAt, record.approvedByUserId, record.disabledAt, record.disabledReason, record.legacyAccountStatus);
      },
    };

    this.credentials = {
      insert: async (record) => {
        try {
          connection
            .prepare(
              `INSERT INTO "identity_webauthn_credentials" ("proof_id","user_id","credential_id","public_key_cose","counter","revision","rp_id","device_name","transports_json","uv","device_type","backed_up","created_at","last_used_at","revoked_at") VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            )
            .run(record.proofId, record.userId, record.credentialId, record.publicKeyCose, record.counter, record.revision, record.rpId, record.deviceName, record.transports === null ? null : JSON.stringify(record.transports), toBool(record.uv), record.deviceType, record.backedUp === null ? null : toBool(record.backedUp), record.createdAt, record.lastUsedAt, record.revokedAt);
        } catch (error) {
          if (isUniqueViolation(error)) throw new IdentityCustodyErrorV1('webauthn_credential_conflict');
          throw error;
        }
      },
      findById: (proofId) =>
        this.one(decodeWebAuthnCredential, `SELECT * FROM "identity_webauthn_credentials" WHERE "proof_id" = ?`, [proofId]),
      findByCredentialId: (credentialId) =>
        this.one(decodeWebAuthnCredential, `SELECT * FROM "identity_webauthn_credentials" WHERE "credential_id" = ?`, [credentialId]),
      listForUser: (userId) =>
        this.all(decodeWebAuthnCredential, `SELECT * FROM "identity_webauthn_credentials" WHERE "user_id" = ? ORDER BY "created_at", "proof_id"`, [userId]),
      compareAndSwapCounter: (input) => this.casCounter(input),
      rename: async (proofId, userId, deviceName) => {
        const changed = this.changes(`UPDATE "identity_webauthn_credentials" SET "device_name" = ?, "revision" = "revision" + 1 WHERE "proof_id" = ? AND "user_id" = ? AND "revoked_at" IS NULL`, [deviceName, proofId, userId]);
        if (changed === 0) throw new IdentityCustodyErrorV1('identity_material_invalid');
      },
      revoke: async (proofId, userId, at) => {
        const current = await this.one(decodeWebAuthnCredential, `SELECT * FROM "identity_webauthn_credentials" WHERE "proof_id" = ?`, [proofId]);
        if (!current || current.userId !== userId) throw new IdentityCustodyErrorV1('identity_material_missing');
        if (current.revokedAt !== null) return;
        connection.prepare(`UPDATE "identity_webauthn_credentials" SET "revoked_at" = ?, "revision" = "revision" + 1 WHERE "proof_id" = ? AND "user_id" = ?`).run(at, proofId, userId);
      },
    };

    this.singleUseProofs = {
      insert: (record) => this.insertProof(record),
      find: (key) => this.findProof(key),
      findChallenge: (challenge, purpose) => this.findChallengeRow(challenge, purpose),
      findLatestEmailCode: (email, candidates, now) => this.findLatestEmailCodeRow(email, candidates, now),
      findMagicLink: (tokenHash) => this.findMagicLinkRow(tokenHash),
      countEmailCodes: async (email, since) => {
        const row = connection.prepare(`SELECT COUNT(*) AS "count" FROM "identity_single_use_proofs" WHERE "kind" = 'email_code' AND "email" = ? AND "created_at" >= ?`).get(email, since) as Record<string, unknown>;
        return Number(row['count'] ?? 0);
      },
      consume: (input) => this.consumeProof(input),
      revoke: async (key, expectedRevision, at) => {
        const changed = this.changes(`UPDATE "identity_single_use_proofs" SET "state" = 'revoked', "revoked_at" = ?, "revision" = "revision" + 1 WHERE "kind" = ? AND "proof_id" = ? AND "state" = 'pending' AND "revision" = ?`, [at, key.kind, key.proofId, expectedRevision]);
        if (changed === 0) throw new IdentityCustodyErrorV1('proof_state_conflict');
      },
      purgeExpired: async (now) =>
        this.changes(`DELETE FROM "identity_single_use_proofs" WHERE "expires_at" <= ? AND "state" != 'pending'`, [now]),
    };

    this.emailTickets = {
      findByTokenHash: (tokenHash) =>
        this.one(decodeEmailTicket, `SELECT * FROM "identity_email_registration_tickets" WHERE "token_hash" = ?`, [tokenHash]),
      importTicket: async (record) => {
        try {
          connection.prepare(`INSERT INTO "identity_email_registration_tickets" ("code_kind","code_proof_id","email","token_hash","user_id","state","revision","created_at","expires_at","consumed_at","revoked_at") VALUES ('email_code',?,?,?,?,?,?,?,?,?,?)`).run(record.codeProofId, record.email, record.tokenHash, record.userId, record.state, record.revision, record.createdAt, record.expiresAt, record.consumedAt, record.revokedAt);
        } catch (error) {
          if (isUniqueViolation(error)) throw new IdentityCustodyErrorV1('identity_record_conflict');
          throw error;
        }
      },
      exchangeCode: (input) => this.exchangeCode(input),
      consume: (input) => this.consumeTicket(input),
      revoke: async (codeProofId, expectedRevision, at) => {
        const changed = this.changes(`UPDATE "identity_email_registration_tickets" SET "state" = 'revoked', "revoked_at" = ?, "revision" = "revision" + 1 WHERE "code_proof_id" = ? AND "state" = 'pending' AND "revision" = ?`, [at, codeProofId, expectedRevision]);
        if (changed === 0) throw new IdentityCustodyErrorV1('proof_state_conflict');
      },
    };

    this.invitations = {
      insert: async (record) => {
        try {
          connection
            .prepare(`INSERT INTO "identity_invitation_digests" ("invitation_id","email","tenant_id","workspace_id","client_id","token_hash","status","expires_at","created_at","consumed_at","consumed_by_user_id","revision") VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
            .run(record.invitationId, record.email, record.tenantId, record.workspaceId, record.clientId, record.tokenHash, record.status, record.expiresAt, record.createdAt, record.consumedAt, record.consumedByUserId, record.revision);
        } catch (error) {
          if (isUniqueViolation(error)) throw new IdentityCustodyErrorV1('identity_record_conflict');
          throw error;
        }
      },
      findById: (invitationId) =>
        this.one(decodeDigestInvitation, `SELECT * FROM "identity_invitation_digests" WHERE "invitation_id" = ?`, [invitationId]),
      findByDigest: (tokenHash) =>
        this.one(decodeDigestInvitation, `SELECT * FROM "identity_invitation_digests" WHERE "token_hash" = ?`, [tokenHash]),
      consumeByDigest: (input) => this.consumeInvitation(input),
      revoke: async (invitationId, expectedRevision, at) => {
        void at;
        const changed = this.changes(`UPDATE "identity_invitation_digests" SET "status" = 'revoked', "revision" = "revision" + 1 WHERE "invitation_id" = ? AND "status" = 'pending' AND "revision" = ?`, [invitationId, expectedRevision]);
        if (changed === 0) throw new IdentityCustodyErrorV1('proof_state_conflict');
      },
    };

    this.sessions = {
      insert: (record) => this.insertBoundSession(record),
      findById: (sessionId) => this.findBoundSession(sessionId),
      findBySessionTokenHash: (hash) => this.findBoundSessionByHash('session_token_hash', hash),
      findByRefreshTokenHash: (hash) => this.findBoundSessionByHash('refresh_token_hash', hash),
      rotate: (input) => this.rotateBoundSession(input),
      touchActivity: async (sessionId, at) => {
        connection.prepare(`UPDATE "identity_login_token_bindings" SET "last_activity_at" = ? WHERE "session_id" = ?`).run(at, sessionId);
      },
      revoke: (sessionId, at) => this.revokeBoundSession(sessionId, at),
      revokeAllForUser: async (userId, at) => {
        const rows = connection.prepare(`SELECT "session_id" FROM "identity_login_sessions" WHERE "user_id" = ? AND "status" = 'active'`).all(userId) as readonly Record<string, unknown>[];
        let revoked = 0;
        for (const row of rows) {
          await this.revokeBoundSession(String(row['session_id']), at);
          revoked += 1;
        }
        return revoked;
      },
      listForUser: (userId) => this.listBoundSessions(userId),
    };

    this.social = {
      insert: async (record) => {
        try {
          connection
            .prepare(`INSERT INTO "identity_social_links" ("proof_id","user_id","provider","provider_subject","provider_tenant","email_at_link","email_verified_by_provider","linked_at","last_login_at","revoked_at","revision") VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
            .run(record.proofId, record.userId, record.provider, record.providerSubject, record.providerTenant, record.emailAtLink, toBool(record.emailVerifiedByProvider), record.linkedAt, record.lastLoginAt, record.revokedAt, record.revision);
        } catch (error) {
          if (isUniqueViolation(error)) throw new IdentityCustodyErrorV1('social_subject_conflict');
          throw error;
        }
      },
      findById: (proofId) => this.one(decodeSocialLink, `SELECT * FROM "identity_social_links" WHERE "proof_id" = ?`, [proofId]),
      findBySubject: (provider, providerSubject) =>
        this.one(decodeSocialLink, `SELECT * FROM "identity_social_links" WHERE "provider" = ? AND "provider_subject" = ?`, [provider, providerSubject]),
      listForUser: (userId) =>
        this.all(decodeSocialLink, `SELECT * FROM "identity_social_links" WHERE "user_id" = ? ORDER BY "linked_at", "proof_id"`, [userId]),
      touchLogin: async (proofId, expectedRevision, at) => {
        const changed = this.changes(`UPDATE "identity_social_links" SET "last_login_at" = ?, "revision" = "revision" + 1 WHERE "proof_id" = ? AND "revoked_at" IS NULL AND "revision" = ?`, [at, proofId, expectedRevision]);
        if (changed === 0) throw new IdentityCustodyErrorV1('proof_state_conflict');
      },
      unlink: async (proofId, userId, expectedRevision, at) => {
        void at;
        const changed = this.changes(`DELETE FROM "identity_social_links" WHERE "proof_id" = ? AND "user_id" = ? AND "revision" = ?`, [proofId, userId, expectedRevision]);
        if (changed === 0) throw new IdentityCustodyErrorV1('proof_state_conflict');
      },
    };
  }

  private readonly one = async <T>(decode: (row: Record<string, unknown>) => T, sql: string, values: readonly SqliteValue[]): Promise<T | null> => {
    const row = this.connection.prepare(sql).get(...values) as Record<string, unknown> | undefined;
    return row === undefined ? null : decode(row);
  };

  private readonly all = async <T>(decode: (row: Record<string, unknown>) => T, sql: string, values: readonly SqliteValue[]): Promise<readonly T[]> =>
    (this.connection.prepare(sql).all(...values) as readonly Record<string, unknown>[]).map(decode);

  private readonly changes = (sql: string, values: readonly SqliteValue[]): number =>
    Number((this.connection.prepare(sql).run(...values) as { changes: number | bigint }).changes);

  private readonly casCounter = async (input: {
    readonly proofId: string;
    readonly userId: string;
    readonly expectedCounter: number;
    readonly expectedRevision: number;
    readonly newCounter: number;
    readonly at: string;
  }): Promise<WebAuthnCredentialV1> => {
    if (!Number.isInteger(input.newCounter) || input.newCounter < 0 || input.newCounter > 4294967295) {
      throw new IdentityCustodyErrorV1('identity_material_invalid');
    }
    if (input.newCounter !== 0 && input.newCounter <= input.expectedCounter) {
      const snapshot = await this.one(decodeWebAuthnCredential, `SELECT * FROM "identity_webauthn_credentials" WHERE "proof_id" = ?`, [input.proofId]);
      if (snapshot && snapshot.userId === input.userId && snapshot.revokedAt === null && snapshot.revision === input.expectedRevision && snapshot.counter === input.expectedCounter) {
        throw new IdentityCustodyErrorV1('webauthn_counter_rejected');
      }
    }
    const updated = await this.one(
      decodeWebAuthnCredential,
      `UPDATE "identity_webauthn_credentials" SET "counter" = ?, "last_used_at" = ?, "revision" = "revision" + 1
       WHERE "proof_id" = ? AND "user_id" = ? AND "revoked_at" IS NULL AND "revision" = ? AND "counter" = ? RETURNING *`,
      [input.newCounter, input.at, input.proofId, input.userId, input.expectedRevision, input.expectedCounter],
    );
    if (updated) return updated;
    const current = await this.one(decodeWebAuthnCredential, `SELECT * FROM "identity_webauthn_credentials" WHERE "proof_id" = ?`, [input.proofId]);
    if (!current) throw new IdentityCustodyErrorV1('identity_material_missing');
    if (current.userId !== input.userId) throw new IdentityCustodyErrorV1('proof_binding_mismatch');
    if (current.revokedAt !== null) throw new IdentityCustodyErrorV1('identity_material_missing');
    throw new IdentityCustodyErrorV1('webauthn_credential_stale');
  };

  private readonly proofColumns = '"kind","proof_id","user_id","state","revision","created_at","expires_at","consumed_at","revoked_at","challenge","challenge_purpose","rp_id","allowed_origins_json","user_verification","email","secret_digest","digest_algorithm","digest_key_ref"';

  private readonly proofValues = (record: SingleUseProofV1): readonly SqliteValue[] => {
    const base = [record.kind, record.proofId, record.userId, record.state, record.revision, record.createdAt, record.expiresAt, record.consumedAt, record.revokedAt];
    if (record.kind === 'webauthn_challenge') {
      return [...base, record.challenge, record.purpose, record.rpId, JSON.stringify(record.allowedOrigins), record.userVerification, null, null, null, null];
    }
    if (record.kind === 'email_code') {
      return [...base, null, null, null, null, null, record.email, record.codeDigest.value, record.codeDigest.algorithm, record.codeDigest.algorithm === 'hmac-sha256' ? record.codeDigest.keyRef : null];
    }
    return [...base, null, null, null, null, null, record.email, record.tokenHash, 'sha256', null];
  };

  private readonly insertProof = async (record: SingleUseProofV1): Promise<void> => {
    try {
      this.connection.prepare(`INSERT INTO "identity_single_use_proofs" (${this.proofColumns}) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(...this.proofValues(record));
    } catch (error) {
      if (isUniqueViolation(error)) throw new IdentityCustodyErrorV1('identity_record_conflict');
      throw error;
    }
  };

  private readonly findProof = (key: SingleUseProofKeyV1): Promise<SingleUseProofV1 | null> =>
    this.one(decodeSingleUseProof, `SELECT ${this.proofColumns} FROM "identity_single_use_proofs" WHERE "kind" = ? AND "proof_id" = ?`, [key.kind, key.proofId]);

  private readonly findChallengeRow = (challenge: string, purpose: WebAuthnChallengeV1['purpose']): Promise<WebAuthnChallengeV1 | null> =>
    this.one(
      decodeSingleUseProof,
      `SELECT ${this.proofColumns} FROM "identity_single_use_proofs" WHERE "kind" = 'webauthn_challenge' AND "challenge" = ? AND "challenge_purpose" = ?`,
      [challenge, purpose],
    ).then((row) => (row && row.kind === 'webauthn_challenge' ? row : null));

  private readonly findLatestEmailCodeRow = async (
    email: string,
    candidates: readonly { readonly algorithm: string; readonly value: string; readonly keyRef?: string | null }[],
    now: string,
  ): Promise<EmailCodeProofV1 | null> => {
    const rows = await this.all(
      decodeSingleUseProof,
      `SELECT ${this.proofColumns} FROM "identity_single_use_proofs" WHERE "kind" = 'email_code' AND "email" = ? AND "state" = 'pending' AND "expires_at" > ? ORDER BY "created_at" DESC, "proof_id" DESC`,
      [email, now],
    );
    for (const row of rows) {
      if (row.kind !== 'email_code') continue;
      for (const candidate of candidates) {
        const keyRef = candidate.algorithm === 'hmac-sha256' ? (candidate.keyRef ?? null) : null;
        const rowKeyRef = row.codeDigest.algorithm === 'hmac-sha256' ? row.codeDigest.keyRef : null;
        if (row.codeDigest.algorithm === candidate.algorithm && rowKeyRef === keyRef && row.codeDigest.value === candidate.value) {
          return row;
        }
      }
    }
    return null;
  };

  private readonly findMagicLinkRow = (tokenHash: string): Promise<MagicLinkProofV1 | null> =>
    this.one(
      decodeSingleUseProof,
      `SELECT ${this.proofColumns} FROM "identity_single_use_proofs" WHERE "kind" = 'magic_link' AND "secret_digest" = ?`,
      [tokenHash],
    ).then((row) => (row && row.kind === 'magic_link' ? row : null));

  private readonly consumeProof = async (input: {
    readonly key: SingleUseProofKeyV1;
    readonly expectedRevision: number;
    readonly expectedUserId: string | null;
    readonly match: SingleUseProofMatchV1;
    readonly bindUserId: string | null;
    readonly at: string;
  }): Promise<SingleUseProofV1> => {
    const current = await this.findProof(input.key);
    if (!current || current.state !== 'pending') throw new IdentityCustodyErrorV1('proof_state_conflict');
    if (current.userId !== input.expectedUserId) throw new IdentityCustodyErrorV1('proof_binding_mismatch');
    if (current.revision !== input.expectedRevision) throw new IdentityCustodyErrorV1('proof_state_conflict');
    if (!(current.expiresAt > input.at)) throw new IdentityCustodyErrorV1('proof_state_conflict');
    if (input.bindUserId !== null && current.userId !== null && current.userId !== input.bindUserId) {
      throw new IdentityCustodyErrorV1('proof_binding_mismatch');
    }
    if (input.match.kind !== current.kind) throw new IdentityCustodyErrorV1('proof_binding_mismatch');
    if (input.match.kind === 'webauthn_challenge' && current.kind === 'webauthn_challenge') {
      if (input.match.challenge !== current.challenge || input.match.purpose !== current.purpose || input.match.rpId !== current.rpId) {
        throw new IdentityCustodyErrorV1('proof_binding_mismatch');
      }
    } else if (input.match.kind === 'email_code' && current.kind === 'email_code') {
      if (input.match.email !== current.email) throw new IdentityCustodyErrorV1('proof_binding_mismatch');
      const rowKeyRef = current.codeDigest.algorithm === 'hmac-sha256' ? current.codeDigest.keyRef : null;
      const matchKeyRef = input.match.digest.algorithm === 'hmac-sha256' ? input.match.digest.keyRef : null;
      if (input.match.digest.algorithm !== current.codeDigest.algorithm || matchKeyRef !== rowKeyRef || input.match.digest.value !== current.codeDigest.value) {
        throw new IdentityCustodyErrorV1('proof_binding_mismatch');
      }
    } else if (input.match.kind === 'magic_link' && current.kind === 'magic_link') {
      if (input.match.email !== current.email || input.match.tokenHash !== current.tokenHash) {
        throw new IdentityCustodyErrorV1('proof_binding_mismatch');
      }
    } else {
      throw new IdentityCustodyErrorV1('proof_binding_mismatch');
    }
    const boundUserId = input.bindUserId ?? current.userId;
    const updated = await this.one(
      decodeSingleUseProof,
      `UPDATE "identity_single_use_proofs" SET "state" = 'consumed', "consumed_at" = ?, "user_id" = ?, "revision" = "revision" + 1
       WHERE "kind" = ? AND "proof_id" = ? AND "state" = 'pending' AND "revision" = ? RETURNING ${this.proofColumns}`,
      [input.at, boundUserId, input.key.kind, input.key.proofId, input.expectedRevision],
    );
    if (!updated) throw new IdentityCustodyErrorV1('proof_state_conflict');
    return updated;
  };

  private readonly exchangeCode = async (input: {
    readonly codeProofId: string;
    readonly expectedRevision: number;
    readonly email: string;
    readonly digest: { readonly algorithm: string; readonly value: string; readonly keyRef?: string | null };
    readonly ticket: EmailRegistrationTicketV1;
    readonly at: string;
  }): Promise<EmailRegistrationTicketV1> => {
    const consumed = await this.consumeProof({
      key: { kind: 'email_code', proofId: input.codeProofId },
      expectedRevision: input.expectedRevision,
      expectedUserId: null,
      match: { kind: 'email_code', email: input.email, digest: input.digest as never },
      bindUserId: null,
      at: input.at,
    });
    if (consumed.kind !== 'email_code') throw new IdentityCustodyErrorV1('proof_binding_mismatch');
    try {
      this.connection.prepare(`INSERT INTO "identity_email_registration_tickets" ("code_kind","code_proof_id","email","token_hash","user_id","state","revision","created_at","expires_at","consumed_at","revoked_at") VALUES ('email_code',?,?,?,?,?,'pending',?,?,?,?,?)`).run(input.ticket.codeProofId, input.ticket.email, input.ticket.tokenHash, input.ticket.userId, input.ticket.revision, input.ticket.createdAt, input.ticket.expiresAt, input.ticket.consumedAt, input.ticket.revokedAt);
    } catch (error) {
      if (isUniqueViolation(error)) throw new IdentityCustodyErrorV1('identity_record_conflict');
      throw error;
    }
    const stored = await this.one(decodeEmailTicket, `SELECT * FROM "identity_email_registration_tickets" WHERE "code_proof_id" = ?`, [input.ticket.codeProofId]);
    if (!stored) throw new IdentityCustodyErrorV1('identity_material_missing');
    return stored;
  };

  private readonly consumeTicket = async (input: {
    readonly tokenHash: string;
    readonly email: string;
    readonly expectedRevision: number;
    readonly bindUserId: string;
    readonly at: string;
  }): Promise<EmailRegistrationTicketV1> => {
    const updated = await this.one(
      decodeEmailTicket,
      `UPDATE "identity_email_registration_tickets" SET "state" = 'consumed', "consumed_at" = ?, "user_id" = ?, "revision" = "revision" + 1
       WHERE "token_hash" = ? AND "email" = ? AND "state" = 'pending' AND "revision" = ? AND "expires_at" > ? RETURNING *`,
      [input.at, input.bindUserId, input.tokenHash, input.email, input.expectedRevision, input.at],
    );
    if (!updated) throw new IdentityCustodyErrorV1('proof_state_conflict');
    return updated;
  };

  private readonly consumeInvitation = async (input: {
    readonly tokenHash: string;
    readonly email: string;
    readonly clientId: string | null;
    readonly userId: string;
    readonly expectedRevision: number;
    readonly at: string;
  }): Promise<DigestInvitationV1> => {
    const updated = await this.one(
      decodeDigestInvitation,
      `UPDATE "identity_invitation_digests" SET "status" = 'consumed', "consumed_at" = ?, "consumed_by_user_id" = ?, "revision" = "revision" + 1
       WHERE "token_hash" = ? AND "email" = ? AND "status" = 'pending' AND "revision" = ? AND "expires_at" > ?
       AND ("client_id" IS NULL OR "client_id" = ?) RETURNING *`,
      [input.at, input.userId, input.tokenHash, input.email, input.expectedRevision, input.at, input.clientId],
    );
    if (!updated) throw new InvitationError('consumed');
    return updated;
  };

  private readonly baseSessionColumns = '"session_id","user_id","status","mfa_state","created_at","expires_at","revoked_at","refresh_count"';

  private readonly readBoundSession = async (where: string, values: readonly SqliteValue[]): Promise<BoundLoginSessionV1 | null> => {
    const binding = await this.one(decodeBoundSession, `SELECT * FROM "identity_login_token_bindings" WHERE ${where}`, values);
    if (!binding) return null;
    const base = await this.one(
      decodeSession,
      `SELECT ${this.baseSessionColumns} FROM "identity_login_sessions" WHERE "session_id" = ?`,
      [binding.sessionId],
    );
    if (!base) throw new IdentityCustodyErrorV1('identity_material_missing');
    return { ...binding, userId: base.userId, createdAt: base.createdAt, expiresAt: base.expiresAt, revokedAt: base.revokedAt ?? null };
  };

  private readonly insertBoundSession = async (record: BoundLoginSessionV1): Promise<void> => {
    if (record.refreshTokenHash !== null && record.refreshTokenHash === record.sessionTokenHash) {
      throw new IdentityCustodyErrorV1('identity_material_invalid');
    }
    try {
      this.connection.prepare(`INSERT INTO "identity_login_sessions" (${this.baseSessionColumns}) VALUES (?,?, 'active',?,?,?,?,?)`).run(record.sessionId, record.userId, record.login.mfaVerified ? 'step_up' : 'none', record.createdAt, record.expiresAt, record.rotationVersion);
    } catch (error) {
      if (isUniqueViolation(error)) throw new IdentityCustodyErrorV1('identity_record_conflict');
      throw error;
    }
    try {
      this.connection.prepare(`INSERT INTO "identity_login_token_bindings" ("session_id","session_token_hash","refresh_token_hash","mfa_verified","auth_time","session_version","rotation_version","device_name","ip_address","user_agent","last_activity_at") VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(record.sessionId, record.sessionTokenHash, record.refreshTokenHash, toBool(record.login.mfaVerified), record.login.authTime, record.login.sessionVersion, record.rotationVersion, record.deviceName, record.ipAddress, record.userAgent, record.lastActivityAt);
    } catch (error) {
      if (isUniqueViolation(error)) throw new IdentityCustodyErrorV1('identity_record_conflict');
      throw error;
    }
  };

  private readonly findBoundSession = (sessionId: string): Promise<BoundLoginSessionV1 | null> =>
    this.readBoundSession('"session_id" = ?', [sessionId]);

  private readonly findBoundSessionByHash = (column: 'session_token_hash' | 'refresh_token_hash', hash: string): Promise<BoundLoginSessionV1 | null> =>
    this.readBoundSession(`"${column}" = ?`, [hash]);

  private readonly listBoundSessions = async (userId: string): Promise<readonly BoundLoginSessionV1[]> => {
    const ids = this.connection.prepare(`SELECT "session_id" FROM "identity_login_sessions" WHERE "user_id" = ? ORDER BY "created_at", "session_id"`).all(userId) as readonly Record<string, unknown>[];
    const out: BoundLoginSessionV1[] = [];
    for (const row of ids) {
      const found = await this.findBoundSession(String(row['session_id']));
      if (found) out.push(found);
    }
    return out;
  };

  private readonly rotateBoundSession = async (input: {
    readonly sessionId: string;
    readonly userId: string;
    readonly expectedRefreshTokenHash: string;
    readonly expectedRotationVersion: number;
    readonly verifiedLogin: BoundLoginSessionV1['login'];
    readonly nextSessionTokenHash: string;
    readonly nextRefreshTokenHash: string;
    readonly nextExpiresAt: string;
    readonly at: string;
  }): Promise<BoundLoginSessionV1> => {
    if (input.nextRefreshTokenHash === input.nextSessionTokenHash) {
      throw new IdentityCustodyErrorV1('identity_material_invalid');
    }
    if (!(input.nextExpiresAt > input.at)) throw new IdentityCustodyErrorV1('identity_material_invalid');
    if (input.expectedRotationVersion < 0 || !Number.isSafeInteger(input.expectedRotationVersion)) {
      throw new IdentityCustodyErrorV1('identity_material_invalid');
    }
    const current = await this.findBoundSession(input.sessionId);
    if (!current || current.userId !== input.userId) throw new IdentityCustodyErrorV1('login_binding_mismatch');
    if (current.refreshTokenHash === null || current.refreshTokenHash !== input.expectedRefreshTokenHash) {
      throw new IdentityCustodyErrorV1('login_refresh_conflict');
    }
    if (current.rotationVersion !== input.expectedRotationVersion) throw new IdentityCustodyErrorV1('login_refresh_conflict');
    if (current.revokedAt !== null) throw new IdentityCustodyErrorV1('login_binding_mismatch');
    if (!(current.expiresAt > input.at)) throw new IdentityCustodyErrorV1('login_binding_mismatch');
    if (current.login.mfaVerified !== input.verifiedLogin.mfaVerified || current.login.authTime !== input.verifiedLogin.authTime || current.login.sessionVersion !== input.verifiedLogin.sessionVersion) {
      throw new IdentityCustodyErrorV1('login_binding_mismatch');
    }
    const updated = await this.one(
      decodeBoundSession,
      `UPDATE "identity_login_token_bindings" SET "session_token_hash" = ?, "refresh_token_hash" = ?, "rotation_version" = "rotation_version" + 1, "last_activity_at" = ?
       WHERE "session_id" = ? AND "refresh_token_hash" = ? AND "rotation_version" = ?
       AND "mfa_verified" = ? AND "auth_time" = ? AND "session_version" = ? RETURNING *`,
      [input.nextSessionTokenHash, input.nextRefreshTokenHash, input.at, input.sessionId, input.expectedRefreshTokenHash, input.expectedRotationVersion, toBool(input.verifiedLogin.mfaVerified), input.verifiedLogin.authTime, input.verifiedLogin.sessionVersion],
    );
    if (!updated) throw new IdentityCustodyErrorV1('login_refresh_conflict');
    this.changes(`UPDATE "identity_login_sessions" SET "expires_at" = ?, "refresh_count" = "refresh_count" + 1 WHERE "session_id" = ? AND "status" = 'active'`, [input.nextExpiresAt, input.sessionId]);
    const reread = await this.findBoundSession(input.sessionId);
    if (!reread) throw new IdentityCustodyErrorV1('identity_material_missing');
    return reread;
  };

  private readonly revokeBoundSession = async (sessionId: string, at: string): Promise<void> => {
    this.changes(`UPDATE "identity_login_sessions" SET "status" = 'revoked', "revoked_at" = ? WHERE "session_id" = ?`, [at, sessionId]);
  };
}

export interface SqliteCustodyBindingV1<H> {
  readonly transactionId: string;
  readonly hostTransaction: H;
  readonly connection: SqliteConnection;
  readonly readOnly: boolean;
}

export interface SqliteIdentityHostV1<H> {
  runExclusiveTransaction<T>(
    options: { readonly readOnly: boolean; readonly deadlineMs: number },
    operation: (binding: SqliteCustodyBindingV1<H>) => Promise<T>,
  ): Promise<T>;
}

let sqliteCustodyTxCounter = 0;

const nextSqliteCustodyTxId = (): string => {
  sqliteCustodyTxCounter += 1;
  return `custody-sqlite-${Date.now().toString(36)}-${sqliteCustodyTxCounter}`;
};

const requireSqliteRunOptions = (options: IdentityRunOptionsV1, readOnly: boolean): void => {
  if (readOnly) {
    if (options.mode !== 'read') throw new IdentityCustodyErrorV1('identity_transaction_unbound');
  } else if (options.mode !== 'write' && options.mode !== 'import' && options.mode !== 'delete') {
    throw new IdentityCustodyErrorV1('identity_transaction_unbound');
  }
  if (!Number.isInteger(options.deadlineMs) || options.deadlineMs <= 0) {
    throw new IdentityCustodyErrorV1('identity_material_invalid');
  }
};

/**
 * Combined custody handle: the transaction-scoped stores plus the deletion
 * journal/outbox over the same connection. One object joins every callback.
 */
export class SqliteCustodyHandle extends SqliteCustodyTx {
  readonly journal: SqliteCustodyJournal;
  constructor(connection: SqliteConnection) {
    super(connection);
    this.journal = new SqliteCustodyJournal(connection);
  }
  get stores(): IdentityCustodyStoresV1 {
    return this;
  }
  get profile(): 'sqlite' {
    return 'sqlite';
  }
  get raw(): SqliteConnection {
    return this.connection;
  }
}

/** Host-owned exclusive unit of work over one SQLite connection. */
export const createSqliteIdentityUnitOfWorkV1 = (input: {
  readonly host: SqliteIdentityHostV1<SqliteCustodyHandle>;
  readonly maxAttempts?: number;
}): IdentityUnitOfWorkV1<SqliteCustodyHandle> => {
  const maxAttempts = input.maxAttempts ?? 3;
  const run = async <T>(
    options: IdentityRunOptionsV1,
    operation: (tx: IdentityTransactionV1<SqliteCustodyHandle>) => Promise<T>,
    readOnly: boolean,
  ): Promise<T> => {
    requireSqliteRunOptions(options, readOnly);
    let attempt = 0;
    for (;;) {
      attempt += 1;
      try {
        return await input.host.runExclusiveTransaction({ readOnly, deadlineMs: options.deadlineMs }, async (binding) => {
          if (binding.readOnly !== readOnly) throw new IdentityCustodyErrorV1('identity_transaction_unbound');
          const handle = new SqliteCustodyHandle(binding.connection);
          return operation({ profile: 'sqlite', transactionId: binding.transactionId, readOnly, hostTransaction: handle, stores: handle });
        });
      } catch (error) {
        if (attempt < maxAttempts && isSocialRaceRetry(error)) continue;
        throw error;
      }
    }
  };
  return {
    profile: 'sqlite',
    runRead: (options, operation) => run(options, operation, true),
    runWrite: (options, operation) => run(options, operation, false),
  };
};

export const createSqliteIdentityHostV1 = (options: {
  readonly connection: SqliteConnection;
  readonly applySchema?: boolean;
}): SqliteIdentityHostV1<SqliteCustodyHandle> => ({
  runExclusiveTransaction: async (runOptions, operation) => {
    if (options.applySchema !== false) {
      for (const ddl of identitySchemaStatements('sqlite', '')) options.connection.exec(ddl);
    }
    if (!runOptions.readOnly) options.connection.exec('BEGIN IMMEDIATE');
    try {
      const result = await operation({
        transactionId: nextSqliteCustodyTxId(),
        hostTransaction: new SqliteCustodyHandle(options.connection),
        connection: options.connection,
        readOnly: runOptions.readOnly,
      });
      if (!runOptions.readOnly) options.connection.exec('COMMIT');
      return result;
    } catch (error) {
      if (!runOptions.readOnly) {
        try {
          options.connection.exec('ROLLBACK');
        } catch {
          // Already rolled back by the engine; surface the original failure.
        }
      }
      throw error;
    }
  },
});

/** Standalone per-method custody stores for direct store tests. */
export const createSqliteCustodyStores = (options: { readonly connection: SqliteConnection }): IdentityCustodyStoresV1 => {
  const tx = new SqliteCustodyTx(options.connection);
  for (const ddl of identitySchemaStatements('sqlite', '')) options.connection.exec(ddl);
  return tx;
};

/** Applies the custody asset on the caller's active binding; never begins or commits. */
export const applySqliteIdentityCustodySchemaV1 = async (input: {
  readonly binding: SqliteCustodyBindingV1<unknown>;
  readonly expectedAssetSha256: string;
  readonly appliedAt: string;
}): Promise<IdentityCustodySchemaReceiptV1> => {
  const asset = identityCustodySchemaAssetV1('sqlite');
  if (asset.assetSha256 !== input.expectedAssetSha256) throw new IdentityCustodyErrorV1('identity_contract_unavailable');
  for (const ddl of identitySchemaStatements('sqlite', '')) input.binding.connection.exec(ddl);
  const existing = input.binding.connection.prepare(`SELECT * FROM "identity_custody_schema_versions" WHERE "migration_id" = 'A2.0b/1'`).get() as Record<string, unknown> | undefined;
  if (existing) {
    if (existing['asset_sha256'] !== asset.assetSha256 || existing['contract_version'] !== '1.1.0') {
      throw new IdentityCustodyErrorV1('identity_contract_unavailable');
    }
    return { migrationId: 'A2.0b/1', contractVersion: '1.1.0', profile: 'sqlite', assetSha256: asset.assetSha256, appliedAt: String(existing['applied_at']) };
  }
  input.binding.connection.prepare(`INSERT INTO "identity_custody_schema_versions" ("migration_id","contract_version","asset_sha256","applied_at") VALUES ('A2.0b/1','1.1.0',?,?)`).run(asset.assetSha256, input.appliedAt);
  return { migrationId: 'A2.0b/1', contractVersion: '1.1.0', profile: 'sqlite', assetSha256: asset.assetSha256, appliedAt: input.appliedAt };
};

export const bindSqliteIdentityTransactionV1 = <H>(input: {
  readonly binding: SqliteCustodyBindingV1<H>;
  readonly hostTransaction: H;
}): IdentityTransactionV1<H> => ({
  profile: 'sqlite',
  transactionId: input.binding.transactionId,
  readOnly: input.binding.readOnly,
  hostTransaction: input.hostTransaction,
  stores: new SqliteCustodyTx(input.binding.connection),
});

/** V1 factory name for the standalone SQLite custody stores. */
export const createSqliteIdentityCustodyStoresV1 = createSqliteCustodyStores;
