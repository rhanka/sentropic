import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
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
import { createPostgresClaimGuardedRefs, createPostgresGcService, createPostgresDeletionClaimStore } from '../src/server/gc.js';
import { createArtifactCommand, createRadarKeyDerivation } from '../src/server/command-identity.js';
import { compileArtifactsProfile, RADAR_ARTIFACTS_PROFILE } from '../src/profile/index.js';
import { createArtifactCommitBarrier, type CommitBarrierObserver, type CommitBarrierPoint } from '../src/testing.js';
import type { PublicationBlobStore, GuardedPublishInput } from '../src/server/publication.js';
import type { AuthorizeCommit } from '../src/server/commit/types.js';

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
  authority = { expired: false }, cleanupWindowMs?: number) {
  const executor = createPostgresCommitExecutor(db);
  const pg = createPostgresArtifactStore(db);
  const coordinator = createArtifactCommitCoordinator({ executor, testObserver: observer,
    policy: { createParticipant: (client, token) => ({
      async readRevision() {
        const { rows } = await client.query<{ revision: string }>('SELECT revision FROM l8a_policy WHERE id=1 FOR SHARE', []);
        return rows[0].revision as string;
      },
      async checkApproval() {
        if (authority.expired) return { approved: false, reason: 'expired' as const };
        const { rows } = await client.query<{ approved: boolean }>('SELECT approved FROM l8a_policy WHERE id=1', []);
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
    cleanupWindowMs, createUnitWriter: createPostgresPublicationUnitWriter,
    locks: { 'artifact-lifecycle': [async (client) => {
      await client.query('SELECT id FROM artifacts.artifacts ORDER BY id FOR UPDATE', []);
    }], acl: [async (client) => {
      await client.query('SELECT artifact_id FROM artifacts.artifact_access ORDER BY artifact_id FOR UPDATE', []);
    }] },
  });
  return { service, refs, coordinator };
}
const publish = (w: ReturnType<typeof world>, input: ReturnType<typeof inputFor> &
  Pick<GuardedPublishInput, 'authorizeCommit' | 'expectedCurrentReleaseId' | 'metadata'>) => {
  const command = createArtifactCommand(profile, 'artifacts_publish', {
    artifactId: input.artifactId, idempotencyKey: input.callerKey, profile: input.profile,
    files: input.files.map((file) => ({ ...file, bytes: [...file.bytes] })),
    ...(input.expectedCurrentReleaseId === undefined ? {} : { expectedCurrentReleaseId: input.expectedCurrentReleaseId }),
    ...input.metadata,
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
  for (const name of ['0001_artifacts.sql', '0002_lifecycle.sql', '0003_coordinator.sql', '0004_metadata.sql']) {
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

it('should atomically CAS one winner with metadata and one quota charge on PostgreSQL', async () => {
  const id = await artifact();
  const w = world(pool, blobs);
  const first = await publish(w, { ...inputFor(id), expectedCurrentReleaseId: null });
  expect(first.ok).toBe(true);
  if (!first.ok) return;
  const base = (first.result.receipt as { releaseId: string }).releaseId;
  const results = await Promise.all(['alpha', 'beta'].map(title => publish(w, {
    ...inputFor(id), expectedCurrentReleaseId: base, metadata: { title },
  })));
  expect(results.filter(result => result.ok)).toHaveLength(1);
  expect(results.find(result => !result.ok)).toMatchObject({ ok: false,
    failure: { variant: 'pointer_conflict', commitState: 'not_committed' } });
  const winner = results.find(result => result.ok)!;
  if (!winner.ok) return;
  const receipt = winner.result.receipt as { releaseId: string; metadata: { title: string } };
  expect((await pool.query('SELECT release_id FROM artifacts.artifact_current WHERE artifact_id=$1', [id])).rows[0].release_id)
    .toBe(receipt.releaseId);
  expect((await pool.query('SELECT metadata FROM artifacts.artifacts WHERE id=$1', [id])).rows[0].metadata).toEqual(receipt.metadata);
  expect((await pool.query('SELECT id FROM artifacts.releases WHERE artifact_id=$1', [id])).rows).toHaveLength(2);
  expect((await pool.query('SELECT used FROM l8a_quota')).rows[0].used).toBe(2);
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

describe('publication authorization after every applicable wait', () => {
  it.each([false, true])('should deny direct unapproved publication with host guard: %s', async (useHostGuard) => {
    const input = inputFor(await artifact());
    await pool.query('UPDATE l8a_policy SET approved=false WHERE id=1');
    const before = await snapshot();
    const authorizeCommit = vi.fn<AuthorizeCommit>(async (context, transaction) => {
      expect(await transaction.participant.checkApproval({ actorId: context.actorId, operation: context.operation }))
        .toMatchObject({ approved: false });
      return { allowed: false, reason: 'denied', publicCode: 'account_not_approved', status: 403, retriable: false };
    });
    const outcome = await publish(world(pool, blobs), { ...input,
      authorizeCommit: useHostGuard ? authorizeCommit : undefined });
    expect(outcome).toMatchObject({ ok: false, failure: {
      category: 'unauthorized_at_commit', commitState: 'not_committed', httpStatus: 403,
      publicCode: useHostGuard ? 'account_not_approved' : 'access_denied',
    } });
    expect(authorizeCommit).toHaveBeenCalledTimes(useHostGuard ? 1 : 0);
    expect(await snapshot()).toEqual(before);
  });

  it.each(publishPoints)('should roll back expired authority after %s and permit a fresh same-key retry', async (point) => {
    const input = inputFor(await artifact());
    const before = await snapshot();
    const authority = { expired: false };
    const barrier = createArtifactCommitBarrier({ points: [point] });
    const w = world(pool, blobs, barrier.observer, authority, 1000);
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
    if (fresh.ok && replay.ok) expect(replay.result.receipt).toEqual(fresh.result.receipt);
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
        authority.expired = resource !== 'policy' && resource !== 'lifecycle';
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
    let pending: ReturnType<typeof publish> | undefined;
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
      // Start the bounded parent preparation after the separate process has loaded and prepared S3.
      pending = publish(world(pool, blobs, barrier.observer), input);
      await barrier.waitUntilReached('before_key_lock', input.invocationId);
      barrier.release('before_key_lock', input.invocationId);
      const winner = await pending;
      expect(winner).toMatchObject({ ok: true, replayed: false });
      child.send({ go: true });
      const loser = await result;
      if (changed) expect(loser).toMatchObject({ ok: false, failure: { category: 'conflict' } });
      else {
        expect(loser).toMatchObject({ ok: true, replayed: true });
        if (winner.ok) expect(loser).toMatchObject({ result: { receipt: winner.result.receipt } });
      }
      expect(Number((await pool.query('SELECT count(*) FROM artifacts.releases')).rows[0].count)).toBe(beforeCount + 1);
      expect((await pool.query('SELECT used FROM l8a_quota')).rows[0].used).toBe(1);
      expect(Number((await pool.query(`SELECT count(*) FROM artifacts.operation_receipts
        WHERE storage_scope_id=$1 AND internal_key=$2`, ['scope-l8a', command.identity.internalKey])).rows[0].count)).toBe(1);
    } finally {
      child.kill();
      await pending;
    }
  });
});

describe('bounded cleanup and purge exclusion', () => {
  it('should reclaim denied exclusive bytes while retaining a committed shared blob', async () => {
    const shared = inputFor(await artifact());
    expect(await publish(world(pool, blobs), shared)).toMatchObject({ ok: true });
    const refused = inputFor(await artifact());
    refused.files = [shared.files[0], { ...refused.files[0], path: 'exclusive.html' }];
    const before = await snapshot();
    expect(await publish(world(pool, blobs, undefined, { expired: true }, 1000), refused))
      .toMatchObject({ ok: false, failure: { category: 'unauthorized_at_commit' } });
    expect(await snapshot()).toEqual(before);
    const pg = createPostgresArtifactStore(pool);
    const attempts = (await pg.listPending()).filter((intent) => intent.payload['attemptId'] === refused.attemptId);
    expect(attempts).toHaveLength(1);
    const keys = attempts[0].payload['blobKeys'] as string[];
    expect(keys).toHaveLength(2);
    for (const key of keys) expect(await blobs.getBlob(key)).toBeDefined();
    const deadline = Number(attempts[0].payload['cleanupDeadlineMs']);
    const gc = createPostgresGcService(createPostgresCommitExecutor(pool), () => pg);
    const report = await gc.collect(blobs, 'artifacts/');
    const sharedKey = `artifacts/scope-l8a/blobs/sha256/${createHash('sha256').update(shared.files[0].bytes).digest('hex')}`;
    const exclusiveKey = keys.find((key) => key !== sharedKey)!;
    expect(report.retained).toContain(sharedKey);
    expect(report.deleted).toContain(exclusiveKey);
    expect(report.failures).toEqual([]);
    expect(await blobs.getBlob(sharedKey)).toEqual(shared.files[0].bytes);
    expect(await blobs.getBlob(exclusiveKey)).toBeUndefined();
    expect(Date.now()).toBeLessThanOrEqual(deadline);
    expect(await snapshot()).toEqual(before);
  });

  it.each(['purge-first', 'publication-first'] as const)(
    'should serialize durable deletion claims with publication in %s order', async (order) => {
      const input = inputFor(await artifact());
      const digest = `sha256:${createHash('sha256').update(input.files[0].bytes).digest('hex')}`;
      const key = `artifacts/scope-l8a/blobs/sha256/${digest.slice(7)}`;
      const executor = createPostgresCommitExecutor(pool);
      const claim = await executor.beginFinalization();
      try {
        if (order === 'purge-first') {
          await createPostgresDeletionClaimStore(claim).claim(digest, 'purge-l8a');
          await claim.commit();
          const before = await snapshot();
          await expect(publish(world(pool, blobs), input)).rejects.toThrow(/deletion/);
          expect(await snapshot()).toEqual(before);
          expect(await blobs.getBlob(key)).toBeUndefined();
        } else {
          const barrier = createArtifactCommitBarrier({ points: ['before_commit'] });
          const pending = publish(world(pool, blobs, barrier.observer), input);
          await barrier.waitUntilReached('before_commit', input.invocationId);
          const pid = Number((await claim.query<{ pid: number }>('SELECT pg_backend_pid() AS pid', [])).rows[0].pid);
          const claiming = createPostgresDeletionClaimStore(claim).claim(digest, 'purge-l8a');
          try { await blocked(pid); }
          finally { barrier.release('before_commit', input.invocationId); }
          expect(await pending).toMatchObject({ ok: true });
          await claiming;
          await claim.commit();
          const report = await createPostgresGcService(executor, () => createPostgresArtifactStore(pool))
            .collect(blobs, 'artifacts/');
          expect(report.retained).toContain(key);
          expect(await blobs.getBlob(key)).toEqual(input.files[0].bytes);
        }
      } finally { await claim.rollback(); claim.release(); }
    });

  it('should retain invocation attribution for every denied preparation', async () => {
    const input = inputFor(await artifact());
    expect(await publish(world(pool, blobs, undefined, { expired: true }), input)).toMatchObject({ ok: false });
    const attempts = (await createPostgresArtifactStore(pool).listPending())
      .filter((intent) => intent.payload['attemptId'] === input.attemptId);
    expect(attempts).toHaveLength(1);
    expect(attempts[0].payload).toMatchObject({ invocationId: input.invocationId, attemptId: input.attemptId });
  });

  it('should forward all preparation barriers through the provider observer', async () => {
    const input = inputFor(await artifact());
    const observed: string[] = [];
    const outcome = await publish(world(pool, blobs, async (point, invocationId) => {
      expect(invocationId).toBe(input.invocationId);
      observed.push(point);
    }), input);
    expect(outcome).toMatchObject({ ok: true });
    expect(observed.slice(0, 3)).toEqual([
      'before_blob_put', 'after_blob_put_before_verify', 'before_blob_readback',
    ]);
  });
});

describe('connection and guarded replay waits', () => {
  it('should refuse expired authority after waiting for an actual pooled connection', async () => {
    const input = inputFor(await artifact());
    const before = await snapshot();
    const single = new Pool({ connectionString: process.env['DATABASE_URL'], max: 1 });
    const holder = await single.connect();
    const authority = { expired: false };
    const pending = publish(world(single, blobs, undefined, authority), input);
    try {
      await expect.poll(() => single.waitingCount).toBe(1);
      authority.expired = true;
    } finally { holder.release(); }
    try {
      expect(await pending).toMatchObject({ ok: false, failure: { category: 'unauthorized_at_commit' } });
      expect(await snapshot()).toEqual(before);
    } finally { await single.end(); }
  });

  it('should deny an expired replay after lookup without changing the committed result or quota', async () => {
    const input = inputFor(await artifact());
    expect(await publish(world(pool, blobs), input)).toMatchObject({ ok: true });
    const before = await snapshot();
    const authority = { expired: false };
    const barrier = createArtifactCommitBarrier({ points: ['after_replay_lookup_before_guard'] });
    const replay = { ...input, invocationId: randomUUID(), attemptId: randomUUID() };
    const pending = publish(world(pool, blobs, barrier.observer, authority), replay);
    await barrier.waitUntilReached('after_replay_lookup_before_guard', replay.invocationId);
    authority.expired = true;
    barrier.release('after_replay_lookup_before_guard', replay.invocationId);
    expect(await pending).toMatchObject({ ok: false, failure: { category: 'unauthorized_at_commit' } });
    expect(await snapshot()).toEqual(before);
  });
});
