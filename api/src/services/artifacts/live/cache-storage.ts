import { randomUUID } from 'node:crypto';
import { DeleteObjectCommand, GetObjectCommand, GetPublicAccessBlockCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { Pool } from 'pg';
import type { CacheObject, CachePorts } from './cache';
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

/** Object-key namespace of the builder dependency cache (s-conductor decision, « F1 names »): every S3 object key
 * this module reads or writes starts with exactly this prefix, and the store below refuses any key outside it. */
const CACHE_KEY_PREFIX = 'artifact-builder-cache/v1/';
/** Content-addressed file objects shared by every cache entry: `files/<sha256>` under the prefix. */
const CACHE_FILE = /^files\/[a-f0-9]{64}$/;
/** Admitted manifest objects: `<lockSha>/<keySha>/<uuid>` under the prefix. */
const CACHE_MANIFEST = /^[a-f0-9]{64}\/[a-f0-9]{64}\/[0-9a-f-]{36}$/;
/** Own key discipline of the builder-cache store: only the two cache shapes above, refused before any S3 call. */
function assertCacheKey(key: string): void {
  const suffix = key.startsWith(CACHE_KEY_PREFIX) ? key.slice(CACHE_KEY_PREFIX.length) : undefined;
  if (suffix === undefined || !(CACHE_FILE.test(suffix) || CACHE_MANIFEST.test(suffix))) {
    throw new Error(`invalid builder-cache key (must be ${CACHE_KEY_PREFIX}files/<sha256> or `
      + `${CACHE_KEY_PREFIX}<lockSha>/<keySha>/<uuid>)`);
  }
}

/** Dedicated private blob store of the builder dependency cache: S3 directly, never the sentropic artifacts host
 * adapter. Put/get/delete only — the store cannot list at all, so nothing is ever listed outside the prefix, and
 * every delete is key-checked first. Like the artifact host writer (`lifecycle.ts`) it fails closed on a non-private
 * bucket: every effect requires a positive public-access-block check (all four blocks true), positively cached 30 s
 * with one shared in-flight check and no negative caching; an unavailable check refuses the effect. */
export function createBuilderCacheBlobs(options: { bucket: string; client: S3Client }): PrivateCacheBlobs {
  const { client, bucket } = options;
  let privateUntil = 0;
  let checking: Promise<void> | undefined;
  async function assertPrivate() {
    if (Date.now() < privateUntil) return;
    checking ??= (async () => {
      const { PublicAccessBlockConfiguration: config } = await client.send(new GetPublicAccessBlockCommand({ Bucket: bucket }));
      if (!config || !['BlockPublicAcls', 'IgnorePublicAcls', 'BlockPublicPolicy', 'RestrictPublicBuckets']
        .every(field => config[field as keyof typeof config] === true)) throw new Error('Builder cache bucket must remain private');
      privateUntil = Date.now() + 30000;
    })().finally(() => { checking = undefined; });
    await checking;
  }
  return {
    async put(key, bytes) {
      assertCacheKey(key);
      await assertPrivate();
      await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: bytes }));
    },
    async get(key) {
      assertCacheKey(key);
      await assertPrivate();
      try {
        const out = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        if (out.Body === undefined) return undefined;
        return new Uint8Array(await out.Body.transformToByteArray());
      } catch (error) {
        if (typeof error === 'object' && error !== null && 'name' in error) {
          const name = (error as { name?: unknown }).name;
          if (name === 'NoSuchKey' || name === 'NotFound') return undefined;
        }
        throw error;
      }
    },
    async delete(key) {
      assertCacheKey(key);
      await assertPrivate();
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
  };
}

/** Private cache bucket/credentials stay at the host. The S3 client (endpoint applied with `forcePathStyle`, exactly
 * like the artifact host writer) opens lazily on first use, and a failed privacy check resets so the next use retries. */
export function builderCacheBlobs(settings: BuilderCacheStorage): PrivateCacheBlobs {
  let blobs: PrivateCacheBlobs | undefined;
  function open() {
    blobs ??= createBuilderCacheBlobs({ bucket: settings.bucket, client: settings.endpoint
      ? new S3Client({ region: settings.region, endpoint: settings.endpoint, forcePathStyle: true,
        credentials: { accessKeyId: settings.accessKeyId, secretAccessKey: settings.secretAccessKey } })
      : new S3Client({ region: settings.region,
        credentials: { accessKeyId: settings.accessKeyId, secretAccessKey: settings.secretAccessKey } }) });
    return blobs;
  }
  return {
    put: async (key, bytes) => open().put(key, bytes),
    get: async key => open().get(key),
    delete: async key => open().delete(key),
  };
}
/** Postgres pointer namespace (unchanged, s-conductor decision): only the S3 object keys moved under the prefix. */
const namespace = 'artifact-dependency-cache/v1';
/** Manifest object keys: `artifact-builder-cache/v1/<lockSha>/<keySha>/` + one fresh uuid per admission. */
function prefix(key: string) {
  if (!/^[a-f0-9]{64}\/[a-f0-9]{64}$/.test(key)) throw new LiveError('dependency_cache_invalid');
  return `${CACHE_KEY_PREFIX}${key}/`;
}
/** One immutable object per distinct file, named by the sha256 of its bytes and shared by every cache entry. */
function fileRef(digest: string) {
  if (!/^[a-f0-9]{64}$/.test(digest)) throw new LiveError('dependency_cache_invalid');
  return `${CACHE_KEY_PREFIX}files/${digest}`;
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
