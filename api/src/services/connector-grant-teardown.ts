/**
 * Connector grant teardown — revoke BEFORE destroying the row that holds the only means to revoke.
 *
 * THE INVARIANT
 * -------------
 * A connector row that owns an external grant is never destroyed before that grant has been
 * revoked, or a durable tombstone of the intent has been recorded.
 *
 * WHY THIS EXISTS
 * ---------------
 * `document_connector_accounts` cascades from both `users` and `workspaces`
 * (`0026_google_drive_connector_accounts.sql:25,31`). A cascade is executed by Postgres and runs NO
 * application code — the repository defines no trigger or function, so there is not even a hook to
 * attach to. Deleting a user or a workspace therefore destroys the encrypted refresh token in the
 * same statement that destroys the row, and once it is gone nothing remains to call revoke with.
 * The grant stays live at Google forever.
 *
 * That makes this worse than the `disconnect` bug: there, the row survived and a second attempt
 * could still fix it. Here the loss is IRREVERSIBLE, which is why the cascade may only ever be an
 * anti-orphan safety net and never the primary deletion path.
 *
 * ORDERING, AND WHY IT DIFFERS FROM `disconnect`
 * ----------------------------------------------
 * `disconnect` clears the row first and revokes after, because the local write is the guaranteed
 * step and an unbounded outbound call must not hold it hostage. That reasoning does NOT carry over:
 * here the "local write" is a deletion, and after it the token no longer exists. So:
 *
 *   1. capture + classify the grants BEFORE the transaction — afterwards the rows are gone;
 *   2. write a tombstone for every live-or-unknown grant INSIDE the transaction, so the record and
 *      the destruction commit or roll back together and no window exists where one happened
 *      without the other;
 *   3. attempt the revocations AFTER a successful commit — never before, because a transaction that
 *      rolls back would otherwise have killed the grant of an account that still exists.
 *
 * The tombstone is the transactional outbox (`control.event_outbox`), not a new table: it is
 * already the durable source of truth, it is written inside the caller's transaction, and its
 * `aggregateId` is a SOFT reference with no cross-namespace FK — which is exactly what a record
 * about a row being deleted requires.
 */

import { eq } from 'drizzle-orm';
import type { PgTransaction } from 'drizzle-orm/pg-core';
import type { NodePgQueryResultHKT } from 'drizzle-orm/node-postgres';

import { db } from '../db/client';
import { documentConnectorAccounts } from '../db/schema';
import { logger } from '../logger';
import {
  classifyConnectorGrant,
  type ConnectorGrantClassification,
} from './google-drive-connector-accounts';
import { revokeGoogleOAuthToken } from './google-drive-oauth';
import { outboxWriter } from './outbox/outbox-writer';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyPgTx = PgTransaction<NodePgQueryResultHKT, any, any>;

export const CONNECTOR_GRANT_TEARDOWN_CHANNEL = 'connector_grant_events';
export const CONNECTOR_GRANT_ORPHANED_EVENT = 'connector.grant.orphaned';

export type CapturedConnectorGrant = {
  accountId: string;
  provider: string;
  workspaceId: string;
  userId: string;
  accountEmail: string | null;
  classification: ConnectorGrantClassification;
};

/**
 * Read and classify every connector grant in the scope about to be deleted.
 *
 * Scope is deliberately either-or-both: deleting a user removes their rows in every workspace,
 * deleting a workspace removes every member's rows in it. A caller that deletes both in one
 * transaction passes both and gets the union, de-duplicated by row id.
 *
 * NEVER THROWS. A failure to read grants must not be able to block a deletion — it degrades to
 * "we captured nothing", which the caller can still see, rather than to an exception that a caller
 * might catch and treat as "nothing to do".
 */
export const captureConnectorGrantsForTeardown = async (scope: {
  userId?: string;
  workspaceId?: string;
}): Promise<CapturedConnectorGrant[]> => {
  const predicates = [];
  if (scope.userId) predicates.push(eq(documentConnectorAccounts.userId, scope.userId));
  if (scope.workspaceId) predicates.push(eq(documentConnectorAccounts.workspaceId, scope.workspaceId));
  if (predicates.length === 0) return [];

  try {
    // Union, not intersection: `or` would be wrong for a caller deleting a user AND their
    // workspace, and `and` would silently miss the user's rows in OTHER workspaces.
    const collected = new Map<string, CapturedConnectorGrant>();
    for (const predicate of predicates) {
      const rows = await db.select().from(documentConnectorAccounts).where(predicate);
      for (const row of rows) {
        collected.set(row.id, {
          accountId: row.id,
          provider: row.provider,
          workspaceId: row.workspaceId,
          userId: row.userId,
          accountEmail: row.accountEmail ?? null,
          classification: classifyConnectorGrant(row.tokenSecret),
        });
      }
    }
    return [...collected.values()];
  } catch (error) {
    // Loud, because an empty capture is indistinguishable from "no grants existed" downstream.
    logger.error(
      { scope, error: error instanceof Error ? error.message : String(error) },
      'connector-teardown: FAILED to capture grants before deletion — grants may be destroyed unrevoked',
    );
    return [];
  }
};

/**
 * A captured grant that owns something at the provider — the `none` case is excluded IN THE TYPE.
 *
 * Without this, `grantsNeedingTeardown` drops `none` at runtime while its signature still admits
 * it, so every consumer has to re-narrow or cast. Encoding the filter's actual meaning is what lets
 * the revocation path reach `classification.token` after ruling out `unreadable`, with no cast.
 */
export type ConnectorGrantNeedingTeardown = CapturedConnectorGrant & {
  classification: Exclude<ConnectorGrantClassification, { kind: 'none' }>;
};

/** Grants that own something at the provider: either revocable now, or known-lost. */
export const grantsNeedingTeardown = (
  grants: CapturedConnectorGrant[],
): ConnectorGrantNeedingTeardown[] =>
  grants.filter((g): g is ConnectorGrantNeedingTeardown => g.classification.kind !== 'none');

/**
 * Record the durable intent, inside the caller's deletion transaction.
 *
 * Written for `unreadable` grants too — in fact those are the ones that matter most, since they can
 * never be revoked by us and the tombstone is the only trace that will ever exist that a live grant
 * was abandoned. NEVER THROWS: a tombstone failure must not roll back a user's account deletion,
 * but it is logged at error level because it degrades the guarantee this module exists to provide.
 */
export const recordConnectorGrantTombstones = async (
  tx: AnyPgTx,
  grants: CapturedConnectorGrant[],
): Promise<void> => {
  for (const grant of grantsNeedingTeardown(grants)) {
    try {
      await outboxWriter.append(tx, {
        aggregateType: 'connector_account',
        aggregateId: grant.accountId,
        envelope: {
          type: CONNECTOR_GRANT_ORPHANED_EVENT,
          accountId: grant.accountId,
          provider: grant.provider,
          accountEmail: grant.accountEmail,
          // No token, no ciphertext, no key material — the tombstone records THAT a grant was
          // abandoned and which account it belonged to, never the credential itself.
          reason: grant.classification.kind === 'token' ? 'row_deleted' : 'token_unreadable',
        },
        workspaceId: grant.workspaceId,
        tenantId: null,
        origin: 'connector-grant-teardown',
        channel: CONNECTOR_GRANT_TEARDOWN_CHANNEL,
      });
    } catch (error) {
      logger.error(
        {
          accountId: grant.accountId,
          error: error instanceof Error ? error.message : String(error),
        },
        'connector-teardown: FAILED to record the tombstone for an abandoned grant',
      );
    }
  }
};

/**
 * Attempt the revocations, AFTER the deletion has committed.
 *
 * Best-effort and never throws: the rows are already gone, so failing here cannot be allowed to
 * turn a completed deletion into an error response. Every outcome is logged, because "we called
 * revoke" is not "the grant is revoked" — an operator reconstructing an incident must be able to
 * tell an abandoned grant from a revoked one.
 */
export const revokeCapturedConnectorGrants = async (
  grants: CapturedConnectorGrant[],
): Promise<void> => {
  await Promise.all(
    grantsNeedingTeardown(grants).map(async (grant) => {
      if (grant.classification.kind === 'unreadable') {
        logger.error(
          { accountId: grant.accountId, provider: grant.provider },
          'connector-teardown: grant ABANDONED — its stored secret was unreadable, so it can never be revoked; tombstone recorded',
        );
        return;
      }
      try {
        const result = await revokeGoogleOAuthToken({ token: grant.classification.token });
        if (result.revoked) {
          logger.info(
            { accountId: grant.accountId, provider: grant.provider },
            'connector-teardown: grant revoked upstream before its row was destroyed',
          );
        } else {
          logger.error(
            { accountId: grant.accountId, status: result.status, error: result.error },
            'connector-teardown: upstream revocation FAILED — the grant is live and its row is gone; tombstone recorded',
          );
        }
      } catch (error) {
        logger.error(
          {
            accountId: grant.accountId,
            error: error instanceof Error ? error.message : String(error),
          },
          'connector-teardown: upstream revocation threw — the grant is live and its row is gone',
        );
      }
    }),
  );
};
