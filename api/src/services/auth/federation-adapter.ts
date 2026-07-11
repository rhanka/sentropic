import type {
  AuthHonoCreateFederationFlowStateInput,
  AuthHonoFederationFlowState,
  AuthHonoFederationPort,
  AuthHonoIdentityRecord,
  AuthHonoLinkIdentityInput,
} from '@sentropic/auth-hono';
import { AuthHonoIdentityConflictError } from '@sentropic/auth-hono';
import { randomBytes, randomUUID } from 'node:crypto';
import { and, eq, gt } from 'drizzle-orm';

import { db } from '../../db/client';
import { federationFlowStates, identities, magicLinks, webauthnCredentials } from '../../db/schema';

/**
 * BR-39e Lot 0 — Drizzle/Postgres adapter for the auth-hono `federation` port.
 *
 * Owns ONLY the `identities` link table + the one-time `federation_flow_states` store. The SAFE
 * linking algorithm (subject-first, no-silent-merge) lives in `resolveOrCreateFederatedUser`; this
 * adapter just provides the data-access primitives it composes.
 *
 * Two security-critical primitives:
 *  - `linkIdentity` maps the Postgres UNIQUE(provider, provider_subject) violation (SQLSTATE 23505)
 *    to `AuthHonoIdentityConflictError` so the resolver can re-read + log the existing user in
 *    idempotently under a concurrent-callback race (K-UNIQUE).
 *  - `consumeFlowState` is a SINGLE atomic `DELETE ... WHERE id=$id AND expires_at>$now RETURNING *`,
 *    giving verify-and-DELETE single-use + TTL in one statement (K-FLOW / K-STATE): a replay,
 *    an expired state, or a second consume all return `null`.
 */

const PG_UNIQUE_VIOLATION = '23505';

// drizzle wraps the driver error ("Failed query: ..."), so the Postgres SQLSTATE may live on the
// error itself OR anywhere along its `cause` chain. Walk it to detect the unique-violation code.
const isUniqueViolation = (error: unknown): boolean => {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current != null; depth += 1) {
    if (
      typeof current === 'object' &&
      'code' in current &&
      (current as { code?: unknown }).code === PG_UNIQUE_VIOLATION
    ) {
      return true;
    }
    current =
      typeof current === 'object' && current !== null && 'cause' in current
        ? (current as { cause?: unknown }).cause
        : undefined;
  }
  return false;
};

const toIdentityRecord = (row: typeof identities.$inferSelect): AuthHonoIdentityRecord => ({
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

export const createFederationAdapter = (
  options: CreateFederationAdapterOptions = {},
): AuthHonoFederationPort => {
  const database = options.database ?? db;

  return {
    async findIdentityBySubject(provider, providerSubject) {
      const [row] = await database
        .select()
        .from(identities)
        .where(and(eq(identities.provider, provider), eq(identities.providerSubject, providerSubject)))
        .limit(1);
      return row ? toIdentityRecord(row) : null;
    },

    async findIdentitiesForUser(userId) {
      const rows = await database.select().from(identities).where(eq(identities.userId, userId));
      return rows.map(toIdentityRecord);
    },

    async linkIdentity(input: AuthHonoLinkIdentityInput) {
      try {
        const [row] = await database
          .insert(identities)
          .values({
            emailAtLink: input.emailAtLink,
            emailVerifiedByProvider: input.emailVerifiedByProvider,
            id: randomUUID(),
            lastLoginAt: input.now,
            linkedAt: input.now,
            provider: input.provider,
            providerSubject: input.providerSubject,
            providerTenant: input.providerTenant ?? null,
            userId: input.userId,
          })
          .returning();
        return toIdentityRecord(row);
      } catch (error) {
        // The UNIQUE(provider, provider_subject) index rejected a concurrent duplicate link.
        if (isUniqueViolation(error)) {
          throw new AuthHonoIdentityConflictError(input.provider, input.providerSubject);
        }
        throw error;
      }
    },

    async unlinkIdentity(userId, provider, providerSubject) {
      const deleted = await database
        .delete(identities)
        .where(
          and(
            eq(identities.userId, userId),
            eq(identities.provider, provider),
            eq(identities.providerSubject, providerSubject),
          ),
        )
        .returning({ id: identities.id });
      return deleted.length > 0;
    },

    async touchLogin(identityId, now) {
      await database.update(identities).set({ lastLoginAt: now }).where(eq(identities.id, identityId));
    },

    async isUserCredentialed(userId) {
      // A completed sign-in factor = a webauthn credential, an existing federated identity, or a
      // used magic link. Any one marks the account as NOT a non-credentialed shell (D7).
      const [credential] = await database
        .select({ id: webauthnCredentials.id })
        .from(webauthnCredentials)
        .where(eq(webauthnCredentials.userId, userId))
        .limit(1);
      if (credential) return true;

      const [identity] = await database
        .select({ id: identities.id })
        .from(identities)
        .where(eq(identities.userId, userId))
        .limit(1);
      if (identity) return true;

      const [usedLink] = await database
        .select({ id: magicLinks.id })
        .from(magicLinks)
        .where(and(eq(magicLinks.userId, userId), eq(magicLinks.used, true)))
        .limit(1);
      return Boolean(usedLink);
    },

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
