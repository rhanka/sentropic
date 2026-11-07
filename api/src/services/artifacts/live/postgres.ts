import type { Pool } from 'pg';
import type { LiveStore } from './ports';
import type { LiveKey, LiveState } from './records';

const namespace = 'artifact-live-runtime/v1';
const rowKey = (key: LiveKey) => JSON.stringify([key.storageScopeId, key.artifactId]);
/** Uses the existing host KV migration, not publication blobs or release profile metadata. */
export function createPostgresLiveStore(pool: Pool): LiveStore {
  return {
    async read(key) {
      const { rows } = await pool.query<{ value: string }>(
        'SELECT value FROM control.artifact_host_kv WHERE storage_scope_id=$1 AND key=$2',
        [namespace, rowKey(key)]);
      return rows[0] ? JSON.parse(rows[0].value) as LiveState : undefined;
    },
    async transaction(key, work) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [namespace + rowKey(key)]);
        const { rows } = await client.query<{ value: string }>(
          'SELECT value FROM control.artifact_host_kv WHERE storage_scope_id=$1 AND key=$2 FOR UPDATE',
          [namespace, rowKey(key)]);
        const unit = { state: rows[0] ? JSON.parse(rows[0].value) as LiveState : undefined,
          save(state: LiveState) { unit.state = state; }, client };
        if (unit.state) unit.state.runtime.rowVersion++;
        const result = await work(unit);
        if (unit.state) {
          await client.query(`INSERT INTO control.artifact_host_kv (storage_scope_id, key, value) VALUES ($1,$2,$3)
            ON CONFLICT (storage_scope_id,key) DO UPDATE SET value=EXCLUDED.value`,
          [namespace, rowKey(key), JSON.stringify(unit.state)]);
        }
        await client.query('COMMIT');
        return result;
      } catch (error) { await client.query('ROLLBACK'); throw error; }
      finally { client.release(); }
    },
  };
}
