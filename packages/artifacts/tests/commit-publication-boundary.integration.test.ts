import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { S3Client, CreateBucketCommand, DeleteBucketCommand } from '@aws-sdk/client-s3';
import { createS3BlobStore } from '../src/adapters/s3.js';
import { createPostgresArtifactStore } from '../src/adapters/postgres.js';
import { createPostgresCommitExecutor } from '../src/adapters/postgres-commit.js';
import { createArtifactCommitCoordinator } from '../src/server/commit/coordinator.js';
import { createGuardedPublicationService, createPostgresPublicationUnitWriter } from '../src/server/publication.js';
import { createPostgresClaimGuardedRefs } from '../src/server/gc.js';
import { createArtifactCommand, createRadarKeyDerivation } from '../src/server/command-identity.js';
import { compileArtifactsProfile, RADAR_ARTIFACTS_PROFILE } from '../src/profile/index.js';
import { createArtifactCommitBarrier, type CommitBarrierObserver } from '../src/testing.js';
import type { PublicationBlobStore } from '../src/server/publication.js';

if (!process.env['DATABASE_URL'] || !process.env['ARTIFACTS_S3_ENDPOINT']) {
  throw new Error('L8a requires make test-artifacts-integration with PostgreSQL and MinIO');
}
const pool = new Pool({ connectionString: process.env['DATABASE_URL'] });
const s3 = new S3Client({ endpoint: process.env['ARTIFACTS_S3_ENDPOINT'], forcePathStyle: true,
  region: process.env['ARTIFACTS_S3_REGION'], credentials: {
    accessKeyId: process.env['ARTIFACTS_S3_ACCESS_KEY_ID']!,
    secretAccessKey: process.env['ARTIFACTS_S3_SECRET_ACCESS_KEY']!,
  } });
const bucket = `l8a-${randomUUID()}`;
const blobs = createS3BlobStore({ client: s3, bucket });
const profile = compileArtifactsProfile(RADAR_ARTIFACTS_PROFILE);
const inputFor = (artifactId: string, key = randomUUID()) => ({
  artifactId, ownerId: 'actor', actorId: 'actor', storageScopeId: 'scope-l8a',
  callerKey: key, policyRevision: 'r1', attemptId: randomUUID(), invocationId: randomUUID(),
  profile: {}, files: [{ path: 'index.html', mimeType: 'text/html', bytes: new TextEncoder().encode(key) }],
});

function world(db: Pool, store: PublicationBlobStore, observer?: CommitBarrierObserver) {
  const executor = createPostgresCommitExecutor(db);
  const pg = createPostgresArtifactStore(db);
  const coordinator = createArtifactCommitCoordinator({ executor, testObserver: observer,
    policy: { createParticipant: (client, token) => ({
      async readRevision() {
        const { rows } = await client.query('SELECT revision FROM l8a_policy WHERE id=1 FOR SHARE', []);
        return rows[0].revision as string;
      },
      async checkApproval() {
        const { rows } = await client.query('SELECT approved FROM l8a_policy WHERE id=1', []);
        return { approved: rows[0].approved as boolean, reason: 'denied' as const };
      },
      async reserveQuota() {
        const result = await client.query('UPDATE l8a_quota SET used=used+1 WHERE used<total', []);
        return { reserved: result.rowCount === 1 };
      },
      mintFence: (revision, invocationId) => ({ fenceId: token, transactionId: token, invocationId, policyRevision: revision }),
    }) },
  });
  const refs = createPostgresClaimGuardedRefs(pg, executor);
  const service = createGuardedPublicationService({ coordinator, blobs: store, intents: pg, refs,
    cleanupWindowMs: 1000, createUnitWriter: createPostgresPublicationUnitWriter,
    locks: { 'artifact-lifecycle': [async (client) => {
      await client.query('SELECT id FROM artifacts.artifacts ORDER BY id FOR UPDATE', []);
    }], acl: [async (client) => {
      await client.query('SELECT artifact_id FROM artifacts.artifact_access ORDER BY artifact_id FOR UPDATE', []);
    }] },
  });
  return { service, refs, coordinator };
}
const publish = (w: ReturnType<typeof world>, input: ReturnType<typeof inputFor>) => {
  const command = createArtifactCommand(profile, 'artifacts_publish', {
    artifactId: input.artifactId, idempotencyKey: input.callerKey, profile: input.profile,
    files: input.files.map((file) => ({ ...file, bytes: [...file.bytes] })),
  }, input, createRadarKeyDerivation({ storageScopeId: input.storageScopeId, actorIds: [input.actorId] }));
  return w.service.publishFinalized({ ...input, identity: command.identity });
};
async function artifact() {
  const id = randomUUID();
  await pool.query(`INSERT INTO artifacts.artifacts (id,storage_scope_id,owner_id,binding_name,profile)
    VALUES ($1,'scope-l8a','actor',$1,'{}')`, [id]);
  await pool.query(`INSERT INTO artifacts.artifact_access VALUES ($1,'actor','source')`, [id]);
  return id;
}

beforeAll(async () => {
  await s3.send(new CreateBucketCommand({ Bucket: bucket }));
  for (const name of ['0001_artifacts.sql', '0002_lifecycle.sql', '0003_coordinator.sql']) {
    await pool.query(readFileSync(new URL(`../migrations/${name}`, import.meta.url), 'utf8'));
  }
  await pool.query(`INSERT INTO artifacts.storage_scopes (id,org_id) VALUES ('scope-l8a','org-l8a')`);
  await pool.query(`CREATE TABLE l8a_policy (id int PRIMARY KEY, revision text, approved boolean);
    INSERT INTO l8a_policy VALUES (1,'r1',true);
    CREATE TABLE l8a_quota (used int, total int); INSERT INTO l8a_quota VALUES (0,100)`);
});
beforeEach(async () => {
  await pool.query(`UPDATE l8a_policy SET revision='r1',approved=true; UPDATE l8a_quota SET used=0,total=100`);
});
afterAll(async () => {
  for (const key of await blobs.listKeys('artifacts/')) await blobs.deleteBlob(key);
  await s3.send(new DeleteBucketCommand({ Bucket: bucket }));
  s3.destroy();
  await pool.end();
});

describe('L8a publication boundary', () => {
  it('should commit one durable release and quota charge on real PostgreSQL and S3', async () => {
    const input = inputFor(await artifact());
    const result = await publish(world(pool, blobs), input);
    expect(result).toMatchObject({ ok: true, replayed: false, commitState: 'committed' });
    expect((await pool.query('SELECT used FROM l8a_quota')).rows[0].used).toBe(1);
    expect(await blobs.listKeys('artifacts/')).toHaveLength(1);
  });
});
