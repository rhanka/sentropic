// Lot A4: the single account-deletion path. Identity rows are removed by the
// A2.3 atomic cascade (createAtomicPersonDeletionV2 over the CM unit of work);
// the app business rows are deleted by the BusinessDeletionPortV1 INSIDE the
// same CM host transaction, so an injected failure rolls back identity AND
// business rows together — no orphans, no partial deletion. The legacy
// public.users table is dropped by control migration 0014; there is no
// fallback writer.

import { randomUUID } from 'node:crypto';

import type {
  BusinessDeletionPlanV1,
  BusinessDeletionReceiptV1,
  CustodyOpHost,
  PersonDeletionReceiptV2,
} from '@sentropic/cluster-mesh';
import type { PgSession } from '@sentropic/cluster-mesh/storage/postgres';

import { logger } from '../../logger';
import { getCmIdentity } from '../identity/cm-identity';
import {
  captureConnectorGrantsForTeardown,
  grantsNeedingTeardown,
  revokeCapturedConnectorGrants,
  CONNECTOR_GRANT_ORPHANED_EVENT,
  CONNECTOR_GRANT_TEARDOWN_CHANNEL,
  type CapturedConnectorGrant,
} from '../connector-grant-teardown';
import type { RemoteSessionRevocation } from './remote-revocation';

const REMOTE_REVOCATION_PREFIX = 'remote_session_revocation:';

type Raw = PgSession;

const run = async (
  host: Raw,
  text: string,
  values: unknown[] = [],
): Promise<{ rows: readonly Record<string, unknown>[]; rowCount: number }> => {
  const result = await host.execute({ text, values: values as never[] });
  return { rows: result.rows, rowCount: result.rowCount ?? result.rows.length };
};

/** Same guard as queueRemoteRevocation: only the issuer/product roles queue. */
const remoteRevocationConfigured = (): boolean =>
  process.env.REMOTE_ACTION_ROLE === 'auth-idp'
  || Boolean(process.env.REMOTE_ACTION_REVOCATION_ISSUER)
  || process.env.REMOTE_ACTION_ROLE === 'product';

/** Raw in-transaction variant of queueRemoteRevocation (settings survives 0014). */
const queueRemoteRevocationRaw = async (host: Raw, input: RemoteSessionRevocation): Promise<string | null> => {
  if (!remoteRevocationConfigured()) return null;
  const key = `${REMOTE_REVOCATION_PREFIX}${randomUUID()}`;
  await run(host, 'INSERT INTO public.settings (key, value) VALUES ($1, $2)', [key, JSON.stringify(input)]);
  return key;
};

/** Raw in-transaction variant of outboxWriter.append (control.event_outbox). */
const appendOutboxRaw = async (
  host: Raw,
  params: { aggregateType: string; aggregateId: string; envelope: unknown; origin: string; workspaceId: string; channel: string },
): Promise<void> => {
  await run(host, 'SELECT pg_advisory_xact_lock(hashtext($1 || $2))', [params.aggregateType, params.aggregateId]);
  const { rows } = await run(
    host,
    'SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM control.event_outbox WHERE aggregate_type = $1 AND aggregate_id = $2',
    [params.aggregateType, params.aggregateId],
  );
  const seq = Number(rows[0]?.next ?? 1);
  await run(
    host,
    `INSERT INTO control.event_outbox (id, aggregate_type, aggregate_id, seq, envelope, origin, tenant_id, workspace_id, status, attempts, channel)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, NULL, $7, 'pending', 0, $8)`,
    [randomUUID(), params.aggregateType, params.aggregateId, seq, JSON.stringify(params.envelope), params.origin, params.workspaceId, params.channel],
  );
  await run(host, 'NOTIFY outbox_pending');
};

/** Tombstones for captured connector grants, inside the deletion transaction. */
const recordGrantTombstonesRaw = async (host: Raw, grants: CapturedConnectorGrant[]): Promise<void> => {
  for (const grant of grantsNeedingTeardown(grants)) {
    try {
      await appendOutboxRaw(host, {
        aggregateType: 'connector_account',
        aggregateId: grant.accountId,
        envelope: {
          type: CONNECTOR_GRANT_ORPHANED_EVENT,
          accountId: grant.accountId,
          provider: grant.provider,
          accountEmail: grant.accountEmail,
          reason: grant.classification.kind === 'token' ? 'row_deleted' : 'token_unreadable',
        },
        origin: 'connector-grant-teardown',
        workspaceId: grant.workspaceId,
        channel: CONNECTOR_GRANT_TEARDOWN_CHANNEL,
      });
    } catch (error) {
      logger.error(
        { accountId: grant.accountId, error: error instanceof Error ? error.message : String(error) },
        'connector-teardown: FAILED to record the tombstone for an abandoned grant',
      );
    }
  }
};

/** Business rows of one workspace being deleted (public.workspaces row included). */
const deleteWorkspaceBusinessRows = async (host: Raw, workspaceId: string): Promise<Record<string, number>> => {
  const counts: Record<string, number> = {};
  const { rows: orgs } = await run(host, 'SELECT id FROM public.organizations WHERE workspace_id = $1', [workspaceId]);
  const { rows: folders } = await run(host, 'SELECT id FROM public.folders WHERE workspace_id = $1', [workspaceId]);
  const { rows: initiatives } = await run(host, 'SELECT id FROM public.initiatives WHERE workspace_id = $1', [workspaceId]);
  const orgIds = orgs.map((r) => String(r.id));
  const folderIds = folders.map((r) => String(r.id));
  const initiativeIds = initiatives.map((r) => String(r.id));

  const streamIds = [
    ...orgIds.map((id) => `organization_${id}`),
    ...folderIds.map((id) => `folder_${id}`),
    ...initiativeIds.map((id) => `usecase_${id}`),
  ];
  if (streamIds.length) {
    const { rowCount } = await run(host, 'DELETE FROM public.chat_stream_events WHERE stream_id = ANY($1)', [streamIds]);
    counts.chatStreamEvents = rowCount;
  }
  for (const [type, ids] of [['organization', orgIds], ['folder', folderIds], ['initiative', initiativeIds]] as const) {
    if (!ids.length) continue;
    await run(host, 'DELETE FROM public.context_modification_history WHERE context_type = $1 AND context_id = ANY($2)', [type, ids]);
  }
  await run(host, 'DELETE FROM public.initiatives WHERE workspace_id = $1', [workspaceId]);
  await run(host, 'DELETE FROM public.folders WHERE workspace_id = $1', [workspaceId]);
  await run(host, 'DELETE FROM public.organizations WHERE workspace_id = $1', [workspaceId]);
  await run(host, 'DELETE FROM public.job_queue WHERE workspace_id = $1', [workspaceId]);
  // FK is NO ACTION: detach before removing the workspace row.
  await run(host, 'UPDATE public.chat_sessions SET workspace_id = NULL WHERE workspace_id = $1', [workspaceId]);
  await run(host, 'UPDATE public.chat_generation_traces SET workspace_id = NULL WHERE workspace_id = $1', [workspaceId]);
  await run(host, 'DELETE FROM public.workspaces WHERE id = $1', [workspaceId]);
  counts.workspaces = 1;
  return counts;
};

/**
 * App business participant bound to the CM host transaction. `host.raw` is the
 * PgSession of the unit-of-work transaction, so every statement below commits
 * or rolls back with the identity cascade.
 */
const appBusinessDeletion = (capturedGrants: CapturedConnectorGrant[], handlerId: 'self_account' | 'admin_account') => ({
  handlerId,
  resolvePlan: async (userId: string, host: CustodyOpHost): Promise<BusinessDeletionPlanV1> => {
    const raw = host.raw as Raw;
    const { rows: memberships } = await run(
      raw,
      'SELECT workspace_id, role FROM "cm_identity"."cm_workspace_members" WHERE user_id = $1',
      [userId],
    );
    const workspaceIdsToDelete: string[] = [];
    const retainedWorkspaceIds: string[] = [];
    for (const row of memberships) {
      const workspaceId = String(row.workspace_id);
      const role = String(row.role);
      const { rows: admins } = await run(
        raw,
        'SELECT COUNT(*)::int AS n FROM "cm_identity"."cm_workspace_members" WHERE workspace_id = $1 AND role = $2',
        [workspaceId, 'admin'],
      );
      // A workspace whose last admin leaves cannot be retained (the cascade
      // rejects it with last_admin), so sole-admin workspaces are deleted.
      if (role === 'admin' && (admins[0]?.n as number) <= 1) workspaceIdsToDelete.push(workspaceId);
      else retainedWorkspaceIds.push(workspaceId);
    }
    return { userId, workspaceIdsToDelete, retainedWorkspaceIds };
  },
  deleteRows: async (plan: BusinessDeletionPlanV1, host: CustodyOpHost): Promise<BusinessDeletionReceiptV1> => {
    const raw = host.raw as Raw;
    const deletedRows: Record<string, number> = {};
    for (const workspaceId of plan.workspaceIdsToDelete) {
      Object.assign(deletedRows, await deleteWorkspaceBusinessRows(raw, workspaceId));
    }
    // Rows owned by the user itself (FK cascades from public.users were
    // dropped by 0014, so they are deleted explicitly here).
    await run(raw, 'DELETE FROM public.chat_sessions WHERE user_id = $1', [plan.userId]);
    await run(raw, 'DELETE FROM public.document_connector_accounts WHERE user_id = $1', [plan.userId]);
    await recordGrantTombstonesRaw(raw, capturedGrants);
    // Durable remote-revocation outbox entry, committed with the cascade.
    const { rows: sessions } = await run(
      raw,
      'SELECT id FROM "cm_identity"."identity_login_sessions" WHERE user_id = $1',
      [plan.userId],
    );
    const sessionIds = sessions.map((row) => String(row.id));
    await queueRemoteRevocationRaw(raw, { sessionIds, userId: plan.userId });
    deletedRows.chatSessions = sessionIds.length;
    return { handlerId, deletedRows };
  },
  assertNoOrphans: async (plan: BusinessDeletionPlanV1, host: CustodyOpHost): Promise<void> => {
    const raw = host.raw as Raw;
    const checks: Array<[string, string, unknown[]]> = [
      ['chat_sessions', 'SELECT COUNT(*)::int AS n FROM public.chat_sessions WHERE user_id = $1', [plan.userId]],
      ['document_connector_accounts', 'SELECT COUNT(*)::int AS n FROM public.document_connector_accounts WHERE user_id = $1', [plan.userId]],
    ];
    if (plan.workspaceIdsToDelete.length) {
      checks.push(['workspaces', 'SELECT COUNT(*)::int AS n FROM public.workspaces WHERE id = ANY($1)', [plan.workspaceIdsToDelete]]);
    }
    for (const [name, text, values] of checks) {
      const { rows } = await run(raw, text, values);
      if ((rows[0]?.n as number) > 0) throw new Error(`orphan rows remain in ${name} after account deletion`);
    }
  },
});

export interface AccountDeletionOutcome {
  readonly receipt: PersonDeletionReceiptV2;
  readonly capturedGrants: CapturedConnectorGrant[];
}

/**
 * Delete one account through the A2.3 atomic cascade. Connector grants are
 * captured before and revoked only after a committed receipt — a rolled-back
 * attempt must not revoke grants of an account that still exists.
 */
export const deleteAccountAtomically = async (input: {
  readonly userId: string;
  readonly actorId: string;
  readonly handlerId: 'self_account' | 'admin_account';
  readonly workspaceId?: string | null;
}): Promise<AccountDeletionOutcome> => {
  const capturedGrants = await captureConnectorGrantsForTeardown({
    userId: input.userId,
    ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
  });
  const { createDeletion } = getCmIdentity();
  const deletion = createDeletion(appBusinessDeletion(capturedGrants, input.handlerId));
  const receipt = await deletion.deletePerson({
    userId: input.userId,
    actorId: input.actorId,
    handlerId: input.handlerId,
    operationId: randomUUID(),
  });
  if (receipt.transaction === 'committed') {
    await revokeCapturedConnectorGrants(capturedGrants);
  }
  return { receipt, capturedGrants };
};
