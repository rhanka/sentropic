import type { Pool } from 'pg';
import { GetPublicAccessBlockCommand, ListObjectsV2Command, type S3Client } from '@aws-sdk/client-s3';
import { createS3BlobStore } from '@sentropic/artifacts/adapters/s3';
import { createPostgresArtifactStore } from '@sentropic/artifacts/adapters/postgres';
import { createPostgresCommitExecutor } from '@sentropic/artifacts/adapters/postgres-commit';
import { createPostgresDeletionClaimStore, createPostgresGcService } from '@sentropic/artifacts/server/gc';
import { scheduleBoundedPreparationCleanup } from '@sentropic/artifacts/server/object-intents';
import type { PublicationBlobStore } from '@sentropic/artifacts/server/publication';

export interface ArtifactBlobPage { keys: string[]; cursor?: string }
export type ArtifactBlobPageReader = (prefix: string, limit: number, cursor?: string) => Promise<ArtifactBlobPage>;
const blobKey = /^artifacts\/[A-Za-z0-9_-]+\/blobs\/sha256\/[0-9a-f]{64}$/;
function bound(limit: number): number {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw new Error('Invalid artifact maintenance bound');
  return limit;
}

/** Credentials and bucket are host-supplied; unsupported privacy checks fail closed. */
export async function createPrivateArtifactStorage(options: { client: S3Client; bucket: string }) {
  const { client, bucket } = options;
  if (!bucket) throw new Error('Private artifact bucket required');
  async function assertPrivate() {
    const { PublicAccessBlockConfiguration: config } = await client.send(new GetPublicAccessBlockCommand({ Bucket: bucket }));
    if (!config || !['BlockPublicAcls', 'IgnorePublicAcls', 'BlockPublicPolicy', 'RestrictPublicBuckets']
      .every(field => config[field as keyof typeof config] === true)) throw new Error('Artifact bucket must remain private');
  }
  await assertPrivate();
  const upstream = createS3BlobStore(options);
  const blobs: PublicationBlobStore = {
    async putBlob(key, bytes) { await assertPrivate(); await upstream.putBlob(key, bytes); },
    async getBlob(key) { await assertPrivate(); return upstream.getBlob(key); },
    async deleteBlob(key) { await assertPrivate(); await upstream.deleteBlob(key); },
    async listKeys(prefix) { await assertPrivate(); return upstream.listKeys(prefix); },
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
      async deleteBlob(key) { await authorize(operation); await options.blobs.deleteBlob(key); },
      async listKeys(key) {
        // Preparation cleanup probes exact keys, never an unbounded bucket listing.
        if (!blobKey.test(key)) throw new Error('Invalid preparation blob key');
        await authorize(operation);
        return (await options.page(key, 1)).keys.filter(candidate => candidate === key);
      },
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
          blobs: guardedBlobs('cleanup'), claims: createPostgresDeletionClaimStore(client), cleanupBatchSize: 1 }, now);
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
      const page = await options.page(prefix, limit, cursor);
      if (page.keys.length > limit || page.keys.some(key => !key.startsWith(prefix) || !blobKey.test(key))) {
        throw new Error('Invalid artifact collection page');
      }
      await authorize('collect');
      const report = await gc.collect({ ...guardedBlobs('collect'), listKeys: async () => page.keys }, prefix);
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
