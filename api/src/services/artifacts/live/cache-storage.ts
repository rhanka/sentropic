import { randomUUID } from 'node:crypto';
import { S3Client } from '@aws-sdk/client-s3';
import type { Pool } from 'pg';
import type { CacheObject, CachePorts } from './cache';
import { createPrivateArtifactStorage } from '../lifecycle';
import { sha256 } from './integrity';
import { LiveError } from './records';

export interface PrivateCacheBlobs {
  put(key: string, bytes: Uint8Array): Promise<void>;
  get(key: string): Promise<Uint8Array | undefined>;
  delete(key: string): Promise<void>;
}

/** Own dependency-cache storage of the builder (F1 option (a), s-archi review of #951): a dedicated private S3 bucket
 * with its own credentials, independent of the sentropic artifact host, so `APP_ARTIFACT_HOST_ENABLED` (the
 * artifacts MCP host) is never required to run the builder. Names only; values live in the environment secret. */
export const CACHE_S3_BUCKET_ENV = 'ARTIFACT_BUILDER_CACHE_S3_BUCKET';
export const CACHE_S3_REGION_ENV = 'ARTIFACT_BUILDER_CACHE_S3_REGION';
export const CACHE_S3_ACCESS_KEY_ID_ENV = 'ARTIFACT_BUILDER_CACHE_S3_ACCESS_KEY_ID';
export const CACHE_S3_SECRET_ACCESS_KEY_ENV = 'ARTIFACT_BUILDER_CACHE_S3_SECRET_ACCESS_KEY';
/** Optional S3-compatible endpoint (MinIO test); sets forcePathStyle exactly like the artifact host storage. */
export const CACHE_S3_ENDPOINT_ENV = 'ARTIFACT_BUILDER_CACHE_S3_ENDPOINT';
export interface BuilderCacheStorage { bucket: string; region: string; accessKeyId: string; secretAccessKey: string; endpoint?: string }

/** Validated cache storage of the builder, or the name of the first missing variable in fixed order (never its value). */
export function readBuilderCacheStorage(env: Readonly<Record<string, string | undefined>>): BuilderCacheStorage | string {
  const bucket = env[CACHE_S3_BUCKET_ENV]?.trim();
  if (!bucket) return CACHE_S3_BUCKET_ENV;
  const region = env[CACHE_S3_REGION_ENV]?.trim();
  if (!region) return CACHE_S3_REGION_ENV;
  const accessKeyId = env[CACHE_S3_ACCESS_KEY_ID_ENV]?.trim();
  if (!accessKeyId) return CACHE_S3_ACCESS_KEY_ID_ENV;
  const secretAccessKey = env[CACHE_S3_SECRET_ACCESS_KEY_ENV]?.trim();
  if (!secretAccessKey) return CACHE_S3_SECRET_ACCESS_KEY_ENV;
  const endpoint = env[CACHE_S3_ENDPOINT_ENV]?.trim() ?? '';
  return { bucket, region, accessKeyId, secretAccessKey, ...(endpoint ? { endpoint } : {}) };
}

/** Private cache bucket/credentials stay at the host. The storage opens lazily on first use, and a failed open
 * resets so the next use retries; the same private-object contract as the artifact host storage (`lifecycle.ts`). */
export function builderCacheBlobs(settings: BuilderCacheStorage): PrivateCacheBlobs {
  let storage: ReturnType<typeof createPrivateArtifactStorage> | undefined;
  function open() {
    if (!storage) {
      const client: S3Client = settings.endpoint
        ? new S3Client({ region: settings.region, endpoint: settings.endpoint, forcePathStyle: true,
          credentials: { accessKeyId: settings.accessKeyId, secretAccessKey: settings.secretAccessKey } })
        : new S3Client({ region: settings.region,
          credentials: { accessKeyId: settings.accessKeyId, secretAccessKey: settings.secretAccessKey } });
      storage = createPrivateArtifactStorage({ bucket: settings.bucket, client })
        .catch(error => { storage = undefined; throw error; });
    }
    return storage;
  }
  return {
    put: async (key, bytes) => (await open()).blobs.putBlob(key, bytes),
    get: async key => (await open()).blobs.getBlob(key),
    delete: async key => (await open()).blobs.deleteBlob(key),
  };
}
const namespace = 'artifact-dependency-cache/v1';
function prefix(key: string) {
  if (!/^[a-f0-9]{64}\/[a-f0-9]{64}$/.test(key)) throw new LiveError('dependency_cache_invalid');
  return `dependency-cache/v1/${key}/`;
}
/** One immutable object per distinct file, named by the sha256 of its bytes and shared by every cache entry. */
function fileRef(digest: string) {
  if (!/^[a-f0-9]{64}$/.test(digest)) throw new LiveError('dependency_cache_invalid');
  return `dependency-cache/v1/files/${digest}`;
}
/** Private cache bucket/credentials stay at the host. Only complete immutable manifests get a pointer; file objects are
 * written as the install streams and stay invisible until a manifest naming them is admitted. */
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
    putFile: async (digest, bytes) => blobs.put(fileRef(digest), bytes),
    getFile: async digest => blobs.get(fileRef(digest)),
    async quarantine(key) {
      prefix(key);
      // Keep quarantined bytes private for diagnosis; an incomplete/invalid entry is never mountable.
      await pool.query('DELETE FROM control.artifact_host_kv WHERE storage_scope_id=$1 AND key=$2', [namespace, key]);
    },
  };
}
