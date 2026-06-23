import type { AuthHonoInvitesPort } from '@sentropic/auth-hono';
import { createHash } from 'node:crypto';
import { and, eq, gt, isNull } from 'drizzle-orm';

import { db } from '../../db/client';
import { authInviteTokens } from '../../db/schema';

/**
 * BR-39r L4 — single-use invitation-token store (`AuthHonoInvitesPort`).
 *
 * The opaque `sit_`-prefixed token is NEVER stored; only its SHA-256 hash is persisted
 * (hash-at-rest, mirroring `email_verification_codes.code_hash`). `consume` is a single
 * atomic `UPDATE ... WHERE consumed_at IS NULL AND expires_at>now RETURNING email`, so under
 * concurrency EXACTLY ONE caller observes the row mutate and receives the bound email; every
 * other caller (and every invalid/expired/already-consumed token) gets `null`. The caller
 * collapses all `null` outcomes into the C3 generic fallback (no account-enumeration signal).
 */

export const hashInviteToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex');

interface CreateInviteStoreAdapterOptions {
  database?: typeof db;
}

export const createInviteStoreAdapter = (
  options: CreateInviteStoreAdapterOptions = {}
): AuthHonoInvitesPort => {
  const database = options.database ?? db;

  return {
    async findValid(tokenHash, now) {
      const [row] = await database
        .select({ clientId: authInviteTokens.clientId, email: authInviteTokens.email })
        .from(authInviteTokens)
        .where(
          and(
            eq(authInviteTokens.tokenHash, tokenHash),
            isNull(authInviteTokens.consumedAt),
            gt(authInviteTokens.expiresAt, now)
          )
        )
        .limit(1);
      return row ? { clientId: row.clientId ?? null, email: row.email } : null;
    },

    async consume(tokenHash, now, userId) {
      // Single atomic statement: only the row that is still unconsumed AND unexpired mutates,
      // and only the winning UPDATE returns a row. No read-then-write race.
      const [row] = await database
        .update(authInviteTokens)
        .set({ consumedAt: now, consumedByUserId: userId })
        .where(
          and(
            eq(authInviteTokens.tokenHash, tokenHash),
            isNull(authInviteTokens.consumedAt),
            gt(authInviteTokens.expiresAt, now)
          )
        )
        .returning({ email: authInviteTokens.email });
      return row ? { email: row.email } : null;
    },
  };
};
