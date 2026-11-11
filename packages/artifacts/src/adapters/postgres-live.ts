import type { Pool, PoolClient } from 'pg';
import { ArtifactOperationError } from '../server/failures.js';
import { liveIdentityKey, type LiveIdentity, type LiveInvitationLedger, type LiveStore,
  type LiveTransaction } from '../server/live-store.js';

const INVITATION_COLUMNS = `storage_scope_id,artifact_id,binding_generation,live_session_id,invitation_id,principal_id,
  created_by,status,epoch,expires_at,accepted_at,revoked_at,created_at,row_version`;
const iso = (value: Date | string | null) => value === null ? null : new Date(value).toISOString();
/** Live invitations (migration 0013) under the transaction's advisory lock on the artifact. */
function postgresInvitations(client: PoolClient, identity: LiveIdentity): LiveInvitationLedger {
  const own = [identity.storageScopeId, identity.artifactId];
  return {
    async list() {
      const result = await client.query(`SELECT ${INVITATION_COLUMNS} FROM artifacts.live_invitations
        WHERE storage_scope_id=$1 AND artifact_id=$2`, own);
      return result.rows.map(row => ({ storageScopeId: row.storage_scope_id, artifactId: row.artifact_id,
        bindingGeneration: Number(row.binding_generation), liveSessionId: row.live_session_id, invitationId: row.invitation_id,
        principalId: row.principal_id, createdBy: row.created_by, status: row.status, epoch: Number(row.epoch),
        expiresAt: iso(row.expires_at)!, acceptedAt: iso(row.accepted_at), revokedAt: iso(row.revoked_at),
        createdAt: iso(row.created_at)!, rowVersion: Number(row.row_version) }));
    },
    async save(row) {
      if (row.storageScopeId !== identity.storageScopeId || row.artifactId !== identity.artifactId) throw new ArtifactOperationError('access_denied');
      const result = row.rowVersion === 1 ? await client.query(`INSERT INTO artifacts.live_invitations (${INVITATION_COLUMNS})
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) ON CONFLICT DO NOTHING`, [...own, row.bindingGeneration,
        row.liveSessionId, row.invitationId, row.principalId, row.createdBy, row.status, row.epoch, row.expiresAt,
        row.acceptedAt, row.revokedAt, row.createdAt, row.rowVersion])
        : await client.query(`UPDATE artifacts.live_invitations SET status=$4, epoch=$5, accepted_at=$6, revoked_at=$7,
          row_version=$8 WHERE storage_scope_id=$1 AND artifact_id=$2 AND invitation_id=$3 AND row_version=$9`,
        [...own, row.invitationId, row.status, row.epoch, row.acceptedAt, row.revokedAt, row.rowVersion, row.rowVersion - 1]);
      if (!result.rowCount) throw new ArtifactOperationError('git_live_conflict',
        { publicDetails: { reason: row.rowVersion === 1 ? 'active_session' : 'stale_fence' } });
    },
    async epoch(generation, session) {
      const result = await client.query(`SELECT epoch FROM artifacts.live_invitation_epochs WHERE storage_scope_id=$1
        AND artifact_id=$2 AND binding_generation=$3 AND live_session_id=$4`, [...own, generation, session]);
      return result.rows[0] ? Number(result.rows[0].epoch) : 0;
    },
    async setEpoch(generation, session, epoch) {
      await client.query(`INSERT INTO artifacts.live_invitation_epochs
        (storage_scope_id,artifact_id,binding_generation,live_session_id,epoch) VALUES ($1,$2,$3,$4,$5)
        ON CONFLICT (storage_scope_id,artifact_id,binding_generation,live_session_id) DO UPDATE SET epoch=EXCLUDED.epoch`,
      [...own, generation, session, epoch]);
    },
  };
}

/** No import-time I/O. PostgreSQL owns lease serialization, private objects and replay durability. */
export function createPostgresLiveStore(pool: Pool): LiveStore {
  return {
    async sessionIdentity(scope, artifactId, sessionId) {
      const result = await pool.query(`SELECT binding_generation FROM artifacts.live_drafts
        WHERE storage_scope_id=$1 AND artifact_id=$2 AND record #>> '{runtime,liveSessionId}'=$3`, [scope, artifactId, sessionId]);
      return result.rows[0] ? { storageScopeId: scope, artifactId, bindingGeneration: Number(result.rows[0].binding_generation) } : undefined;
    },
    async pending(scope, limit = 64) {
      const result = await pool.query(`SELECT artifact_id, binding_generation FROM artifacts.live_drafts
        WHERE storage_scope_id=$1 AND (record #>> '{runtime,phase}' IN ('REVIVING','QUIESCING','SAVING','DECOMMISSIONING')
          OR (record #>> '{runtime,phase}' = 'LIVE' AND record #>> '{runtime,appliedRevision}' IS DISTINCT FROM record ->> 'revision'))
        ORDER BY record #>> '{runtime,lastAccessAt}' LIMIT $2`, [scope, limit]);
      return result.rows.map(row => ({ storageScopeId: scope, artifactId: String(row.artifact_id),
        bindingGeneration: Number(row.binding_generation) }));
    },
    async transaction(identity, action) {
    const client = await pool.connect();
    const values = [identity.storageScopeId, identity.artifactId, identity.bindingGeneration];
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
        [JSON.stringify(['live', identity.storageScopeId, identity.artifactId])]);
      const before = await client.query(`SELECT record FROM artifacts.live_drafts
        WHERE storage_scope_id=$1 AND artifact_id=$2 AND binding_generation=$3 FOR UPDATE`, values);
      const tx: LiveTransaction = {
        record: before.rows[0]?.record,
        invitations: postgresInvitations(client, identity),
        async getObject(ref) {
          const result = await client.query(`SELECT envelope FROM artifacts.live_draft_objects
            WHERE storage_scope_id=$1 AND artifact_id=$2 AND binding_generation=$3 AND object_ref=$4`, [...values, ref]);
          return result.rows[0]?.envelope;
        },
        async putObject(ref, envelope) {
          await client.query(`INSERT INTO artifacts.live_draft_objects
            (storage_scope_id,artifact_id,binding_generation,object_ref,envelope) VALUES ($1,$2,$3,$4,$5)`,
          [...values, ref, JSON.stringify(envelope)]);
        },
        async collectObjects() {
          const result = await client.query(`DELETE FROM artifacts.live_draft_objects
            WHERE storage_scope_id=$1 AND artifact_id=$2 AND binding_generation=$3
            AND object_ref IS DISTINCT FROM $4::uuid`, [...values, tx.record?.objectRef ?? null]);
          return result.rowCount ?? 0;
        },
        async receipt(actor, key) {
          await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
            [JSON.stringify(['live-command', identity.storageScopeId, actor, key])]);
          const result = await client.query(`SELECT command_hash,result FROM artifacts.live_commands
            WHERE storage_scope_id=$1 AND actor_id=$2 AND command_key=$3`, [identity.storageScopeId, actor, key]);
          return result.rows[0] ? { hash: result.rows[0].command_hash, result: result.rows[0].result } : undefined;
        },
        async complete(command, result) {
          await client.query(`INSERT INTO artifacts.live_commands(storage_scope_id,actor_id,command_key,command_hash,result)
            VALUES ($1,$2,$3,$4,$5)`, [identity.storageScopeId, command.actorId, command.key, command.hash, JSON.stringify(result)]);
        },
        async reserveCommit(actor, invocation, now) {
          await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
            [JSON.stringify(['live-quota', identity.storageScopeId, actor])]);
          const prior = await client.query(`SELECT 1 FROM artifacts.live_commit_quota
            WHERE storage_scope_id=$1 AND actor_id=$2 AND invocation_id=$3`, [identity.storageScopeId, actor, invocation]);
          if (prior.rows.length) return;
          const counts = await client.query(`SELECT count(*) FILTER (WHERE actor_id=$2)::int AS principal,
            count(*) FILTER (WHERE artifact_id=$3)::int AS artifact FROM artifacts.live_commit_quota
            WHERE storage_scope_id=$1 AND created_at > $4::timestamptz - interval '1 hour'`,
          [identity.storageScopeId, actor, identity.artifactId, now]);
          if (counts.rows[0].principal >= 30 || counts.rows[0].artifact >= 60) throw new ArtifactOperationError('limit_exceeded',
            { publicDetails: { quota: 'git_write', scope: counts.rows[0].principal >= 30 ? 'principal' : 'artifact' } });
          await client.query(`INSERT INTO artifacts.live_commit_quota
            (storage_scope_id,actor_id,artifact_id,invocation_id,created_at) VALUES ($1,$2,$3,$4,$5)`,
          [identity.storageScopeId, actor, identity.artifactId, invocation, now]);
        },
        async advanceBinding(input) {
          const result = await client.query(`UPDATE artifacts.git_bindings SET head_commit_sha=$4,
            state='attached', version=version+1, updated_at=$5
            WHERE storage_scope_id=$1 AND artifact_id=$2 AND generation=$3 AND head_commit_sha=$6
            AND state='attached' RETURNING artifact_id`, [...values, input.commitSha, input.now, input.expectedHeadSha]);
          if (!result.rows.length) throw new ArtifactOperationError('git_live_conflict', { publicDetails: { reason: 'stale_fence' } });
          await client.query(`INSERT INTO artifacts.git_binding_events
            (storage_scope_id,artifact_id,actor_id,action,before_sha,after_sha,invocation_id,created_at)
            VALUES ($1,$2,$3,'commit',$4,$5,$6,$7)`, [identity.storageScopeId, identity.artifactId,
            input.actorId, input.expectedHeadSha, input.commitSha, input.invocationId, input.now]);
        },
      };
      const original = JSON.stringify(tx.record);
      const result = await action(tx);
      if (tx.record && JSON.stringify(tx.record) !== original) {
        tx.record.rowVersion = (before.rows[0]?.record?.rowVersion ?? 0) + 1;
        if (liveIdentityKey(tx.record) !== liveIdentityKey(identity)) throw new ArtifactOperationError('access_denied');
        await client.query(`INSERT INTO artifacts.live_drafts(storage_scope_id,artifact_id,binding_generation,record)
          VALUES ($1,$2,$3,$4) ON CONFLICT (storage_scope_id,artifact_id,binding_generation)
          DO UPDATE SET record=EXCLUDED.record`, [...values, JSON.stringify(tx.record)]);
      }
      await client.query('COMMIT');
      return result;
    } catch (cause) {
      await client.query('ROLLBACK').catch(() => undefined);
      if (cause instanceof ArtifactOperationError) throw cause;
      throw new ArtifactOperationError('git_live_draft_unavailable', { cause });
    } finally { client.release(); }
  } };
}
