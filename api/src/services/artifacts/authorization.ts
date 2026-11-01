import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { ArtifactPolicyDriver, AuthorizeCommit, CommitPolicyParticipantFactory,
  FinalizeTxClient } from '@sentropic/artifacts/server/commit-contract';

/** Supplied only by verified HTTP/MCP authentication, never request/tool arguments. */
export interface ArtifactHostIdentity {
  readonly subject: string;
  readonly tenantId: string;
  readonly clientId: string;
  readonly credentialId: string;
}

/** Revalidate the whole verified credential tuple, scopes and expiry using DB time.
 * Lock its current authority rows on this transaction; never cache an admission.
 * The transport owner supplies its session/token adapter, not a caller callback.
 */
export type CurrentArtifactIdentity = (client: FinalizeTxClient, identity: ArtifactHostIdentity) =>
  Promise<{ readonly readable: boolean; readonly writable: boolean }>;

export function artifactReadClient(pool: Pool | PoolClient): FinalizeTxClient {
  return { async query<T>(sql: string, params: readonly unknown[]) {
    const result = await pool.query(sql, [...params]);
    return { rows: result.rows as T[], rowCount: result.rowCount ?? 0 };
  } };
}

export function createArtifactAuthorization(options: {
  identity: ArtifactHostIdentity; workspaceId: string; storageScopeId: string;
  pool: Pool; currentIdentity: CurrentArtifactIdentity;
}) {
  const { identity, workspaceId, storageScopeId } = options;
  const read = async (client: FinalizeTxClient, lock = false) => {
    const { rows } = await client.query<{ revision: string; role: string; approved: boolean }>(
      `SELECT concat_ws(':', u.xmin, p.xmin, t.xmin, tm.xmin, cw.xmin, w.xmin, wm.xmin) AS revision, wm.role,
        (u.account_status = 'active' AND p.disabled_at IS NULL AND t.status = 'active'
          AND tm.status = 'approved' AND w.hidden_at IS NULL) AS approved
       FROM workspaces w
       JOIN cm_identity.cm_workspaces cw ON cw.workspace_id = w.id
       JOIN cm_identity.cm_workspace_members wm ON wm.workspace_id = cw.workspace_id AND wm.user_id = $1
       JOIN cm_identity.cm_tenant_memberships tm ON tm.tenant_id = cw.tenant_id AND tm.user_id = wm.user_id
       JOIN cm_identity.cm_tenants t ON t.tenant_id = tm.tenant_id
       JOIN cm_identity.identity_user_accounts u ON u.user_id = wm.user_id
       JOIN cm_identity.identity_account_profiles p ON p.user_id = u.user_id
       WHERE w.id = $2 AND cw.tenant_id = $3 ${lock ? 'FOR SHARE OF u, p, t, tm, cw, w, wm' : ''}`,
      [identity.subject, workspaceId, identity.tenantId],
    );
    const row = rows[0];
    // Credential locks precede quota waits; this is also re-read after every wait.
    const credential = await options.currentIdentity(client, identity);
    return { revision: createHash('sha256').update(row?.revision ?? 'missing').digest('hex'),
      readable: !!row?.approved && credential.readable === true && ['viewer', 'commenter', 'editor', 'admin'].includes(row.role),
      writable: !!row?.approved && credential.readable === true && credential.writable === true
        && ['editor', 'admin'].includes(row.role) };
  };
  const current = () => read(artifactReadClient(options.pool));
  const policy: CommitPolicyParticipantFactory = {
    createParticipant(client, transactionId): ArtifactPolicyDriver {
      return {
        readRevision: async () => (await read(client, true)).revision,
        async checkApproval(input) {
          const authority = await read(client, true);
          return { approved: input.actorId === identity.subject && ['ensure', 'publish'].includes(input.operation)
            && authority.writable, reason: 'revoked' };
        },
        async reserveQuota(input) {
          if (input.actorId !== identity.subject || input.storageScopeId !== storageScopeId ||
            !['ensure', 'publish'].includes(input.operation) || !Number.isSafeInteger(input.bytes) || input.bytes < 0) {
            return { reserved: false };
          }
          // Cumulative decoded publication bytes; provisional charges roll back with the unit.
          // A replay does not enter this method. Maintenance owns any deliberate quota adjustment.
          const result = await client.query(
            `UPDATE control.artifact_host_kv SET value = jsonb_set(value::jsonb, '{usedBytes}',
               to_jsonb((value::jsonb->>'usedBytes')::bigint + $2::bigint))::text
             WHERE storage_scope_id = $1 AND key = 'quota/v1'
               AND (value::jsonb->>'usedBytes')::bigint >= 0
               AND (value::jsonb->>'usedBytes')::bigint + $2::bigint <= (value::jsonb->>'maxBytes')::bigint`,
            [storageScopeId, input.bytes],
          );
          return { reserved: result.rowCount === 1 };
        },
        mintFence: (policyRevision, invocationId) => ({ fenceId: randomUUID(), transactionId, invocationId, policyRevision }),
      };
    },
  };
  const guard: AuthorizeCommit = async (context, transaction) => {
    const denied = { allowed: false, reason: 'revoked', status: 403,
      publicCode: 'access_denied', retriable: false } as const;
    if (context.actorId !== identity.subject || context.storageScopeId !== storageScopeId ||
      context.invocationId !== transaction.invocationId) return denied;
    const revision = await transaction.participant.readRevision();
    const admission = await transaction.participant.checkApproval({ actorId: context.actorId, operation: context.operation });
    if (!admission.approved || revision !== context.policyRevision) return denied;
    return { allowed: true, fence: transaction.participant.mintFence(revision, context.invocationId) };
  };
  return { current, currentOn: (client: FinalizeTxClient) => read(client, true), policy, guard };
}
