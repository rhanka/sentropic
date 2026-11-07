import type { Pool, PoolClient } from 'pg';
import type { LiveStore } from './ports';
import type { LiveKey, LiveState } from './records';
import type { BuildJobRecord, RecordStore } from './build-jobs';

const namespace = 'artifact-live-runtime/v1';
const jobNamespace = 'artifact-build-jobs/v1';
const rowKey = (key: LiveKey) => JSON.stringify([key.storageScopeId, key.artifactId]);
const SELECT = 'SELECT value FROM control.artifact_host_kv WHERE storage_scope_id=$1 AND key=$2';

async function readRow<T>(pool: Pool, space: string, key: string) {
  const { rows } = await pool.query<{ value: string }>(SELECT, [space, key]);
  return rows[0] ? JSON.parse(rows[0].value) as T : undefined;
}
/** One serialized read-modify-write of a host KV row: advisory lock, row lock, upsert, all in one transaction. */
async function lockedRow<V, T>(pool: Pool, space: string, key: string,
  work: (value: V | undefined, client: PoolClient) => Promise<{ value?: V; result: T }>) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [space + key]);
    const { rows } = await client.query<{ value: string }>(`${SELECT} FOR UPDATE`, [space, key]);
    const { value, result } = await work(rows[0] ? JSON.parse(rows[0].value) as V : undefined, client);
    if (value !== undefined) {
      await client.query(`INSERT INTO control.artifact_host_kv (storage_scope_id, key, value) VALUES ($1,$2,$3)
        ON CONFLICT (storage_scope_id,key) DO UPDATE SET value=EXCLUDED.value`, [space, key, JSON.stringify(value)]);
    }
    await client.query('COMMIT');
    return result;
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
/** Uses the existing host KV migration, not publication blobs or release profile metadata. */
export function createPostgresLiveStore(pool: Pool): LiveStore {
  return {
    read: key => readRow<LiveState>(pool, namespace, rowKey(key)),
    async active() {
      const { rows } = await pool.query<{ key: string; value: string }>(
        'SELECT key, value FROM control.artifact_host_kv WHERE storage_scope_id=$1', [namespace]);
      return rows.flatMap(row => {
        const { runtime } = JSON.parse(row.value) as LiveState;
        const [storageScopeId, artifactId] = JSON.parse(row.key) as [string, string];
        return runtime.phase === 'DORMANT' ? [] : [{ key: { storageScopeId, artifactId }, ownerId: runtime.ownerId }];
      });
    },
    transaction<T>(key: LiveKey, work: Parameters<LiveStore['transaction']>[1]) {
      return lockedRow<LiveState, T>(pool, namespace, rowKey(key), async (state, client) => {
        const unit = { state, save(next: LiveState) { unit.state = next; }, client };
        if (unit.state) unit.state.runtime.rowVersion++;
        const result = await work(unit) as T;
        return { value: unit.state, result };
      });
    },
  };
}
/** The builder job ledger of the host build API, in the same host KV. */
export function createPostgresBuildJobStore(pool: Pool): RecordStore {
  return {
    read: id => readRow<BuildJobRecord>(pool, jobNamespace, id),
    update: (id, change) => lockedRow(pool, jobNamespace, id, async (current: BuildJobRecord | undefined) => {
      const { next, result } = change(current);
      return { value: next, result };
    }),
  };
}
