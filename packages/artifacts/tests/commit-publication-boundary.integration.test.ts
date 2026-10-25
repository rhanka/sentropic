import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createHash, randomUUID } from 'node:crypto';
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
import { createArtifactCommitBarrier, type CommitBarrierObserver, type CommitBarrierPoint } from '../src/testing.js';
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

function world(db: Pool, store: PublicationBlobStore, observer?: CommitBarrierObserver,
  authority = { expired: false }) {
  const executor = createPostgresCommitExecutor(db);
  const pg = createPostgresArtifactStore(db);
  const coordinator = createArtifactCommitCoordinator({ executor, testObserver: observer,
    policy: { createParticipant: (client, token) => ({
      async readRevision() {
        const { rows } = await client.query('SELECT revision FROM l8a_policy WHERE id=1 FOR SHARE', []);
        return rows[0].revision as string;
      },
      async checkApproval() {
        if (authority.expired) return { approved: false, reason: 'expired' as const };
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
    VALUES ($1::uuid,'scope-l8a','actor',$1::text,'{}')`, [id]);
  await pool.query(`INSERT INTO artifacts.artifact_access (artifact_id,principal_id,permission)
    VALUES ($1,'actor','source')`, [id]);
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

// Separate pooled connections observe committed truth, never the writer's provisional rows.
async function snapshot() {
  const result: Record<string, unknown> = {};
  for (const name of ['artifacts', 'releases', 'artifact_current', 'artifact_access',
    'artifact_sources', 'operation_receipts', 'blobs', 'blob_ref_holders', 'blob_pins']) {
    result[name] = (await pool.query(`SELECT to_jsonb(t) AS row FROM artifacts.${name} t ORDER BY to_jsonb(t)::text`)).rows;
  }
  result['quota'] = (await pool.query('SELECT used FROM l8a_quota')).rows;
  return result;
}

const publishPoints: CommitBarrierPoint[] = ['before_blob_put', 'after_blob_put_before_verify',
  'before_blob_readback', 'before_connection_acquire', 'before_key_lock',
  'before_finalization_row_lock', 'after_finalization_locks_before_guard', 'before_commit'];

// Preparation I/O is delayed at the real adapter boundary; no fake blob success.
function delayedBlobs(barrier: ReturnType<typeof createArtifactCommitBarrier>, invocation: string): PublicationBlobStore {
  return {
    async putBlob(key, bytes) {
      await barrier.observer('before_blob_put', invocation);
      await blobs.putBlob(key, bytes);
      await barrier.observer('after_blob_put_before_verify', invocation);
    },
    async getBlob(key) {
      await barrier.observer('before_blob_readback', invocation);
      return blobs.getBlob(key);
    },
    listKeys: (prefix) => blobs.listKeys(prefix), deleteBlob: (key) => blobs.deleteBlob(key),
  };
}

describe('publication authorization after every applicable wait', () => {
  it.each(publishPoints)('should roll back expired authority after %s and permit a fresh same-key retry', async (point) => {
    const input = inputFor(await artifact());
    const before = await snapshot();
    const authority = { expired: false };
    const barrier = createArtifactCommitBarrier({ points: [point] });
    const w = world(pool, delayedBlobs(barrier, input.invocationId), barrier.observer, authority);
    const pending = publish(w, input);
    await barrier.waitUntilReached(point, input.invocationId);
    authority.expired = true;
    barrier.release(point, input.invocationId);
    const denied = await pending;
    expect(denied).toMatchObject({ ok: false, failure: {
      category: 'unauthorized_at_commit', commitState: 'not_committed', httpStatus: 403,
    } });
    expect(await snapshot()).toEqual(before);
    const intents = (await createPostgresArtifactStore(pool).listPending())
      .filter((intent) => intent.payload['attemptId'] === input.attemptId);
    expect(intents).toHaveLength(1);
    expect(intents[0].payload['cleanupDeadlineMs']).toEqual(expect.any(Number));
    expect(Number(intents[0].payload['cleanupDeadlineMs']) - Date.parse(intents[0].createdAt)).toBeLessThanOrEqual(1000);
    for (const key of intents[0].payload['blobKeys'] as string[]) expect(await blobs.getBlob(key)).toBeDefined();
    const retryWorld = world(pool, blobs);
    const fresh = await publish(retryWorld, { ...input, invocationId: randomUUID(), attemptId: randomUUID() });
    expect(fresh).toMatchObject({ ok: true, replayed: false });
    const replay = await publish(retryWorld, { ...input, invocationId: randomUUID(), attemptId: randomUUID() });
    expect(replay).toMatchObject({ ok: true, replayed: true });
    if (fresh.ok && replay.ok) expect(replay.result).toEqual(fresh.result);
    expect((await pool.query('SELECT used FROM l8a_quota')).rows[0].used).toBe(1);
  });
});

describe('L8a publication boundary', () => {
  it('should commit one durable release and quota charge on real PostgreSQL and S3', async () => {
    const input = inputFor(await artifact());
    const result = await publish(world(pool, blobs), input);
    expect(result).toMatchObject({ ok: true, replayed: false, commitState: 'committed' });
    expect((await pool.query('SELECT used FROM l8a_quota')).rows[0].used).toBe(1);
    const digest = createHash('sha256').update(input.files[0].bytes).digest('hex');
    expect(await blobs.getBlob(`artifacts/scope-l8a/blobs/sha256/${digest}`)).toEqual(input.files[0].bytes);
  });
});

async function blocked(pid: number) {
  await expect.poll(async () => Number((await pool.query(
    'SELECT cardinality(pg_blocking_pids($1)) AS n', [pid])).rows[0].n)).toBeGreaterThan(0);
}

describe('publication serializes real PostgreSQL writers', () => {
  it.each(['policy', 'lifecycle', 'acl', 'quota', 'key'] as const)(
    'should reauthorize after a real %s lock wait', async (resource) => {
      const input = inputFor(await artifact());
      const executor = createPostgresCommitExecutor(pool);
      const command = createArtifactCommand(profile, 'artifacts_publish', {
        artifactId: input.artifactId, idempotencyKey: input.callerKey, profile: input.profile,
        files: input.files.map((file) => ({ ...file, bytes: [...file.bytes] })),
      }, input, createRadarKeyDerivation({ storageScopeId: input.storageScopeId, actorIds: [input.actorId] }));
      await executor.ensureCoordinationRow('scope-l8a', command.identity.internalKey);
      const writer = await pool.connect();
      const writerPid = Number((await writer.query('SELECT pg_backend_pid() AS pid')).rows[0].pid);
      const before = await snapshot();
      const authority = { expired: false };
      let pending: ReturnType<typeof publish> | undefined;
      try {
        await writer.query('BEGIN');
        if (resource === 'policy') await writer.query(`UPDATE l8a_policy SET revision='r2' WHERE id=1`);
        if (resource === 'lifecycle') await writer.query(`UPDATE artifacts.artifacts SET lifecycle_state='withdrawn' WHERE id=$1`, [input.artifactId]);
        if (resource === 'acl') await writer.query(`UPDATE artifacts.artifact_access SET permission='read' WHERE artifact_id=$1`, [input.artifactId]);
        if (resource === 'quota') await writer.query('SELECT * FROM l8a_quota FOR UPDATE');
        if (resource === 'key') await writer.query(`SELECT * FROM artifacts.operation_keys
          WHERE storage_scope_id=$1 AND internal_key=$2 FOR UPDATE`, ['scope-l8a', command.identity.internalKey]);
        pending = publish(world(pool, blobs, undefined, authority), input);
        await expect.poll(async () => (await pool.query(
          `SELECT EXISTS (SELECT 1 FROM pg_stat_activity a WHERE $1=ANY(pg_blocking_pids(a.pid))) AS waiting`,
          [writerPid])).rows[0].waiting).toBe(true);
        authority.expired = true;
        await writer.query('COMMIT');
        expect(await pending).toMatchObject({ ok: false, failure: { category: 'unauthorized_at_commit' } });
        // Remove only the deliberately committed policy/lifecycle/ACL mutation before comparing.
        if (resource === 'policy') await pool.query(`UPDATE l8a_policy SET revision='r1' WHERE id=1`);
        if (resource === 'lifecycle') await pool.query(`UPDATE artifacts.artifacts SET lifecycle_state='active' WHERE id=$1`, [input.artifactId]);
        if (resource === 'acl') await pool.query(`UPDATE artifacts.artifact_access SET permission='source' WHERE artifact_id=$1`, [input.artifactId]);
        expect(await snapshot()).toEqual(before);
      } finally {
        await writer.query('ROLLBACK'); writer.release();
        await pending;
      }
    });

  it.each(['policy', 'lifecycle', 'acl'] as const)(
    'should commit before a later %s writer while retaining finalization locks', async (resource) => {
      const input = inputFor(await artifact());
      const barrier = createArtifactCommitBarrier({ points: ['before_commit'] });
      const pending = publish(world(pool, blobs, barrier.observer), input);
      await barrier.waitUntilReached('before_commit', input.invocationId);
      const writer = await pool.connect();
      let writing: Promise<unknown> | undefined;
      try {
        const pid = Number((await writer.query('SELECT pg_backend_pid() AS pid')).rows[0].pid);
        writing = resource === 'policy' ? writer.query(`UPDATE l8a_policy SET revision='r2' WHERE id=1`)
          : resource === 'lifecycle' ? writer.query(`UPDATE artifacts.artifacts SET lifecycle_state='withdrawn' WHERE id=$1`, [input.artifactId])
          : writer.query(`DELETE FROM artifacts.artifact_access WHERE artifact_id=$1`, [input.artifactId]);
        await blocked(pid);
      } finally {
        barrier.release('before_commit', input.invocationId);
        expect(await pending).toMatchObject({ ok: true });
        await writing; writer.release();
      }
      expect((await pool.query('SELECT used FROM l8a_quota')).rows[0].used).toBe(1);
    });
});

// A real second Node process owns its pool, coordinator and S3 client.
const workerSource = `
import { Pool } from 'pg';
import { S3Client } from '@aws-sdk/client-s3';
import { createS3BlobStore } from './dist/adapters/s3.js';
import { createPostgresArtifactStore } from './dist/adapters/postgres.js';
import { createPostgresCommitExecutor } from './dist/adapters/postgres-commit.js';
import { createArtifactCommitCoordinator } from './dist/server/commit/coordinator.js';
import { createGuardedPublicationService, createPostgresPublicationUnitWriter } from './dist/server/publication.js';
import { createPostgresClaimGuardedRefs } from './dist/server/gc.js';
const pool = new Pool({connectionString:process.env.DATABASE_URL});
const s3 = new S3Client({endpoint:process.env.ARTIFACTS_S3_ENDPOINT,forcePathStyle:true,
 region:process.env.ARTIFACTS_S3_REGION,credentials:{accessKeyId:process.env.ARTIFACTS_S3_ACCESS_KEY_ID,
 secretAccessKey:process.env.ARTIFACTS_S3_SECRET_ACCESS_KEY}});
let resume;
process.on('message', async message => {
 if(message.go){resume();return;}
 try {
 const input=message.input; input.files=input.files.map(f=>({...f,bytes:new Uint8Array(f.bytes)}));
 const raw=createS3BlobStore({client:s3,bucket:message.bucket});
 const ready=new Promise(resolve=>{resume=resolve});
 const blobs={...raw,putBlob:async(key,bytes)=>{await raw.putBlob(key,bytes);process.send({prepared:true,pid:process.pid});await ready;}};
 const executor=createPostgresCommitExecutor(pool); const pg=createPostgresArtifactStore(pool);
 const coordinator=createArtifactCommitCoordinator({executor,policy:{createParticipant:(client,token)=>({
  readRevision:async()=> (await client.query('SELECT revision FROM l8a_policy WHERE id=1 FOR SHARE',[])).rows[0].revision,
  checkApproval:async()=>({approved:(await client.query('SELECT approved FROM l8a_policy WHERE id=1',[])).rows[0].approved}),
  reserveQuota:async()=>({reserved:(await client.query('UPDATE l8a_quota SET used=used+1 WHERE used<total',[])).rowCount===1}),
  mintFence:(policyRevision,invocationId)=>({fenceId:token,transactionId:token,policyRevision,invocationId})
 })}});
 const service=createGuardedPublicationService({coordinator,blobs,intents:pg,
 refs:createPostgresClaimGuardedRefs(pg,executor),createUnitWriter:createPostgresPublicationUnitWriter,
 locks:{'artifact-lifecycle':[async client=>{await client.query('SELECT id FROM artifacts.artifacts WHERE id=$1 FOR UPDATE',[input.artifactId]);}]}});
 process.send({result:await service.publishFinalized(input)});
 }catch(error){process.send({error:String(error)});}
 finally{await pool.end();s3.destroy();process.disconnect();}
});`;

describe('same-key S3 preparation across two processes', () => {
  it.each([false, true])('should keep one success and one charge when the second command changes: %s', async (changed) => {
    const input = inputFor(await artifact());
    const other = { ...input, invocationId: randomUUID(), attemptId: randomUUID(),
      files: input.files.map((file) => ({ ...file, path: changed ? 'changed.html' : file.path })) };
    const command = createArtifactCommand(profile, 'artifacts_publish', {
      artifactId: other.artifactId, idempotencyKey: other.callerKey, profile: other.profile,
      files: other.files.map((file) => ({ ...file, bytes: [...file.bytes] })),
    }, other, createRadarKeyDerivation({ storageScopeId: other.storageScopeId, actorIds: [other.actorId] }));
    const beforeCount = Number((await pool.query('SELECT count(*) FROM artifacts.releases')).rows[0].count);
    const barrier = createArtifactCommitBarrier({ points: ['before_key_lock'] });
    const pending = publish(world(pool, blobs, barrier.observer), input);
    await barrier.waitUntilReached('before_key_lock', input.invocationId);
    const child = spawn(process.execPath, ['--input-type=module', '-e', workerSource], {
      cwd: new URL('..', import.meta.url), stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    let stderr = '';
    child.stderr?.on('data', (data) => { stderr += String(data); });
    const prepared = once(child, 'message');
    const result = new Promise<unknown>((resolve, reject) => {
      child.on('message', (message: { result?: unknown; error?: string }) => {
        if (message.error) reject(new Error(message.error));
        if (message.result) resolve(message.result);
      });
      child.once('exit', (code) => { if (code) reject(new Error(`worker exit ${code}: ${stderr}`)); });
    });
    void result.catch(() => {});
    try {
      child.send({ bucket, input: { ...other, identity: command.identity,
        files: other.files.map((file) => ({ ...file, bytes: [...file.bytes] })) } });
      expect((await prepared)[0]).toMatchObject({ prepared: true, pid: child.pid });
      expect(child.pid).not.toBe(process.pid);
      barrier.release('before_key_lock', input.invocationId);
      const winner = await pending;
      expect(winner).toMatchObject({ ok: true, replayed: false });
      child.send({ go: true });
      const loser = await result;
      if (changed) expect(loser).toMatchObject({ ok: false, failure: { category: 'conflict' } });
      else {
        expect(loser).toMatchObject({ ok: true, replayed: true });
        if (winner.ok) expect(loser).toMatchObject({ result: winner.result });
      }
      expect(Number((await pool.query('SELECT count(*) FROM artifacts.releases')).rows[0].count)).toBe(beforeCount + 1);
      expect((await pool.query('SELECT used FROM l8a_quota')).rows[0].used).toBe(1);
    } finally {
      child.kill();
      await pending;
    }
  });
});
