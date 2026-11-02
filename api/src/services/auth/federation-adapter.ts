import type {
  AuthHonoCreateFederationFlowStateInput,
  AuthHonoFederationFlowState,
  AuthHonoFederationPort,
  AuthHonoIdentityRecord,
  AuthHonoLinkIdentityInput,
} from '@sentropic/auth-hono';
import { AuthHonoIdentityConflictError } from '@sentropic/auth-hono';
import { IdentityCustodyErrorV1 } from '@sentropic/cluster-mesh';
import { randomBytes } from 'node:crypto';
import { and, eq, gt } from 'drizzle-orm';

import { db } from '../../db/client';
import { federationFlowStates } from '../../db/schema';
import {
  createCmSocialLink,
  findCmSocialBySubject,
  hasConsumedCmMagicLinkForUser,
  listCmCredentialsForUser,
  listCmSocialForUser,
  touchCmSocialLogin,
  unlinkCmSocial,
  type CmSocialRecord,
} from '../identity/cm-proofs';

/**
 * BR-39e Lot 0 — adapter for the auth-hono `federation` port.
 *
 * Lot A4: the `identities` link table moved to the cluster-mesh custody store
 * (`cm_identity.identity_social_links`), magic links to
 * `cm_identity.identity_single_use_proofs` (kind 'magic_link') and WebAuthn
 * credentials to `cm_identity.identity_webauthn_credentials`. Only the one-time
 * `federation_flow_states` store stays app-owned (business data).
 *
 * The SAFE linking algorithm (subject-first, no-silent-merge) lives in
 * `resolveOrCreateFederatedUser`; this adapter just provides the data-access
 * primitives it composes.
 *
 * Two security-critical primitives:
 *  - `linkIdentity` maps the custody `social_subject_conflict` error (the
 *    UNIQUE(provider, provider_subject) index, SQLSTATE 23505 underneath) to
 *    `AuthHonoIdentityConflictError` so the resolver can re-read + log the existing
 *    user in idempotently under a concurrent-callback race (K-UNIQUE).
 *  - `consumeFlowState` is a SINGLE atomic `DELETE ... WHERE id=$id AND expires_at>$now
 *    RETURNING *`, giving verify-and-DELETE single-use + TTL in one statement
 *    (K-FLOW / K-STATE): a replay, an expired state, or a second consume all return `null`.
 */

const isSocialSubjectConflict = (error: unknown): boolean => {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current != null; depth += 1) {
    if (typeof current === 'object' && current !== null) {
      const code = (current as { code?: unknown }).code;
      if (code === 'social_subject_conflict' || code === '23505') return true;
    }
    current =
      typeof current === 'object' && current !== null && 'cause' in current
        ? (current as { cause?: unknown }).cause
        : undefined;
  }
  return false;
};

const toIdentityRecord = (row: CmSocialRecord): AuthHonoIdentityRecord => ({
  emailAtLink: row.emailAtLink,
  emailVerifiedByProvider: row.emailVerifiedByProvider,
  id: row.id,
  lastLoginAt: row.lastLoginAt,
  linkedAt: row.linkedAt,
  provider: row.provider,
  providerSubject: row.providerSubject,
  providerTenant: row.providerTenant,
  userId: row.userId,
});

const toFlowState = (
  row: typeof federationFlowStates.$inferSelect,
): AuthHonoFederationFlowState => ({
  codeVerifier: row.codeVerifier,
  continuationToken: row.continuationToken,
  createdAt: row.createdAt,
  expiresAt: row.expiresAt,
  id: row.id,
  nonce: row.nonce,
  provider: row.provider,
  upstreamState: row.upstreamState,
});

interface CreateFederationAdapterOptions {
  database?: typeof db;
}

const boundIdentityRequired = async (): Promise<never> => {
  throw new IdentityCustodyErrorV1('identity_transaction_unbound');
};

export const createFederationAdapter = (
  options: CreateFederationAdapterOptions = {},
): AuthHonoFederationPort => {
  const database = options.database ?? db;

  return {
    findIdentityBySubject: boundIdentityRequired,
    findIdentitiesForUser: boundIdentityRequired,
    linkIdentity: boundIdentityRequired,
    unlinkIdentity: boundIdentityRequired,
    touchLogin: boundIdentityRequired,
    isUserCredentialed: boundIdentityRequired,

    async createFlowState(input: AuthHonoCreateFederationFlowStateInput) {
      // The opaque `id` is a high-entropy token: it is the pointer carried in the bound cookie and
      // must be unguessable, distinct from both the upstream CSRF `state` and the continuation.
      const [row] = await database
        .insert(federationFlowStates)
        .values({
          codeVerifier: input.codeVerifier ?? null,
          continuationToken: input.continuationToken ?? null,
          createdAt: input.now,
          expiresAt: input.expiresAt,
          id: randomBytes(32).toString('base64url'),
          nonce: input.nonce ?? null,
          provider: input.provider,
          upstreamState: input.upstreamState,
        })
        .returning();
      return toFlowState(row);
    },

    async consumeFlowState(id, now) {
      // Single atomic statement: only an existing, unexpired row is deleted AND returned, so a
      // replay / expired / already-consumed id all yield null. No read-then-delete race.
      const [row] = await database
        .delete(federationFlowStates)
        .where(and(eq(federationFlowStates.id, id), gt(federationFlowStates.expiresAt, now)))
        .returning();
      return row ? toFlowState(row) : null;
    },
  };
};
