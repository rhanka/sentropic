import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { GetPublicAccessBlockCommand, ListObjectsV2Command, PutObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import { blobDigestOfKey, createMemoryBlobStore } from '@sentropic/artifacts/server/publication';
import { createHmacGrantSigner } from '@sentropic/artifacts/content/grants';
import { createPostgresArtifactStore } from '@sentropic/artifacts/adapters/postgres';
import { runMigrations } from '../../src/db/run-migrations';
import { createArtifactHostJobs, createPrivateArtifactStorage } from '../../src/services/artifacts/lifecycle';

const admin = new Pool({ connectionString: process.env.DATABASE_URL });
let pool: Pool;
let databaseName: string;
const scope = 'workspace-opaque';
const key = (hex: string) => `artifacts/${scope}/blobs/sha256/${hex.repeat(64)}`;
beforeEach(async () => {
  databaseName = `w1d_${randomUUID().replaceAll('-', '')}`;
  await admin.query(`CREATE DATABASE "${databaseName}"`);
  const url = new URL(process.env.DATABASE_URL!);
  url.pathname = `/${databaseName}`;
  pool = new Pool({ connectionString: url.toString() });
  await runMigrations(pool);
});
afterEach(async () => {
  await pool.end();
  await admin.query(`DROP DATABASE "${databaseName}" WITH (FORCE)`);
});
afterAll(() => admin.end());

function fixture(allow = true) {
  const blobs = createMemoryBlobStore();
  const page = vi.fn(async (prefix: string, limit: number, _cursor?: string) => ({ keys: (await blobs.listKeys(prefix)).slice(0, limit) }));
  const authorize = vi.fn(async () => allow);
  const jobs = createArtifactHostJobs({ pool, blobs, page, authorize, batchSize: 2 });
  return { blobs, page, authorize, jobs, store: createPostgresArtifactStore(pool) };
}

describe('artifact host recovery', () => {
  it('should refuse invalid job bounds before any work', () => {
    const { blobs, page, authorize } = fixture();
    for (const batchSize of [0, -1, 1.5, NaN, 1001]) {
      expect(() => createArtifactHostJobs({ pool, blobs, page, authorize, batchSize })).toThrow(/bound/);
    }
  });

  it('should clean only due preparations within the batch and retain durable failure history', async () => {
    const { jobs, blobs, store } = fixture();
    const now = Date.now();
    const intents = [];
    for (const [index, hex] of ['a', 'b', 'c', 'd'].entries()) {
      await blobs.putBlob(key(hex), new Uint8Array([1]));
      await store.pin(blobDigestOfKey(key(hex)), `preparation:release-${hex}`);
      intents.push(await store.record('commit-release', { artifactId: 'artifact', attemptId: hex,
        invocationId: hex, releaseId: `release-${hex}`, blobKeys: [key(hex)],
        preparedAtMs: now - 20000, cleanupDeadlineMs: index === 3 ? now + 600000 : now - 10000 }));
    }
    await store.addRef(blobDigestOfKey(key('a')), 'shared-release');
    await jobs.cleanup();
    const history = await Promise.all(intents.map(intent => store.get(intent.intentId)));
    expect(history.filter(intent => intent?.payload.cleanupState === 'failed-cleaned')).toHaveLength(2);
    expect(history.filter(intent => intent?.state === 'pending')).toHaveLength(2);
    expect(await blobs.getBlob(key('a'))).toBeDefined();
    expect(await blobs.getBlob(key('d'))).toBeDefined();
    await jobs.cleanup();
    expect((await store.get(intents[2]!.intentId))?.payload.cleanupState).toBe('failed-cleaned');
    expect((await store.get(intents[3]!.intentId))?.state).toBe('pending');
    expect(await blobs.getBlob(key('b'))).toBeUndefined();
    expect(await blobs.getBlob(key('c'))).toBeUndefined();
    expect((await pool.query('SELECT count(*)::int AS count FROM artifacts.releases')).rows[0].count).toBe(0);
  });

  it('should retain shared references and pins while collecting only a bounded page', async () => {
    const { jobs, blobs, page, store } = fixture();
    for (const hex of ['a', 'b', 'c']) await blobs.putBlob(key(hex), new Uint8Array([1]));
    await store.addRef(blobDigestOfKey(key('a')), 'release-one');
    await store.addRef(blobDigestOfKey(key('a')), 'release-two');
    await store.releaseRef(blobDigestOfKey(key('a')), 'release-one');
    await store.pin(blobDigestOfKey(key('b')), 'retention');
    page.mockResolvedValueOnce({ keys: [key('a'), key('b')] });
    const report = await jobs.collect(scope);
    expect(report.retained).toEqual([key('a'), key('b')]);
    expect(await blobs.getBlob(key('c'))).toBeDefined();
    page.mockResolvedValueOnce({ keys: [key('c')] });
    expect((await jobs.collect(scope)).deleted).toEqual([key('c')]);
    expect(page).toHaveBeenCalledWith(`artifacts/${scope}/blobs/sha256/`, 2, undefined);
  });

  it('should refuse maintenance without host authority before database or blob effects', async () => {
    const { jobs, blobs, page } = fixture(false);
    await blobs.putBlob(key('a'), new Uint8Array([1]));
    await expect(jobs.collect(scope)).rejects.toThrow(/maintenance/);
    await expect(jobs.cleanup()).rejects.toThrow(/maintenance/);
    expect(page).not.toHaveBeenCalled();
    expect(await blobs.getBlob(key('a'))).toBeDefined();
  });

  it('should reject an oversized or foreign collection page before deletion', async () => {
    const { jobs, blobs, page } = fixture();
    await blobs.putBlob(key('a'), new Uint8Array([1]));
    page.mockResolvedValueOnce({ keys: [key('a'), key('b'), key('c')] });
    await expect(jobs.collect(scope)).rejects.toThrow(/page/);
    page.mockResolvedValueOnce({ keys: [key('a').replace(scope, 'foreign')] });
    await expect(jobs.collect(scope)).rejects.toThrow(/page/);
    expect(await blobs.getBlob(key('a'))).toBeDefined();
  });

  it('should expire a grant even when maintenance never runs', () => {
    let now = 1000;
    const signer = createHmacGrantSigner({ secret: 'test-key', clock: () => now });
    const token = signer.issue({ subjectId: 'alice', artifactId: 'artifact' });
    expect(signer.verify(token).subjectId).toBe('alice');
    now += 60000;
    expect(() => signer.verify(token)).toThrow(/expired/);
  });

  it('should require all public access blocks and write through the private upstream S3 adapter', async () => {
    const blocks = { BlockPublicAcls: true, IgnorePublicAcls: true,
      BlockPublicPolicy: true, RestrictPublicBuckets: true };
    const send = vi.fn(async (command: unknown) => {
      if (command instanceof GetPublicAccessBlockCommand) return { PublicAccessBlockConfiguration: blocks };
      if (command instanceof ListObjectsV2Command) return { Contents: [{ Key: key('a') }],
        IsTruncated: true, NextContinuationToken: 'next' };
      return {};
    });
    const client = { send } as unknown as S3Client;
    const storage = await createPrivateArtifactStorage({ client, bucket: 'private-artifacts' });
    await storage.blobs.putBlob(key('a'), new Uint8Array([1]));
    const put = send.mock.calls.map(([command]) => command).find(command => command instanceof PutObjectCommand);
    expect((put as PutObjectCommand).input).toMatchObject({ Bucket: 'private-artifacts', Key: key('a') });
    expect((put as PutObjectCommand).input.ACL).toBeUndefined();
    expect(await storage.page(`artifacts/${scope}/blobs/sha256/`, 2, 'previous'))
      .toEqual({ keys: [key('a')], cursor: 'next' });
    const listed = send.mock.calls.map(([command]) => command).find(command => command instanceof ListObjectsV2Command);
    expect((listed as ListObjectsV2Command).input).toMatchObject({ MaxKeys: 2, ContinuationToken: 'previous' });
    for (const field of Object.keys(blocks)) {
      const unsafe = { ...blocks, [field]: false };
      const denied = { send: vi.fn(async () => ({ PublicAccessBlockConfiguration: unsafe })) } as unknown as S3Client;
      await expect(createPrivateArtifactStorage({ client: denied, bucket: 'public' })).rejects.toThrow(/private/);
    }
    const unavailable = { send: vi.fn(async () => { throw new Error('access denied'); }) } as unknown as S3Client;
    await expect(createPrivateArtifactStorage({ client: unavailable, bucket: 'unknown' })).rejects.toThrow();
  });
});
