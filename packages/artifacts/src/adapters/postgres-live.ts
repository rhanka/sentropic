import type { Pool } from 'pg';
import { ArtifactOperationError } from '../server/failures.js';
import { liveIdentityKey, type LiveStore, type LiveTransaction } from '../server/live-store.js';

/** No import-time I/O. PostgreSQL owns lease serialization, private objects and replay durability. */
export function createPostgresLiveStore(pool: Pool): LiveStore {
  return { async transaction(identity, action) {
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
          if (counts.rows[0].principal >= 30 || counts.rows[0].artifact >= 60) throw new ArtifactOperationError('limit_exceeded');
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
      const result = await action(tx);
      if (tx.record) {
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
