import {
  IdentityCustodyErrorV1,
  IdentityNotFoundError,
  type ConnectorRevocationCustodyPortV1,
  type IdentityExternalRevocationDraftV1,
  type WorkspaceBusinessDeletionPortV1,
  type WorkspaceDeletionAuthorizationPortV1,
  type WorkspaceDeletionCommandV1,
  type WorkspaceDeletionPlanePortV1,
} from '@sentropic/cluster-mesh';
import type { PoolClient } from 'pg';

import type { ConnectorSourceScope } from './cm-connector-custody';
import { deleteCmBusinessWorkspaces } from './cm-deletion-workspaces';
import { identityDeliveryId } from './cm-delivery-record';
import type { CmIdentityTransaction } from './cm-transaction';

/**
 * App business/plane ports for standalone workspace deletion
 * (a4-cm-gaps-r2 §10.7 series 4, P5 `createAtomicWorkspaceDeletionV1`).
 *
 * Authorization re-reads the hidden state on the host transaction; CM never
 * reads `public.workspaces.hidden_at` itself. Business reuses
 * `deleteCmBusinessWorkspaces`, with one owner-decided disposition on top
 * (Q-WS1: standalone workspace chats are deleted with the workspace, while
 * person deletion detaches them — the shared helper is untouched). The
 * connector plane is workspace-scoped, adapted from the person plane: it
 * inventories every connector row in the workspace, whatever the row owner.
 */

interface WorkspaceAttempt {
  readonly command: WorkspaceDeletionCommandV1;
  readonly sources: Map<string, ConnectorSourceScope>;
  readonly drafts: Map<string, IdentityExternalRevocationDraftV1>;
}

const invalid = (): never => { throw new IdentityCustodyErrorV1('identity_revocation_custody_invalid'); };

export const cmWorkspaceDeletionAuthorization: WorkspaceDeletionAuthorizationPortV1<PoolClient> = {
  async assertAllowed(command, tx) {
    const rows = await tx.hostTransaction.query<{ hidden_at: string | null }>(
      `SELECT hidden_at FROM public.workspaces WHERE id = $1`, [command.workspaceId]);
    const row = rows.rows[0];
    if (!row) throw new IdentityNotFoundError('workspace', command.workspaceId);
    if (row.hidden_at === null) throw new IdentityCustodyErrorV1('identity_material_invalid');
  },
};

const sumCounts = (into: Record<string, number>, extra: Readonly<Record<string, number>>): void => {
  for (const [table, count] of Object.entries(extra)) into[table] = (into[table] ?? 0) + count;
};

export const cmWorkspaceDeletionBusiness: WorkspaceBusinessDeletionPortV1<PoolClient> = {
  async deleteWorkspaceRows(workspaceId, tx) {
    const deletedByTable: Record<string, number> = {};
    const detachedByTable: Record<string, number> = {};
    // Q-WS1: workspace chats are deleted with the workspace. Session deletes
    // cascade to messages, stream events, contexts, traces and feedback.
    for (const table of ['chat_generation_traces', 'chat_sessions'] as const) {
      const removed = await tx.hostTransaction.query(
        `DELETE FROM public."${table}" WHERE workspace_id = $1`, [workspaceId]);
      deletedByTable[table] = removed.rowCount ?? 0;
    }
    const rest = await deleteCmBusinessWorkspaces([workspaceId], tx);
    sumCounts(deletedByTable, rest.deletedByTable);
    sumCounts(detachedByTable, rest.detachedByTable);
    return { deletedByTable, detachedByTable };
  },
  async assertNoWorkspaceOrphans(workspaceId, tx) {
    const workspace = await tx.hostTransaction.query(
      `SELECT 1 FROM public.workspaces WHERE id = $1 LIMIT 1`, [workspaceId]);
    if (workspace.rows.length) throw new IdentityCustodyErrorV1('identity_material_invalid');
    for (const table of ['chat_sessions', 'chat_generation_traces'] as const) {
      const remaining = await tx.hostTransaction.query(
        `SELECT 1 FROM public."${table}" WHERE workspace_id = $1 LIMIT 1`, [workspaceId]);
      if (remaining.rows.length) throw new IdentityCustodyErrorV1('identity_material_invalid');
    }
  },
};

const STEP = 'connector_grants';

const matches = (attempt: WorkspaceAttempt | undefined, command: WorkspaceDeletionCommandV1): boolean =>
  !!attempt && attempt.command.operationId === command.operationId
  && attempt.command.workspaceId === command.workspaceId && attempt.command.actorId === command.actorId;

/** Workspace-scoped connector plane; placement is always present. */
export function createCmWorkspaceDeletionConnectorPlane(
  custody: ConnectorRevocationCustodyPortV1<PoolClient>,
  attempts: WeakMap<CmIdentityTransaction, WorkspaceAttempt>,
): WorkspaceDeletionPlanePortV1<PoolClient> {
  return {
    placement: 'present',
    async listConnectorOwners(command, tx) {
      const result = await tx.hostTransaction.query<{ user_id: string }>(
        `SELECT DISTINCT user_id FROM public.document_connector_accounts WHERE workspace_id = $1 ORDER BY user_id COLLATE "C"`,
        [command.workspaceId]);
      return result.rows.map(row => String(row.user_id));
    },
    async apply(command, tx) {
      const attempt: WorkspaceAttempt = { command, sources: new Map(), drafts: new Map() };
      attempts.set(tx, attempt);
      const result = await tx.hostTransaction.query<{
        id: string; user_id: string; workspace_id: string; provider: string;
      }>(`SELECT id, user_id, workspace_id, provider FROM public.document_connector_accounts
        WHERE workspace_id = $1 ORDER BY id COLLATE "C" FOR UPDATE`, [command.workspaceId]);
      for (const row of result.rows) {
        attempt.sources.set(row.id, {
          id: row.id, userId: row.user_id, workspaceId: row.workspace_id, provider: row.provider,
        });
      }
      const at = new Date().toISOString();
      for (const source of attempt.sources.values()) {
        const deliveryId = identityDeliveryId(command.operationId, STEP, 'connector_grant', source.id);
        const captured = await custody.capture({
          deliveryId, connectorAccountId: source.id, subjectId: source.userId,
          workspaceIdsToDelete: [command.workspaceId], at,
        }, tx);
        if (captured.kind === 'no_capability') continue;
        attempt.drafts.set(source.id, {
          step: STEP, subjectId: source.userId, targetKind: 'connector_grant',
          targetRef: source.id, custodyRef: captured.reference.custodyRef,
        });
      }
      return [...attempt.drafts.values()];
    },
    async assertDeliveryInScope(command, draft, tx) {
      const attempt = attempts.get(tx);
      if (!matches(attempt, command)) throw new IdentityCustodyErrorV1('identity_transaction_unbound');
      const expected = attempt!.drafts.get(draft.targetRef);
      if (!expected || draft.step !== expected.step || draft.targetKind !== expected.targetKind
        || draft.subjectId !== expected.subjectId || draft.custodyRef !== expected.custodyRef) invalid();
    },
    async assertAbsent(command, tx) {
      const remaining = await tx.hostTransaction.query(
        `SELECT 1 FROM public.document_connector_accounts WHERE workspace_id = $1 LIMIT 1`, [command.workspaceId]);
      if (remaining.rows.length) throw new IdentityCustodyErrorV1('identity_cascade_participant_missing');
    },
  };
};
