import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { CacheObject, CachePorts } from './cache';
import { sha256 } from './integrity';
import { LiveError } from './records';

export interface PrivateCacheBlobs {
  put(key: string, bytes: Uint8Array): Promise<void>;
  get(key: string): Promise<Uint8Array | undefined>;
  delete(key: string): Promise<void>;
}
const namespace = 'artifact-dependency-cache/v1';
function prefix(key: string) {
  if (!/^[a-f0-9]{64}\/[a-f0-9]{64}$/.test(key)) throw new LiveError('dependency_cache_invalid');
  return `dependency-cache/v1/${key}/`;
}
/** Private cache bucket/credentials stay at the host. Only complete immutable objects get a pointer. */
export function createPostgresCacheStorage(pool: Pool, blobs: PrivateCacheBlobs): CachePorts['storage'] {
  async function read(key: string): Promise<CacheObject | undefined> {
    const root = prefix(key);
    const { rows } = await pool.query<{ value: string }>(
      'SELECT value FROM control.artifact_host_kv WHERE storage_scope_id=$1 AND key=$2', [namespace, key]);
    if (!rows[0]) return;
    try {
      const pointer = JSON.parse(rows[0].value) as { objectRef: string; sha256: string };
      if (!pointer.objectRef.startsWith(root) || !/^[a-f0-9-]{36}$/.test(pointer.objectRef.slice(root.length))) throw new Error();
      const bytes = await blobs.get(pointer.objectRef);
      if (!bytes || sha256(bytes) !== pointer.sha256) throw new Error();
      return JSON.parse(Buffer.from(bytes).toString('utf8')) as CacheObject;
    } catch { throw new LiveError('dependency_cache_invalid'); }
  }
  return {
    read,
    async admit(key, object) {
      const objectRef = prefix(key) + randomUUID();
      const bytes = Buffer.from(JSON.stringify(object));
      await blobs.put(objectRef, bytes);
      const inserted = await pool.query(`INSERT INTO control.artifact_host_kv (storage_scope_id,key,value)
        VALUES ($1,$2,$3) ON CONFLICT (storage_scope_id,key) DO NOTHING RETURNING key`,
      [namespace, key, JSON.stringify({ objectRef, sha256: sha256(bytes) })]);
      if (!inserted.rows.length) await blobs.delete(objectRef);
      const winner = await read(key);
      if (!winner) throw new LiveError('dependency_cache_invalid');
      return winner;
    },
    async quarantine(key) {
      prefix(key);
      // Keep quarantined bytes private for diagnosis; an incomplete/invalid entry is never mountable.
      await pool.query('DELETE FROM control.artifact_host_kv WHERE storage_scope_id=$1 AND key=$2', [namespace, key]);
    },
  };
}
