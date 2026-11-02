// A2.0b custody stores on the PostgreSQL profile. Every method below runs on
// a caller-supplied PgSession and never begins, commits or migrates on its
// own: the host unit of work owns the transaction. Standalone per-method
// wrappers are provided for direct store tests.

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
import type { InjectedPgDriver, PgSession, SqlValue } from '../postgres/protocol.js';
import { decodeSession } from './records.js';
import { InvitationError } from '../../identity-contracts/errors.js';
import { IDENTITY_TABLES, identitySchemaStatements, identityTable, type IdentityTableName } from './schema.js';
import {
  identityCustodySchemaAssetV1,
  isSocialRaceRetry,
  type IdentityCustodySchemaAssetV1,
  type IdentityCustodySchemaReceiptV1,
} from './custody-shared.js';
import { PostgresCustodyJournal } from './custody-journal-postgres.js';
import {
  decodeAccountProfile,
  decodeBoundSession,
  decodeDigestInvitation,
  decodeEmailTicket,
  decodeSingleUseProof,
  decodeSocialLink,
  decodeWebAuthnCredential,
} from './custody-records.js';

export const CUSTODY_TX_DEADLINE_MS = 5000;

export interface PostgresCustodyOptions {
  readonly driver: InjectedPgDriver;
  readonly schema: string;
  readonly deadlineMs?: number;
}

export const custodyTable = (schema: string, table: IdentityTableName): string =>
  identityTable('postgres', schema, table);

const SERIALIZATION_CODES = new Set(['40001', '40P01']);

const isSerializationFailure = (error: unknown): boolean => {
  const fields = (error ?? {}) as { readonly code?: unknown; readonly sqlState?: unknown };
  return SERIALIZATION_CODES.has(String(fields.code ?? fields.sqlState ?? ''));
};

const isUniqueViolation = (error: unknown): boolean => {
  const fields = (error ?? {}) as { readonly code?: unknown };
  return String(fields.code ?? '') === '23505';
};

export const requireWriteOptions = (options: IdentityRunOptionsV1): void => {
  if (options.mode !== 'write' && options.mode !== 'import' && options.mode !== 'delete') {
    throw new IdentityCustodyErrorV1('identity_transaction_unbound');
  }
  if (!Number.isInteger(options.deadlineMs) || options.deadlineMs <= 0) {
    throw new IdentityCustodyErrorV1('identity_material_invalid');
  }
};

const toBool = (value: boolean): number => (value ? 1 : 0);

/** Transaction-scoped custody bundle: all SQL runs on the bound session. */
export class PostgresCustodyTx implements IdentityCustodyStoresV1 {
  readonly profiles: IdentityAccountProfileStoreV1;
  readonly credentials: WebAuthnCredentialStoreV1;
  readonly singleUseProofs: SingleUseProofStoreV1;
  readonly emailTickets: EmailRegistrationTicketStoreV1;
  readonly invitations: DigestInvitationStoreV1;
  readonly sessions: BoundLoginSessionStoreV1;
  readonly social: SocialIdentityStoreV1;

  constructor(
    readonly schema: string,
    readonly session: PgSession,
  ) {
    this.profiles = {
      find: (userId) =>
        this.one(decodeAccountProfile, `SELECT * FROM ${this.t('identity_account_profiles')} WHERE "user_id" = $1`, [userId]),
      put: async (record) => {
        await session.execute({
          text: `INSERT INTO ${this.t('identity_account_profiles')} ("user_id","email_verified","display_name","approval_due_at","approved_at","approved_by_user_id","disabled_at","disabled_reason","legacy_account_status") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
                 ON CONFLICT ("user_id") DO UPDATE SET "email_verified" = EXCLUDED."email_verified", "display_name" = EXCLUDED."display_name", "approval_due_at" = EXCLUDED."approval_due_at", "approved_at" = EXCLUDED."approved_at", "approved_by_user_id" = EXCLUDED."approved_by_user_id", "disabled_at" = EXCLUDED."disabled_at", "disabled_reason" = EXCLUDED."disabled_reason", "legacy_account_status" = EXCLUDED."legacy_account_status"`,
          values: [record.userId, toBool(record.emailVerified), record.displayName, record.approvalDueAt, record.approvedAt, record.approvedByUserId, record.disabledAt, record.disabledReason, record.legacyAccountStatus],
        });
      },
    };

    this.credentials = {
      insert: async (record) => {
        try {
          await session.execute({
            text: `INSERT INTO ${this.t('identity_webauthn_credentials')} ("proof_id","user_id","credential_id","public_key_cose","counter","revision","rp_id","device_name","transports_json","uv","device_type","backed_up","created_at","last_used_at","revoked_at") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
            values: [record.proofId, record.userId, record.credentialId, record.publicKeyCose, record.counter, record.revision, record.rpId, record.deviceName, record.transports === null ? null : JSON.stringify(record.transports), toBool(record.uv), record.deviceType, record.backedUp === null ? null : toBool(record.backedUp), record.createdAt, record.lastUsedAt, record.revokedAt],
          });
        } catch (error) {
          if (isUniqueViolation(error)) throw new IdentityCustodyErrorV1('webauthn_credential_conflict');
          throw error;
        }
      },
      findById: (proofId) =>
        this.one(decodeWebAuthnCredential, `SELECT * FROM ${this.t('identity_webauthn_credentials')} WHERE "proof_id" = $1`, [proofId]),
      findByCredentialId: (credentialId) =>
        this.one(decodeWebAuthnCredential, `SELECT * FROM ${this.t('identity_webauthn_credentials')} WHERE "credential_id" = $1`, [credentialId]),
      listForUser: (userId) =>
        this.all(decodeWebAuthnCredential, `SELECT * FROM ${this.t('identity_webauthn_credentials')} WHERE "user_id" = $1 ORDER BY "created_at", "proof_id"`, [userId]),
      compareAndSwapCounter: (input) => this.casCounter(input),
      rename: async (proofId, userId, deviceName) => {
        const result = await session.execute({
          text: `UPDATE ${this.t('identity_webauthn_credentials')} SET "device_name" = $3, "revision" = "revision" + 1 WHERE "proof_id" = $1 AND "user_id" = $2 AND "revoked_at" IS NULL`,
          values: [proofId, userId, deviceName],
        });
        if ((result.rowCount ?? 0) === 0) throw new IdentityCustodyErrorV1('identity_material_invalid');
      },
      revoke: async (proofId, userId, at) => {
        const current = await this.one(decodeWebAuthnCredential, `SELECT * FROM ${this.t('identity_webauthn_credentials')} WHERE "proof_id" = $1`, [proofId]);
        if (!current || current.userId !== userId) throw new IdentityCustodyErrorV1('identity_material_missing');
        if (current.revokedAt !== null) return;
        await session.execute({
          text: `UPDATE ${this.t('identity_webauthn_credentials')} SET "revoked_at" = $3, "revision" = "revision" + 1 WHERE "proof_id" = $1 AND "user_id" = $2`,
          values: [proofId, userId, at],
        });
      },
    };

    this.singleUseProofs = {
      insert: (record) => this.insertProof(record),
      find: (key) => this.findProof(key),
      findChallenge: (challenge, purpose) => this.findChallengeRow(challenge, purpose),
      findLatestEmailCode: (email, candidates, now) => this.findLatestEmailCodeRow(email, candidates, now),
      findMagicLink: (tokenHash) => this.findMagicLinkRow(tokenHash),
      countEmailCodes: async (email, since) => {
        const rows = (await session.execute({
          text: `SELECT COUNT(*) AS "count" FROM ${this.t('identity_single_use_proofs')} WHERE "kind" = 'email_code' AND "email" = $1 AND "created_at" >= $2`,
          values: [email, since],
        })).rows;
        const value = rows[0]?.['count'];
        return typeof value === 'number' ? value : Number(value ?? 0);
      },
      consume: (input) => this.consumeProof(input),
      revoke: async (key, expectedRevision, at) => {
        const result = await session.execute({
          text: `UPDATE ${this.t('identity_single_use_proofs')} SET "state" = 'revoked', "revoked_at" = $4, "revision" = "revision" + 1 WHERE "kind" = $1 AND "proof_id" = $2 AND "state" = 'pending' AND "revision" = $3`,
          values: [key.kind, key.proofId, expectedRevision, at],
        });
        if ((result.rowCount ?? 0) === 0) throw new IdentityCustodyErrorV1('proof_state_conflict');
      },
      purgeExpired: async (now) => {
        const result = await session.execute({
          text: `DELETE FROM ${this.t('identity_single_use_proofs')} WHERE "expires_at" < $1 AND "state" != 'pending'`,
          values: [now],
        });
        return result.rowCount ?? 0;
      },
    };

    this.emailTickets = {
      findByTokenHash: (tokenHash) =>
        this.one(decodeEmailTicket, `SELECT * FROM ${this.t('identity_email_registration_tickets')} WHERE "token_hash" = $1`, [tokenHash]),
      importTicket: async (record) => {
        try {
          await session.execute({
            text: `INSERT INTO ${this.t('identity_email_registration_tickets')} ("code_kind","code_proof_id","email","token_hash","user_id","state","revision","created_at","expires_at","consumed_at","revoked_at") VALUES ('email_code',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
            values: [record.codeProofId, record.email, record.tokenHash, record.userId, record.state, record.revision, record.createdAt, record.expiresAt, record.consumedAt, record.revokedAt],
          });
        } catch (error) {
          if (isUniqueViolation(error)) throw new IdentityCustodyErrorV1('identity_record_conflict');
          throw error;
        }
      },
      exchangeCode: (input) => this.exchangeCode(input),
      consume: (input) => this.consumeTicket(input),
      revoke: async (codeProofId, expectedRevision, at) => {
        const result = await session.execute({
          text: `UPDATE ${this.t('identity_email_registration_tickets')} SET "state" = 'revoked', "revoked_at" = $3, "revision" = "revision" + 1 WHERE "code_proof_id" = $1 AND "state" = 'pending' AND "revision" = $2`,
          values: [codeProofId, expectedRevision, at],
        });
        if ((result.rowCount ?? 0) === 0) throw new IdentityCustodyErrorV1('proof_state_conflict');
      },
    };

    this.invitations = {
      insert: async (record) => {
        try {
          await session.execute({
            text: `INSERT INTO ${this.t('identity_invitation_digests')} ("invitation_id","email","tenant_id","workspace_id","client_id","token_hash","status","expires_at","created_at","consumed_at","consumed_by_user_id","revision") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
            values: [record.invitationId, record.email, record.tenantId, record.workspaceId, record.clientId, record.tokenHash, record.status, record.expiresAt, record.createdAt, record.consumedAt, record.consumedByUserId, record.revision],
          });
        } catch (error) {
          if (isUniqueViolation(error)) throw new IdentityCustodyErrorV1('identity_record_conflict');
          throw error;
        }
      },
      findById: (invitationId) =>
        this.one(decodeDigestInvitation, `SELECT * FROM ${this.t('identity_invitation_digests')} WHERE "invitation_id" = $1`, [invitationId]),
      findByDigest: (tokenHash) =>
        this.one(decodeDigestInvitation, `SELECT * FROM ${this.t('identity_invitation_digests')} WHERE "token_hash" = $1`, [tokenHash]),
      consumeByDigest: (input) => this.consumeInvitation(input),
      revoke: async (invitationId, expectedRevision, at) => {
        const result = await session.execute({
          text: `UPDATE ${this.t('identity_invitation_digests')} SET "status" = 'revoked', "revision" = "revision" + 1 WHERE "invitation_id" = $1 AND "status" = 'pending' AND "revision" = $2`,
          values: [invitationId, expectedRevision, at],
        });
        if ((result.rowCount ?? 0) === 0) throw new IdentityCustodyErrorV1('proof_state_conflict');
      },
    };

    this.sessions = {
      insert: (record) => this.insertBoundSession(record),
      findById: (sessionId) => this.findBoundSession(sessionId),
      findBySessionTokenHash: (hash) => this.findBoundSessionByHash('session_token_hash', hash),
      findByRefreshTokenHash: (hash) => this.findBoundSessionByHash('refresh_token_hash', hash),
      rotate: (input) => this.rotateBoundSession(input),
      touchActivity: async (sessionId, at) => {
        await session.execute({
          text: `UPDATE ${this.t('identity_login_token_bindings')} SET "last_activity_at" = $2 WHERE "session_id" = $1`,
          values: [sessionId, at],
        });
      },
      revoke: (sessionId, at) => this.revokeBoundSession(sessionId, at),
      revokeAllForUser: async (userId, at) => {
        const rows = (await session.execute({
          text: `SELECT "session_id" FROM ${this.t('identity_login_sessions')} WHERE "user_id" = $1 AND "status" = 'active'`,
          values: [userId],
        })).rows;
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
          await session.execute({
            text: `INSERT INTO ${this.t('identity_social_links')} ("proof_id","user_id","provider","provider_subject","provider_tenant","email_at_link","email_verified_by_provider","linked_at","last_login_at","revoked_at","revision") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
            values: [record.proofId, record.userId, record.provider, record.providerSubject, record.providerTenant, record.emailAtLink, toBool(record.emailVerifiedByProvider), record.linkedAt, record.lastLoginAt, record.revokedAt, record.revision],
          });
        } catch (error) {
          if (isUniqueViolation(error)) throw new IdentityCustodyErrorV1('social_subject_conflict');
          throw error;
        }
      },
      findById: (proofId) =>
        this.one(decodeSocialLink, `SELECT * FROM ${this.t('identity_social_links')} WHERE "proof_id" = $1`, [proofId]),
      findBySubject: (provider, providerSubject) =>
        this.one(decodeSocialLink, `SELECT * FROM ${this.t('identity_social_links')} WHERE "provider" = $1 AND "provider_subject" = $2`, [provider, providerSubject]),
      listForUser: (userId) =>
        this.all(decodeSocialLink, `SELECT * FROM ${this.t('identity_social_links')} WHERE "user_id" = $1 ORDER BY "linked_at", "proof_id"`, [userId]),
      touchLogin: async (proofId, expectedRevision, at) => {
        const result = await session.execute({
          text: `UPDATE ${this.t('identity_social_links')} SET "last_login_at" = $3, "revision" = "revision" + 1 WHERE "proof_id" = $1 AND "revoked_at" IS NULL AND "revision" = $2`,
          values: [proofId, expectedRevision, at],
        });
        if ((result.rowCount ?? 0) === 0) throw new IdentityCustodyErrorV1('proof_state_conflict');
      },
      unlink: async (proofId, userId, expectedRevision, at) => {
        void at;
        const result = await session.execute({
          text: `DELETE FROM ${this.t('identity_social_links')} WHERE "proof_id" = $1 AND "user_id" = $2 AND "revision" = $3`,
          values: [proofId, userId, expectedRevision],
        });
        if ((result.rowCount ?? 0) === 0) throw new IdentityCustodyErrorV1('proof_state_conflict');
      },
    };
  }

  readonly t = (table: IdentityTableName): string => custodyTable(this.schema, table);

  private readonly one = async <T>(
    decode: (row: Record<string, unknown>) => T,
    text: string,
    values: readonly SqlValue[],
  ): Promise<T | null> => {
    const result = await this.session.execute({ text, values });
    return result.rows.length > 0 ? decode(result.rows[0]) : null;
  };

  private readonly all = async <T>(
    decode: (row: Record<string, unknown>) => T,
    text: string,
    values: readonly SqlValue[],
  ): Promise<readonly T[]> => (await this.session.execute({ text, values })).rows.map(decode);

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
      const snapshot = await this.one(decodeWebAuthnCredential, `SELECT * FROM ${this.t('identity_webauthn_credentials')} WHERE "proof_id" = $1`, [input.proofId]);
      if (snapshot && snapshot.userId === input.userId && snapshot.revokedAt === null && snapshot.revision === input.expectedRevision && snapshot.counter === input.expectedCounter) {
        throw new IdentityCustodyErrorV1('webauthn_counter_rejected');
      }
    }
    const updated = await this.one(
      decodeWebAuthnCredential,
      `UPDATE ${this.t('identity_webauthn_credentials')} SET "counter" = $5, "last_used_at" = $6, "revision" = "revision" + 1
       WHERE "proof_id" = $1 AND "user_id" = $2 AND "revoked_at" IS NULL AND "revision" = $3 AND "counter" = $4 RETURNING *`,
      [input.proofId, input.userId, input.expectedRevision, input.expectedCounter, input.newCounter, input.at],
    );
    if (updated) return updated;
    const current = await this.one(decodeWebAuthnCredential, `SELECT * FROM ${this.t('identity_webauthn_credentials')} WHERE "proof_id" = $1`, [input.proofId]);
    if (!current) throw new IdentityCustodyErrorV1('identity_material_missing');
    if (current.userId !== input.userId) throw new IdentityCustodyErrorV1('proof_binding_mismatch');
    if (current.revokedAt !== null) throw new IdentityCustodyErrorV1('identity_material_missing');
    throw new IdentityCustodyErrorV1('webauthn_credential_stale');
  };

  private readonly proofColumns = '"kind","proof_id","user_id","state","revision","created_at","expires_at","consumed_at","revoked_at","challenge","challenge_purpose","rp_id","allowed_origins_json","user_verification","email","secret_digest","digest_algorithm","digest_key_ref"';

  private readonly proofValues = (record: SingleUseProofV1): readonly SqlValue[] => {
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
      await this.session.execute({
        text: `INSERT INTO ${this.t('identity_single_use_proofs')} (${this.proofColumns}) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
        values: this.proofValues(record),
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new IdentityCustodyErrorV1('identity_record_conflict');
      throw error;
    }
  };

  private readonly findProof = (key: SingleUseProofKeyV1): Promise<SingleUseProofV1 | null> =>
    this.one(decodeSingleUseProof, `SELECT ${this.proofColumns} FROM ${this.t('identity_single_use_proofs')} WHERE "kind" = $1 AND "proof_id" = $2`, [key.kind, key.proofId]);

  private readonly findChallengeRow = (challenge: string, purpose: WebAuthnChallengeV1['purpose']): Promise<WebAuthnChallengeV1 | null> =>
    this.one(
      decodeSingleUseProof,
      `SELECT ${this.proofColumns} FROM ${this.t('identity_single_use_proofs')} WHERE "kind" = 'webauthn_challenge' AND "challenge" = $1 AND "challenge_purpose" = $2`,
      [challenge, purpose],
    ).then((row) => (row && row.kind === 'webauthn_challenge' ? row : null));

  private readonly findLatestEmailCodeRow = async (
    email: string,
    candidates: readonly { readonly algorithm: string; readonly value: string; readonly keyRef?: string | null }[],
    now: string,
  ): Promise<EmailCodeProofV1 | null> => {
    const rows = await this.all(
      decodeSingleUseProof,
      `SELECT ${this.proofColumns} FROM ${this.t('identity_single_use_proofs')} WHERE "kind" = 'email_code' AND "email" = $1 AND "state" = 'pending' AND "expires_at" > $2 ORDER BY "created_at" DESC, "proof_id" DESC`,
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
      `SELECT ${this.proofColumns} FROM ${this.t('identity_single_use_proofs')} WHERE "kind" = 'magic_link' AND "secret_digest" = $1`,
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
    if (!(input.at > '')) throw new IdentityCustodyErrorV1('identity_material_invalid');
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
      `UPDATE ${this.t('identity_single_use_proofs')} SET "state" = 'consumed', "consumed_at" = $4, "user_id" = $5, "revision" = "revision" + 1
       WHERE "kind" = $1 AND "proof_id" = $2 AND "state" = 'pending' AND "revision" = $3 RETURNING ${this.proofColumns}`,
      [input.key.kind, input.key.proofId, input.expectedRevision, input.at, boundUserId],
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
      await this.session.execute({
        text: `INSERT INTO ${this.t('identity_email_registration_tickets')} ("code_kind","code_proof_id","email","token_hash","user_id","state","revision","created_at","expires_at","consumed_at","revoked_at") VALUES ('email_code',$1,$2,$3,$4,'pending',$5,$6,$7,$8,$9)`,
        values: [input.ticket.codeProofId, input.ticket.email, input.ticket.tokenHash, input.ticket.userId, input.ticket.revision, input.ticket.createdAt, input.ticket.expiresAt, input.ticket.consumedAt, input.ticket.revokedAt],
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new IdentityCustodyErrorV1('identity_record_conflict');
      throw error;
    }
    const stored = await this.one(decodeEmailTicket, `SELECT * FROM ${this.t('identity_email_registration_tickets')} WHERE "code_proof_id" = $1`, [input.ticket.codeProofId]);
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
      `UPDATE ${this.t('identity_email_registration_tickets')} SET "state" = 'consumed', "consumed_at" = $5, "user_id" = $4, "revision" = "revision" + 1
       WHERE "token_hash" = $1 AND "email" = $2 AND "state" = 'pending' AND "revision" = $3 AND "expires_at" > $6 RETURNING *`,
      [input.tokenHash, input.email, input.expectedRevision, input.bindUserId, input.at, input.at],
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
      `UPDATE ${this.t('identity_invitation_digests')} SET "status" = 'consumed', "consumed_at" = $6, "consumed_by_user_id" = $5, "revision" = "revision" + 1
       WHERE "token_hash" = $1 AND "email" = $2 AND "status" = 'pending' AND "revision" = $3 AND "expires_at" > $6
       AND ("client_id" IS NULL OR "client_id" = $4) RETURNING *`,
      [input.tokenHash, input.email, input.expectedRevision, input.clientId, input.userId, input.at],
    );
    if (!updated) throw new InvitationError('consumed');
    return updated;
  };

  private readonly baseSessionColumns = '"session_id","user_id","status","mfa_state","created_at","expires_at","revoked_at","refresh_count"';

  private readonly readBoundSession = async (where: string, values: readonly SqlValue[]): Promise<BoundLoginSessionV1 | null> => {
    const binding = await this.one(decodeBoundSession, `SELECT * FROM ${this.t('identity_login_token_bindings')} WHERE ${where}`, values);
    if (!binding) return null;
    const base = await this.one(
      decodeSession,
      `SELECT ${this.baseSessionColumns} FROM ${this.t('identity_login_sessions')} WHERE "session_id" = $1`,
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
      await this.session.execute({
        text: `INSERT INTO ${this.t('identity_login_sessions')} (${this.baseSessionColumns}) VALUES ($1,$2,'active',$3,$4,$5,NULL,$6)`,
        values: [record.sessionId, record.userId, record.login.mfaVerified ? 'step_up' : 'none', record.createdAt, record.expiresAt, record.rotationVersion],
      });
      await this.session.execute({
        text: `INSERT INTO ${this.t('identity_login_token_bindings')} ("session_id","session_token_hash","refresh_token_hash","mfa_verified","auth_time","session_version","rotation_version","device_name","ip_address","user_agent","last_activity_at") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        values: [record.sessionId, record.sessionTokenHash, record.refreshTokenHash, toBool(record.login.mfaVerified), record.login.authTime, record.login.sessionVersion, record.rotationVersion, record.deviceName, record.ipAddress, record.userAgent, record.lastActivityAt],
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new IdentityCustodyErrorV1('identity_record_conflict');
      throw error;
    }
  };

  private readonly findBoundSession = (sessionId: string): Promise<BoundLoginSessionV1 | null> =>
    this.readBoundSession('"session_id" = $1', [sessionId]);

  private readonly findBoundSessionByHash = (column: 'session_token_hash' | 'refresh_token_hash', hash: string): Promise<BoundLoginSessionV1 | null> =>
    this.readBoundSession(`"${column}" = $1`, [hash]);

  private readonly listBoundSessions = async (userId: string): Promise<readonly BoundLoginSessionV1[]> => {
    const ids = (await this.session.execute({
      text: `SELECT "session_id" FROM ${this.t('identity_login_sessions')} WHERE "user_id" = $1 ORDER BY "created_at", "session_id"`,
      values: [userId],
    })).rows;
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
      `UPDATE ${this.t('identity_login_token_bindings')} SET "session_token_hash" = $5, "refresh_token_hash" = $6, "rotation_version" = "rotation_version" + 1, "last_activity_at" = $7
       WHERE "session_id" = $1 AND "refresh_token_hash" = $2 AND "rotation_version" = $3
       AND "mfa_verified" = $4 AND "auth_time" = $8 AND "session_version" = $9 RETURNING *`,
      [input.sessionId, input.expectedRefreshTokenHash, input.expectedRotationVersion, toBool(input.verifiedLogin.mfaVerified), input.nextSessionTokenHash, input.nextRefreshTokenHash, input.at, input.verifiedLogin.authTime, input.verifiedLogin.sessionVersion],
    );
    if (!updated) throw new IdentityCustodyErrorV1('login_refresh_conflict');
    await this.session.execute({
      text: `UPDATE ${this.t('identity_login_sessions')} SET "expires_at" = $2, "refresh_count" = "refresh_count" + 1 WHERE "session_id" = $1 AND "status" = 'active'`,
      values: [input.sessionId, input.nextExpiresAt],
    });
    const reread = await this.findBoundSession(input.sessionId);
    if (!reread) throw new IdentityCustodyErrorV1('identity_material_missing');
    return reread;
  };

  private readonly revokeBoundSession = async (sessionId: string, at: string): Promise<void> => {
    await this.session.execute({
      text: `UPDATE ${this.t('identity_login_sessions')} SET "status" = 'revoked', "revoked_at" = $2 WHERE "session_id" = $1`,
      values: [sessionId, at],
    });
  };
}

export interface PostgresCustodyBindingV1<H> {
  readonly transactionId: string;
  readonly hostTransaction: H;
  readonly session: PgSession;
  readonly readOnly: boolean;
}

export interface PostgresIdentityHostV1<H> {
  runSerializable<T>(
    options: { readonly readOnly: boolean; readonly deadlineMs: number },
    operation: (binding: PostgresCustodyBindingV1<H>) => Promise<T>,
  ): Promise<T>;
}

let custodyTxCounter = 0;

const nextCustodyTxId = (): string => {
  custodyTxCounter += 1;
  return `custody-pg-${Date.now().toString(36)}-${custodyTxCounter}`;
};

/**
 * Combined custody handle: the transaction-scoped stores plus the deletion
 * journal/outbox over the same session. One object joins every callback.
 */
export class PostgresCustodyHandle extends PostgresCustodyTx {
  readonly journal: PostgresCustodyJournal;
  constructor(schema: string, session: PgSession) {
    super(schema, session);
    this.journal = new PostgresCustodyJournal(schema, session);
  }
  get stores(): IdentityCustodyStoresV1 {
    return this;
  }
  get profile(): 'postgres' {
    return 'postgres';
  }
  get raw(): PgSession {
    return this.session;
  }
}

/** Host-owned serializable unit of work over one control schema. */
export const createPostgresIdentityUnitOfWorkV1 = (input: {
  readonly schema: string;
  readonly host: PostgresIdentityHostV1<PostgresCustodyHandle>;
  readonly maxAttempts?: number;
}): IdentityUnitOfWorkV1<PostgresCustodyHandle> => {
  const maxAttempts = input.maxAttempts ?? 3;
  const run = async <T>(
    options: IdentityRunOptionsV1,
    operation: (tx: IdentityTransactionV1<PostgresCustodyHandle>) => Promise<T>,
    readOnly: boolean,
  ): Promise<T> => {
    requireWriteOptionsIfWrite(options, readOnly);
    let attempt = 0;
    for (;;) {
      attempt += 1;
      try {
        return await input.host.runSerializable({ readOnly, deadlineMs: options.deadlineMs }, async (binding) => {
          if (binding.readOnly !== readOnly) throw new IdentityCustodyErrorV1('identity_transaction_unbound');
          const handle = new PostgresCustodyHandle(input.schema, binding.session);
          return operation({ profile: 'postgres', transactionId: binding.transactionId, readOnly, hostTransaction: handle, stores: handle });
        });
      } catch (error) {
        if (attempt < maxAttempts && (isSerializationFailure(error) || isSocialRaceRetry(error))) continue;
        throw error;
      }
    }
  };
  return {
    profile: 'postgres',
    runRead: (options, operation) => run(options, operation, true),
    runWrite: (options, operation) => run(options, operation, false),
  };
}



const requireWriteOptionsIfWrite = (options: IdentityRunOptionsV1, readOnly: boolean): void => {
  if (readOnly) {
    if (options.mode !== 'read') throw new IdentityCustodyErrorV1('identity_transaction_unbound');
  } else {
    requireWriteOptions(options);
  }
  if (!Number.isInteger(options.deadlineMs) || options.deadlineMs <= 0) {
    throw new IdentityCustodyErrorV1('identity_material_invalid');
  }
};

export const createPostgresIdentityHostV1 = (options: PostgresCustodyOptions): PostgresIdentityHostV1<PostgresCustodyHandle> => ({
  runSerializable: async (runOptions, operation) => {
    const attempt = async (remaining: number): Promise<ReturnType<typeof operation>> => {
      try {
        return await options.driver.transaction(
          { isolation: 'serializable', readOnly: runOptions.readOnly, deadlineMs: runOptions.deadlineMs },
          async (session) =>
            operation({ transactionId: nextCustodyTxId(), hostTransaction: new PostgresCustodyHandle(options.schema, session), session, readOnly: runOptions.readOnly }),
        );
      } catch (error) {
        if (remaining > 0 && isSerializationFailure(error)) return attempt(remaining - 1);
        throw error;
      }
    };
    await applyPostgresIdentityCoreSchemaIfNeeded(options);
    return attempt(2);
  },
});

const schemaReadyByDriver = new WeakMap<InjectedPgDriver, Map<string, Promise<void>>>();

/** Idempotent custody DDL; safe to call concurrently. */
export const applyPostgresIdentityCoreSchemaIfNeeded = async (options: PostgresCustodyOptions): Promise<void> => {
  const { driver, schema, deadlineMs = CUSTODY_TX_DEADLINE_MS } = options;
  let bySchema = schemaReadyByDriver.get(driver);
  if (!bySchema) {
    bySchema = new Map();
    schemaReadyByDriver.set(driver, bySchema);
  }
  let ready = bySchema.get(schema);
  if (!ready) {
    ready = driver
      .transaction({ isolation: 'serializable', readOnly: false, deadlineMs }, async (session) => {
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
      })
      .catch((error: unknown) => {
        bySchema.delete(schema);
        throw error;
      });
    bySchema.set(schema, ready);
  }
  return ready;
};

/** Standalone per-method custody stores for direct store tests. */
export const createPostgresCustodyStores = (options: PostgresCustodyOptions): IdentityCustodyStoresV1 => {
  const runTx = async <T>(readOnly: boolean, op: (tx: PostgresCustodyTx) => Promise<T>): Promise<T> => {
    const host = createPostgresIdentityHostV1(options);
    const unitOfWork = createPostgresIdentityUnitOfWorkV1({ schema: options.schema, host });
    const runOptions: IdentityRunOptionsV1 = { mode: readOnly ? 'read' : 'write', deadlineMs: options.deadlineMs ?? CUSTODY_TX_DEADLINE_MS };
    return readOnly ? unitOfWork.runRead(runOptions, (tx) => op(tx.hostTransaction)) : unitOfWork.runWrite(runOptions, (tx) => op(tx.hostTransaction));
  };
  return {
    profiles: {
      find: (userId) => runTx(true, (tx) => tx.profiles.find(userId)),
      put: (record) => runTx(false, (tx) => tx.profiles.put(record)).then(() => undefined),
    },
    credentials: {
      insert: (record) => runTx(false, (tx) => tx.credentials.insert(record)).then(() => undefined),
      findById: (proofId) => runTx(true, (tx) => tx.credentials.findById(proofId)),
      findByCredentialId: (credentialId) => runTx(true, (tx) => tx.credentials.findByCredentialId(credentialId)),
      listForUser: (userId) => runTx(true, (tx) => tx.credentials.listForUser(userId)),
      compareAndSwapCounter: (input) => runTx(false, (tx) => tx.credentials.compareAndSwapCounter(input)),
      rename: (proofId, userId, deviceName) => runTx(false, (tx) => tx.credentials.rename(proofId, userId, deviceName)).then(() => undefined),
      revoke: (proofId, userId, at) => runTx(false, (tx) => tx.credentials.revoke(proofId, userId, at)).then(() => undefined),
    },
    singleUseProofs: {
      insert: (record) => runTx(false, (tx) => tx.singleUseProofs.insert(record)).then(() => undefined),
      find: (key) => runTx(true, (tx) => tx.singleUseProofs.find(key)),
      findChallenge: (challenge, purpose) => runTx(true, (tx) => tx.singleUseProofs.findChallenge(challenge, purpose)),
      findLatestEmailCode: (email, candidates, now) => runTx(true, (tx) => tx.singleUseProofs.findLatestEmailCode(email, candidates, now)),
      findMagicLink: (tokenHash) => runTx(true, (tx) => tx.singleUseProofs.findMagicLink(tokenHash)),
      countEmailCodes: (email, since) => runTx(true, (tx) => tx.singleUseProofs.countEmailCodes(email, since)),
      consume: (input) => runTx(false, (tx) => tx.singleUseProofs.consume(input)),
      revoke: (key, expectedRevision, at) => runTx(false, (tx) => tx.singleUseProofs.revoke(key, expectedRevision, at)).then(() => undefined),
      purgeExpired: (now) => runTx(false, (tx) => tx.singleUseProofs.purgeExpired(now)),
    },
    emailTickets: {
      findByTokenHash: (tokenHash) => runTx(true, (tx) => tx.emailTickets.findByTokenHash(tokenHash)),
      importTicket: (record) => runTx(false, (tx) => tx.emailTickets.importTicket(record)).then(() => undefined),
      exchangeCode: (input) => runTx(false, (tx) => tx.emailTickets.exchangeCode(input)),
      consume: (input) => runTx(false, (tx) => tx.emailTickets.consume(input)),
      revoke: (codeProofId, expectedRevision, at) => runTx(false, (tx) => tx.emailTickets.revoke(codeProofId, expectedRevision, at)).then(() => undefined),
    },
    invitations: {
      insert: (record) => runTx(false, (tx) => tx.invitations.insert(record)).then(() => undefined),
      findById: (invitationId) => runTx(true, (tx) => tx.invitations.findById(invitationId)),
      findByDigest: (tokenHash) => runTx(true, (tx) => tx.invitations.findByDigest(tokenHash)),
      consumeByDigest: (input) => runTx(false, (tx) => tx.invitations.consumeByDigest(input)),
      revoke: (invitationId, expectedRevision, at) => runTx(false, (tx) => tx.invitations.revoke(invitationId, expectedRevision, at)).then(() => undefined),
    },
    sessions: {
      insert: (record) => runTx(false, (tx) => tx.sessions.insert(record)).then(() => undefined),
      findById: (sessionId) => runTx(true, (tx) => tx.sessions.findById(sessionId)),
      findBySessionTokenHash: (hash) => runTx(true, (tx) => tx.sessions.findBySessionTokenHash(hash)),
      findByRefreshTokenHash: (hash) => runTx(true, (tx) => tx.sessions.findByRefreshTokenHash(hash)),
      rotate: (input) => runTx(false, (tx) => tx.sessions.rotate(input)),
      touchActivity: (sessionId, at) => runTx(false, (tx) => tx.sessions.touchActivity(sessionId, at)).then(() => undefined),
      revoke: (sessionId, at) => runTx(false, (tx) => tx.sessions.revoke(sessionId, at)).then(() => undefined),
      revokeAllForUser: (userId, at) => runTx(false, (tx) => tx.sessions.revokeAllForUser(userId, at)),
      listForUser: (userId) => runTx(true, (tx) => tx.sessions.listForUser(userId)),
    },
    social: {
      insert: (record) => runTx(false, (tx) => tx.social.insert(record)).then(() => undefined),
      findById: (proofId) => runTx(true, (tx) => tx.social.findById(proofId)),
      findBySubject: (provider, providerSubject) => runTx(true, (tx) => tx.social.findBySubject(provider, providerSubject)),
      listForUser: (userId) => runTx(true, (tx) => tx.social.listForUser(userId)),
      touchLogin: (proofId, expectedRevision, at) => runTx(false, (tx) => tx.social.touchLogin(proofId, expectedRevision, at)).then(() => undefined),
      unlink: (proofId, userId, expectedRevision, at) => runTx(false, (tx) => tx.social.unlink(proofId, userId, expectedRevision, at)).then(() => undefined),
    },
  };
};

/** Applies the custody asset on the caller's active binding; never begins or commits. */
export const applyPostgresIdentityCustodySchemaV1 = async (input: {
  readonly schema: string;
  readonly binding: PostgresCustodyBindingV1<unknown>;
  readonly expectedAssetSha256: string;
  readonly appliedAt: string;
}): Promise<IdentityCustodySchemaReceiptV1> => {
  const asset = identityCustodySchemaAssetV1('postgres');
  if (asset.assetSha256 !== input.expectedAssetSha256) throw new IdentityCustodyErrorV1('identity_contract_unavailable');
  const session = input.binding.session;
  await session.execute({ text: `CREATE SCHEMA IF NOT EXISTS "${input.schema}"`, values: [] });
  for (const ddl of identitySchemaStatements('postgres', input.schema)) {
    await session.execute({ text: ddl, values: [] });
  }
  const existing = await session.execute({
    text: `SELECT * FROM "${input.schema}"."identity_custody_schema_versions" WHERE "migration_id" = 'A2.0b/1'`,
    values: [],
  });
  const row = existing.rows[0] as Record<string, unknown> | undefined;
  if (row) {
    if (row['asset_sha256'] !== asset.assetSha256 || row['contract_version'] !== '1.1.0') {
      throw new IdentityCustodyErrorV1('identity_contract_unavailable');
    }
    return { migrationId: 'A2.0b/1', contractVersion: '1.1.0', profile: 'postgres', assetSha256: asset.assetSha256, appliedAt: String(row['applied_at']) };
  }
  await session.execute({
    text: `INSERT INTO "${input.schema}"."identity_custody_schema_versions" ("migration_id","contract_version","asset_sha256","applied_at") VALUES ('A2.0b/1','1.1.0',$1,$2)`,
    values: [asset.assetSha256, input.appliedAt],
  });
  return { migrationId: 'A2.0b/1', contractVersion: '1.1.0', profile: 'postgres', assetSha256: asset.assetSha256, appliedAt: input.appliedAt };
};

export const bindPostgresIdentityTransactionV1 = <H>(input: {
  readonly schema: string;
  readonly binding: PostgresCustodyBindingV1<H>;
  readonly hostTransaction: H;
}): IdentityTransactionV1<H> => ({
  profile: 'postgres',
  transactionId: input.binding.transactionId,
  readOnly: input.binding.readOnly,
  hostTransaction: input.hostTransaction,
  stores: new PostgresCustodyTx(input.schema, input.binding.session),
});

/** V1 factory name for the standalone PostgreSQL custody stores. */
export const createPostgresIdentityCustodyStoresV1 = createPostgresCustodyStores;
