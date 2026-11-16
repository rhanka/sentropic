import type { Pool } from 'pg';
import { GetPublicAccessBlockCommand, ListObjectsV2Command, type S3Client } from '@aws-sdk/client-s3';
import { createS3BlobStore } from '@sentropic/artifacts/adapters/s3';
import { createPostgresArtifactStore } from '@sentropic/artifacts/adapters/postgres';
import { createPostgresCommitExecutor } from '@sentropic/artifacts/adapters/postgres-commit';
import { createPostgresDeletionClaimStore, createPostgresGcService } from '@sentropic/artifacts/server/gc';
import { scheduleBoundedPreparationCleanup } from '@sentropic/artifacts/server/object-intents';
import type { PublicationBlobStore } from '@sentropic/artifacts/server/publication';
import { listBlobKeysPaged } from '@sentropic/artifacts/server/blob-bridge';

export interface ArtifactBlobPage { keys: string[]; cursor?: string }
export type ArtifactBlobPageReader = (prefix: string, limit: number, cursor?: string) => Promise<ArtifactBlobPage>;
/** Lazy host wrapper; initialization and privacy enforcement stay in the supplied factory. */
export function createLazyArtifactBlobs(load: () => Promise<{ blobs: PublicationBlobStore }>): PublicationBlobStore {
  return {
    putBlob: async (key, bytes) => (await load()).blobs.putBlob(key, bytes),
    getBlob: async key => (await load()).blobs.getBlob(key),
    getBlobRange: async (key, start, end) => {
      const blobs = (await load()).blobs;
      return blobs.getBlobRange ? blobs.getBlobRange(key, start, end) :
        (await blobs.getBlob(key))?.slice(start, end + 1);
    },
    deleteBlob: async (key, transaction) => (await load()).blobs.deleteBlob(key, transaction),
    listKeys: async prefix => (await load()).blobs.listKeys(prefix),
    listKeysPaged: async (prefix, page) => {
      const blobs = (await load()).blobs;
      if (!blobs.listKeysPaged) throw new Error('Bounded artifact object listing required');
      return blobs.listKeysPaged(prefix, page);
    },
  };
}
const blobKey = /^artifacts\/[A-Za-z0-9_-]+\/blobs\/sha256\/[0-9a-f]{64}$/;
function bound(limit: number): number {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw new Error('Invalid artifact maintenance bound');
  return limit;
}

/** Credentials and bucket are host-supplied; unsupported privacy checks fail closed. */
export async function createPrivateArtifactStorage(options: { client: S3Client; bucket: string }) {
  const { client, bucket } = options;
  if (!bucket) throw new Error('Private artifact bucket required');
  let privateUntil = 0;
  let checking: Promise<void> | undefined;
  async function assertPrivate() {
    if (Date.now() < privateUntil) return;
    // Bucket-scoped positive cache; concurrent expiry checks share one request. Failures are never cached.
    checking ??= (async () => {
      const { PublicAccessBlockConfiguration: config } = await client.send(new GetPublicAccessBlockCommand({ Bucket: bucket }));
      if (!config || !['BlockPublicAcls', 'IgnorePublicAcls', 'BlockPublicPolicy', 'RestrictPublicBuckets']
        .every(field => config[field as keyof typeof config] === true)) throw new Error('Artifact bucket must remain private');
      privateUntil = Date.now() + 30000;
    })().finally(() => { checking = undefined; });
    await checking;
  }
  await assertPrivate();
  const upstream = createS3BlobStore(options);
  const blobs: PublicationBlobStore = {
    async putBlob(key, bytes) { await assertPrivate(); await upstream.putBlob(key, bytes); },
    async getBlob(key) { await assertPrivate(); return upstream.getBlob(key); },
    async getBlobRange(key, start, end) { await assertPrivate(); return upstream.getBlobRange!(key, start, end); },
    async deleteBlob(key) { await assertPrivate(); await upstream.deleteBlob(key); },
    async listKeys(prefix) { await assertPrivate(); return upstream.listKeys(prefix); },
    async listKeysPaged(prefix, page) { await assertPrivate(); return upstream.listKeysPaged!(prefix, page); },
  };
  const page: ArtifactBlobPageReader = async (prefix, limit, cursor) => {
    bound(limit);
    if (!/^artifacts\/[A-Za-z0-9_-]+\/blobs\/sha256\/$/.test(prefix) && !blobKey.test(prefix)) {
      throw new Error('Invalid artifact collection prefix');
    }
    await assertPrivate();
    const result = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix,
      MaxKeys: limit, ContinuationToken: cursor }));
    if (result.IsTruncated && !result.NextContinuationToken) throw new Error('Incomplete artifact collection page');
    return { keys: (result.Contents ?? []).flatMap(entry => entry.Key === undefined ? [] : [entry.Key]),
      cursor: result.IsTruncated ? result.NextContinuationToken : undefined };
  };
  return { blobs, page };
}

/** Structural subset of UP-T #782's PostgresActivationStore. W1.c binds the published adapter. */
export interface ArtifactActivationMaintenance {
  cleanup(limit: number): Promise<{ flows: number; tickets: number }>;
  invalidate(): Promise<void>;
}

/** Internal host jobs only: no timers, public dispatch, migrations or memory defaults. */
export function createArtifactHostJobs(options: {
  pool: Pool;
  blobs: PublicationBlobStore;
  page: ArtifactBlobPageReader;
  authorize(operation: 'cleanup' | 'collect' | 'recover'): Promise<boolean>;
  batchSize?: number;
  activation?: ArtifactActivationMaintenance;
}) {
  const limit = bound(options.batchSize ?? 100);
  if (typeof options.authorize !== 'function') throw new Error('Artifact maintenance authority required');
  const executor = createPostgresCommitExecutor(options.pool);
  const storeFor = (client: unknown) => createPostgresArtifactStore(client as Pool);
  const gc = createPostgresGcService(executor, storeFor);
  async function authorize(operation: 'cleanup' | 'collect' | 'recover') {
    if (await options.authorize(operation) !== true) throw new Error('Artifact maintenance denied');
  }
  function guardedBlobs(operation: 'cleanup' | 'collect'): PublicationBlobStore {
    return { ...options.blobs,
      async deleteBlob(key, transaction) { await authorize(operation); await options.blobs.deleteBlob(key, transaction); },
      async listKeys(key) {
        // Preparation cleanup probes exact keys, never an unbounded bucket listing.
        if (!blobKey.test(key)) throw new Error('Invalid preparation blob key');
        await authorize(operation);
        const result = await listBlobKeysPaged(options.blobs, key, { maxItems: 1, maxEncodedBytes: 256 });
        return result.keys.filter(candidate => candidate === key);
      },
      ...(options.blobs.listKeysPaged === undefined ? {} : { async listKeysPaged(prefix: string, page: {
        maxItems: number; maxEncodedBytes: number; startAfter?: string;
      }) {
        await authorize(operation);
        return options.blobs.listKeysPaged!(prefix, page);
      } }),
    };
  }
  return {
    async cleanup() {
      await authorize('cleanup');
      const { rows } = await options.pool.query<{ now: string }>(
        'SELECT floor(extract(epoch FROM clock_timestamp()) * 1000)::text AS now');
      const now = Number(rows[0]!.now);
      const store = storeFor(options.pool);
      const failures: unknown[] = [];
      for (const candidate of await store.listPreparationIntents({ throughMs: now, limit })) {
        const client = await executor.beginFinalization();
        let failure: unknown;
        try {
          await authorize('cleanup');
          // Intents/refs persist independently; only deletion claims share this item's transaction.
          await scheduleBoundedPreparationCleanup({ intents: { ...store,
            listPreparationIntents: async () => [candidate] }, refs: store,
          blobs: guardedBlobs('cleanup'), claims: createPostgresDeletionClaimStore(client),
          transaction: client, cleanupBatchSize: 1 }, now);
          await client.commit();
        } catch (error) {
          failure = error;
          try { await client.rollback(); } catch (rollback) { failure = rollback; }
          failures.push(error);
        } finally { client.release(failure); }
        if (failure !== undefined) {
          const message = failure instanceof AggregateError ? failure.errors.map(String).join('; ') : String(failure);
          // Retain original attribution; defer retryable debt so it cannot monopolize the next page.
          await options.pool.query(`UPDATE artifacts.object_intents SET state = 'failed',
            error = CASE WHEN error LIKE 'invalid preparation metadata%' THEN error ELSE $2 END,
            payload = payload || jsonb_build_object(
              'hostCleanupRetries', COALESCE((payload->>'hostCleanupRetries')::int, 0) + 1,
              'hostCleanupOriginalDeadlineMs', COALESCE(payload->'hostCleanupOriginalDeadlineMs', payload->'cleanupDeadlineMs'),
              'cleanupDeadlineMs', CASE WHEN error LIKE 'invalid preparation metadata%'
                THEN payload->'cleanupDeadlineMs' ELSE to_jsonb($3::bigint) END), updated_at = now()
            WHERE id = $1 AND state <> 'done'`, [candidate.intentId, message, now + 60000]);
        }
      }
      await authorize('cleanup');
      const activation = await options.activation?.cleanup(limit);
      if (failures.length) throw new AggregateError(failures, 'Artifact preparation cleanup failed; debt recorded');
      return activation;
    },
    async collect(storageScopeId: string, cursor?: string) {
      await authorize('collect');
      if (!/^[A-Za-z0-9_-]+$/.test(storageScopeId)) throw new Error('Invalid artifact storage scope');
      const prefix = `artifacts/${storageScopeId}/blobs/sha256/`;
      const validateKeys = (keys: readonly string[]) => {
        if (keys.length > limit || keys.some(key => !key.startsWith(prefix) || !blobKey.test(key))) {
          throw new Error('Invalid artifact collection page');
        }
      };
      const listed = options.blobs.listKeysPaged === undefined ? undefined : await listBlobKeysPaged({ ...options.blobs,
        async listKeysPaged(keyPrefix, request) {
          const result = await options.blobs.listKeysPaged!(keyPrefix, request);
          validateKeys(result.keys);
          return result;
        } }, prefix,
        { maxItems: limit, maxEncodedBytes: limit * 256, ...(cursor === undefined ? {} : { continuation: cursor }) });
      const page = listed ? { keys: listed.keys, cursor: listed.continuation } : await options.page(prefix, limit, cursor);
      validateKeys(page.keys);
      await authorize('collect');
      const guarded = guardedBlobs('collect');
      const report = await gc.collect({ ...guarded,
        listKeys: async key => key === prefix ? page.keys : guarded.listKeys(key) }, prefix);
      return { ...report, cursor: page.cursor };
    },
    async recover(steps: {
      closeServing(): Promise<void>;
      retireGrantAuthority(): Promise<void>;
      reconcileDenials(): Promise<void>;
      reopenServing(): Promise<void>;
    }) {
      await authorize('recover');
      // W3/W5 supply a durable fence covering every serving process and writer.
      await steps.closeServing();
      if (!options.activation) throw new Error('Artifact recovery requires W1.c activation storage');
      await options.activation.invalidate();
      await steps.retireGrantAuthority();
      await steps.reconcileDenials();
      await authorize('recover');
      await steps.reopenServing();
    },
  };
}
