import type {
  AuthHonoCreateFederationFlowStateInput,
  AuthHonoFederationFlowState,
  AuthHonoFederationPort,
} from '@sentropic/auth-hono';
import { IdentityCustodyErrorV1 } from '@sentropic/cluster-mesh';
import { randomBytes } from 'node:crypto';
import { and, eq, gt } from 'drizzle-orm';

import { db } from '../../db/client';
import { federationFlowStates } from '../../db/schema';

/** Only transient upstream protocol state remains app-owned. CM binds all identity methods. */

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
