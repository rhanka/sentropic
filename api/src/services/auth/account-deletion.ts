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

