import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { GetPublicAccessBlockCommand, ListObjectsV2Command, PutObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import { blobDigestOfKey, createMemoryBlobStore } from '@sentropic/artifacts/server/publication';
import { createHmacGrantSigner } from '@sentropic/artifacts/content/grants';
import { createPostgresArtifactStore } from '@sentropic/artifacts/adapters/postgres';
import { runMigrations } from '../../src/db/run-migrations';
import { createArtifactHost } from '../../src/services/artifacts/composition';
import { createArtifactHostJobs, createPrivateArtifactStorage, type ArtifactBlobPage } from '../../src/services/artifacts/lifecycle';

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
  await admin.query(`DROP DATABASE "${databaseName}"`);
});
afterAll(() => admin.end());

function fixture(allow = true) {
  const blobs = createMemoryBlobStore();
  const page = vi.fn(async (prefix: string, limit: number, _cursor?: string): Promise<ArtifactBlobPage> =>
    ({ keys: (await blobs.listKeys(prefix)).slice(0, limit) }));
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

  it.each(['invalid', 'claimed', 'unavailable'])('should advance past a %s preparation and persist its debt', async kind => {
    const { jobs, blobs, page, authorize, store } = fixture();
    const now = Date.now();
    const intents = [];
    for (const [index, hex] of ['a', 'b', 'c'].entries()) {
      await blobs.putBlob(key(hex), new Uint8Array([1]));
      await store.pin(blobDigestOfKey(key(hex)), `preparation:release-${hex}`);
      intents.push(await store.record('commit-release', { attemptId: hex, invocationId: hex,
        releaseId: `release-${hex}`, blobKeys: [key(hex)], preparedAtMs: now - 30000,
        cleanupDeadlineMs: kind === 'invalid' && index === 0 ? 'broken' : now - 20000 + index }));
    }
    if (kind === 'claimed') await store.record('delete-blob', {
      deletionClaim: true, digest: blobDigestOfKey(key('a')), holder: 'purge' });
    const remove = blobs.deleteBlob;
    blobs.deleteBlob = vi.fn(async value => {
      if (kind === 'unavailable' && value === key('a')) throw new Error('object unavailable');
      await remove(value);
    });
    await expect(jobs.cleanup()).rejects.toThrow(/cleanup/);
    expect((await store.get(intents[1]!.intentId))?.payload.cleanupState).toBe('failed-cleaned');
    expect(await blobs.getBlob(key('b'))).toBeUndefined();
    const debt = await store.get(intents[0]!.intentId);
    expect(debt?.state).toBe('failed');
    expect(debt?.payload.hostCleanupRetries).toBe(1);
    expect(debt?.error).toMatch(/invalid preparation metadata|deletion claim|object unavailable/);
    // A fresh host skips persisted debt and reaches the next page without retrying it immediately.
    await createArtifactHostJobs({ pool, blobs, page, authorize, batchSize: 2 }).cleanup();
    expect((await store.get(intents[2]!.intentId))?.payload.cleanupState).toBe('failed-cleaned');
    expect((await store.get(intents[0]!.intentId))?.payload.hostCleanupRetries).toBe(1);
    expect(await blobs.getBlob(key('a'))).toBeDefined();
    expect(await blobs.getBlob(key('c'))).toBeUndefined();
    if (kind === 'unavailable') {
      blobs.deleteBlob = remove;
      await pool.query(`UPDATE artifacts.object_intents SET payload = jsonb_set(payload, '{cleanupDeadlineMs}',
        payload->'hostCleanupOriginalDeadlineMs') WHERE id = $1`, [intents[0]!.intentId]);
      await jobs.cleanup();
      expect((await store.get(intents[0]!.intentId))?.payload.cleanupState).toBe('failed-cleaned');
      expect(await blobs.getBlob(key('a'))).toBeUndefined();
    }
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

  it('should retain failed erasure for retry after the job is recreated', async () => {
    const { jobs, blobs, page, authorize } = fixture();
    await blobs.putBlob(key('a'), new Uint8Array([1]));
    const remove = blobs.deleteBlob;
    blobs.deleteBlob = vi.fn().mockRejectedValueOnce(new Error('object unavailable')).mockImplementation(remove);
    expect((await jobs.collect(scope)).failures).toHaveLength(1);
    expect(await blobs.getBlob(key('a'))).toBeDefined();
    const restarted = createArtifactHostJobs({ pool, blobs, page, authorize });
    expect((await restarted.collect(scope)).deleted).toEqual([key('a')]);
  });

  it('should resume after a retained page rather than starving later orphan objects', async () => {
    const { jobs, blobs, page, store } = fixture();
    for (const hex of ['a', 'b']) await blobs.putBlob(key(hex), new Uint8Array([1]));
    await store.addRef(blobDigestOfKey(key('a')), 'release');
    page.mockResolvedValueOnce({ keys: [key('a')], cursor: 'next' });
    const first = await jobs.collect(scope);
    page.mockResolvedValueOnce({ keys: [key('b')] });
    expect((await jobs.collect(scope, first.cursor)).deleted).toEqual([key('b')]);
    expect(page).toHaveBeenLastCalledWith(`artifacts/${scope}/blobs/sha256/`, 2, 'next');
  });

  it('should deny erasure when maintenance authority is revoked during a digest wait', async () => {
    const { jobs, blobs, authorize } = fixture();
    await blobs.putBlob(key('a'), new Uint8Array([1]));
    const blocker = await pool.connect();
    await blocker.query('BEGIN');
    await blocker.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      [`artifacts-blob:${blobDigestOfKey(key('a'))}`]);
    const pending = jobs.collect(scope);
    try {
      await vi.waitFor(async () => {
        expect((await pool.query(`SELECT 1 FROM pg_stat_activity WHERE datname = current_database()
          AND wait_event_type = 'Lock' AND pid <> pg_backend_pid()`)).rowCount).toBeGreaterThan(0);
      });
      authorize.mockResolvedValue(false);
    } finally { await blocker.query('ROLLBACK'); blocker.release(); }
    expect((await pending).failures).toHaveLength(1);
    expect(await blobs.getBlob(key('a'))).toBeDefined();
  });

  it('should deny an expired host credential using DB time even when maintenance never runs', async () => {
    const { blobs } = fixture();
    await pool.query(`INSERT INTO users (id, role, account_status) VALUES ('alice', 'editor', 'active');
      INSERT INTO tenants (id, name) VALUES ('tenant-a', 'A');
      INSERT INTO workspaces (id, name, tenant_id) VALUES ('workspace-a', 'A', 'tenant-a');
      INSERT INTO tenant_memberships (tenant_id, user_id, status) VALUES ('tenant-a', 'alice', 'approved');
      INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ('workspace-a', 'alice', 'editor');
      INSERT INTO user_sessions (id, user_id, session_token_hash, expires_at)
        VALUES ('session-a', 'alice', 'hash', clock_timestamp() + interval '60 seconds');`);
    const host = createArtifactHost({ pool, blobs, quotaBytes: 262144,
      async currentIdentity(client, identity) {
        const result = await client.query(`SELECT id FROM user_sessions WHERE id = $1 AND user_id = $2
          AND expires_at > clock_timestamp() FOR SHARE`, [identity.credentialId, identity.subject]);
        return { readable: result.rowCount === 1, writable: result.rowCount === 1 };
      } });
    const identity = { subject: 'alice', tenantId: 'tenant-a', clientId: 'app', credentialId: 'session-a' };
    const bound = await host.bind(identity, 'workspace-a');
    expect((await bound.mcp({ tool: 'artifacts_list', args: {} })).status).toBe(200);
    await pool.query(`UPDATE user_sessions SET expires_at = clock_timestamp() WHERE id = 'session-a'`);
    expect((await bound.mcp({ tool: 'artifacts_list', args: {} })).status).toBe(403);
    expect((await bound.http({ method: 'POST', path: '/ensure',
      body: { bindingName: 'expired', idempotencyKey: 'expired' } })).status).toBe(403);
    await expect(host.bind(identity, 'workspace-a')).rejects.toThrow();
    expect((await pool.query('SELECT count(*)::int AS count FROM artifacts.operation_receipts')).rows[0].count).toBe(0);
  });

  it('should invalidate restored activation and old grants before reopening', async () => {
    const { blobs, page, authorize } = fixture();
    const order: string[] = [];
    const activation = { cleanup: vi.fn(async () => ({ flows: 1, tickets: 1 })),
      invalidate: vi.fn(async () => { order.push('invalidate'); }) };
    let signer = createHmacGrantSigner({ secret: 'before-restore' });
    const oldGrant = signer.issue({ subjectId: 'alice', artifactId: 'artifact' });
    const jobs = createArtifactHostJobs({ pool, blobs, page, authorize, batchSize: 2, activation });
    await jobs.cleanup();
    expect(activation.cleanup).toHaveBeenCalledWith(2);
    await jobs.recover({
      async closeServing() { order.push('closed'); },
      async retireGrantAuthority() { order.push('retire'); signer = createHmacGrantSigner({ secret: 'after-restore' }); },
      async reconcileDenials() { order.push('denials'); },
      async reopenServing() {
        expect(() => signer.verify(oldGrant)).toThrow(/signature/);
        order.push('open');
      },
    });
    expect(order).toEqual(['closed', 'invalidate', 'retire', 'denials', 'open']);
    expect(authorize).toHaveBeenCalledWith('recover');
  });

  it.each(['invalidate', 'retire', 'denials'])('should remain closed when restore %s fails', async stage => {
    const { blobs, page, authorize } = fixture();
    let closed = false;
    const step = async (name: string) => { if (stage === name) throw new Error(`failed ${stage}`); };
    const jobs = createArtifactHostJobs({ pool, blobs, page, authorize,
      activation: { cleanup: async () => ({ flows: 0, tickets: 0 }), invalidate: () => step('invalidate') } });
    const reopenServing = vi.fn(async () => { closed = false; });
    await expect(jobs.recover({ async closeServing() { closed = true; },
      retireGrantAuthority: () => step('retire'), reconcileDenials: () => step('denials'), reopenServing }))
      .rejects.toThrow(`failed ${stage}`);
    expect(closed).toBe(true);
    expect(reopenServing).not.toHaveBeenCalled();
  });

  it('should keep serving closed until the W1.c activation adapter is installed', async () => {
    const { jobs } = fixture();
    const closeServing = vi.fn(async () => {});
    const reopenServing = vi.fn(async () => {});
    await expect(jobs.recover({ closeServing, reopenServing,
      retireGrantAuthority: async () => {}, reconcileDenials: async () => {} })).rejects.toThrow(/activation/);
    expect(closeServing).toHaveBeenCalledOnce();
    expect(reopenServing).not.toHaveBeenCalled();
  });

  it('should preserve a concurrent publication when collection already owns the digest', async () => {
    const { blobs, page, authorize } = fixture();
    await pool.query(`INSERT INTO users (id, role, account_status) VALUES ('alice', 'editor', 'active');
      INSERT INTO tenants (id, name) VALUES ('tenant-a', 'A');
      INSERT INTO workspaces (id, name, tenant_id) VALUES ('workspace-a', 'A', 'tenant-a');
      INSERT INTO tenant_memberships (tenant_id, user_id, status) VALUES ('tenant-a', 'alice', 'approved');
      INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ('workspace-a', 'alice', 'editor');`);
    const host = createArtifactHost({ pool, blobs, quotaBytes: 262144,
      currentIdentity: async () => ({ readable: true, writable: true }) });
    const bound = await host.bind({ subject: 'alice', tenantId: 'tenant-a', clientId: 'app', credentialId: 'session' }, 'workspace-a');
    const ensured = await bound.mcp({ tool: 'artifacts_ensure', args: { bindingName: 'report', idempotencyKey: 'ensure' } });
    expect(ensured.status).toBe(201);
    const text = '<h1>shared</h1>';
    const digest = createHash('sha256').update(text).digest('hex');
    const blob = `artifacts/${bound.invocation.storageScopeId}/blobs/sha256/${digest}`;
    await blobs.putBlob(blob, new TextEncoder().encode(text));
    let deleting!: () => void;
    let resume!: () => void;
    const started = new Promise<void>(resolve => { deleting = resolve; });
    const gate = new Promise<void>(resolve => { resume = resolve; });
    const remove = blobs.deleteBlob;
    blobs.deleteBlob = async value => { deleting(); await gate; await remove(value); };
    const jobs = createArtifactHostJobs({ pool, blobs, page, authorize });
    const collecting = jobs.collect(bound.invocation.storageScopeId);
    await started;
    const publishing = bound.mcp({ tool: 'artifacts_publish', args: { artifactId: (ensured.body as { artifactId: string }).artifactId,
      idempotencyKey: 'publish', files: [{ path: 'index.html', mimeType: 'text/html', text }] } });
    try {
      await vi.waitFor(async () => {
        expect((await pool.query(`SELECT 1 FROM pg_stat_activity WHERE datname = current_database()
          AND wait_event_type = 'Lock' AND pid <> pg_backend_pid()`)).rowCount).toBeGreaterThan(0);
      });
    } finally { resume(); }
    expect((await publishing).status).toBe(201);
    expect((await collecting).failures).toEqual([]);
    expect(await blobs.getBlob(blob)).toEqual(new TextEncoder().encode(text));
  });

  it('should cache bucket privacy for 30 seconds, coalesce refreshes and refuse effects after a failed check', async () => {
    let now = 1000;
    let safe = true;
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
    const send = vi.fn(async (command: unknown) => command instanceof GetPublicAccessBlockCommand
      ? { PublicAccessBlockConfiguration: { BlockPublicAcls: safe, IgnorePublicAcls: true,
        BlockPublicPolicy: true, RestrictPublicBuckets: true } } : {});
    const checks = () => send.mock.calls.filter(([command]) => command instanceof GetPublicAccessBlockCommand).length;
    try {
      const storage = await createPrivateArtifactStorage({ client: { send } as unknown as S3Client, bucket: 'private' });
      const read = () => storage.blobs.getBlob(key('a'));
      const write = () => storage.blobs.putBlob(key('a'), new Uint8Array([1]));
      await Promise.all([read(), write(), storage.blobs.deleteBlob(key('a')),
        storage.blobs.listKeys(key('a')), storage.page(key('a'), 1)]);
      expect(checks()).toBe(1);
      now += 29999;
      await read();
      expect(checks()).toBe(1);
      now++;
      await Promise.all([read(), write()]);
      expect(checks()).toBe(2);
      now += 30000;
      safe = false;
      const calls = send.mock.calls.length;
      await expect(write()).rejects.toThrow(/private/);
      expect(send.mock.calls).toHaveLength(calls + 1);
      expect(checks()).toBe(3);
      safe = true;
      await read();
      expect(checks()).toBe(4);
      now += 30000;
      send.mockRejectedValueOnce(new Error('privacy check unavailable'));
      await expect(read()).rejects.toThrow(/unavailable/);
      await read();
      expect(checks()).toBe(6);
    } finally { clock.mockRestore(); }
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
