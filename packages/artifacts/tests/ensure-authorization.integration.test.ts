import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { createPostgresCommitExecutor } from '../src/adapters/postgres-commit.js';
import { createArtifactCommitBarrier } from '../src/testing.js';
import { createArtifactCommitCoordinator } from '../src/server/commit/coordinator.js';
import type {
  ArtifactAuthorizationDecision, ArtifactCommitContext, ArtifactCommitTransaction, ArtifactInvocationContext,
  CommitPolicyParticipantFactory, FinalizeTxClient,
} from '../src/server/commit/types.js';
import { compileArtifactsProfile, RADAR_ARTIFACTS_PROFILE } from '../src/profile/index.js';
import { createArtifactCommand, createRadarKeyDerivation } from '../src/server/command-identity.js';
import { CommitQuarantineError } from '../src/server/commit/types.js';
import { createGuardedEnsureService, type GuardedEnsureHost } from '../src/server/service.js';
import { createHttpArtifactApp, type HttpAppDeps } from '../src/http.js';
import { createArtifactsToolExecutor } from '../src/mcp-core.js';

const DATABASE_URL = process.env['DATABASE_URL'];
if (DATABASE_URL === undefined || DATABASE_URL.length === 0) throw new Error('needs DATABASE_URL (make test-artifacts-integration)');
const MIGRATIONS = ['0001_artifacts.sql', '0002_lifecycle.sql', '0003_coordinator.sql'].map((name) =>
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations', name), 'utf8'));
const SCOPE = 'scope-l5';
const pool = new Pool({ connectionString: DATABASE_URL });
const setupSchema = async (): Promise<void> => {
  const setup = new Pool({ connectionString: DATABASE_URL });
  await setup.query('DROP SCHEMA IF EXISTS artifacts CASCADE; DROP SCHEMA IF EXISTS ensure_test CASCADE');
  for (const sql of MIGRATIONS) await setup.query(sql);
  await setup.query(`INSERT INTO artifacts.storage_scopes (id, org_id) VALUES ('${SCOPE}', 'org-l5');
    CREATE SCHEMA ensure_test;
    CREATE TABLE ensure_test.policy_revision (id INT PRIMARY KEY CHECK (id = 1), revision TEXT NOT NULL);
    INSERT INTO ensure_test.policy_revision (id, revision) VALUES (1, 'rev-1');
    CREATE TABLE ensure_test.approvals (actor_id TEXT PRIMARY KEY, approved BOOLEAN NOT NULL);
    INSERT INTO ensure_test.approvals (actor_id, approved) VALUES ('alice', true), ('bob', true);
    CREATE TABLE ensure_test.quotas (quota_key TEXT PRIMARY KEY, total INT NOT NULL, used INT NOT NULL);
    INSERT INTO ensure_test.quotas (quota_key, total, used) VALUES ('q-main', 100, 0), ('q-last', 1, 0);
    CREATE TABLE ensure_test.bindings (owner TEXT NOT NULL, name TEXT NOT NULL, scope_id TEXT NOT NULL,
      artifact_id TEXT, attempt TEXT NOT NULL, PRIMARY KEY (owner, name))`);
  await setup.end();
};
const makeParticipantFactory = (quotaKey: string, calls?: { reserveQuota: number }): CommitPolicyParticipantFactory => ({
  createParticipant: (client: FinalizeTxClient, transactionToken: string) => ({
    async readRevision(): Promise<string> {
      const { rows } = await client.query<{ revision: string }>('SELECT revision FROM ensure_test.policy_revision WHERE id = 1 FOR SHARE', []);
      return rows[0]?.revision ?? '';
    },
    async checkApproval(input: { actorId: string }) {
      const { rows } = await client.query<{ approved: boolean }>('SELECT approved FROM ensure_test.approvals WHERE actor_id = $1', [input.actorId]);
      return rows[0]?.approved === true ? { approved: true as const } : { approved: false as const, reason: 'denied' as const };
    },
    async reserveQuota(): Promise<{ reserved: boolean }> {
      if (calls !== undefined) calls.reserveQuota += 1;
      const { rowCount } = await client.query('UPDATE ensure_test.quotas SET used = used + 1 WHERE quota_key = $1 AND used < total', [quotaKey]);
      return { reserved: rowCount > 0 };
    },
    mintFence: (revision: string, invocationId: string) => ({ fenceId: `fence-${transactionToken}`, transactionId: transactionToken, invocationId, policyRevision: revision }),
  }),
});
const allowGuard = async (
  context: ArtifactCommitContext, transaction: ArtifactCommitTransaction,
): Promise<ArtifactAuthorizationDecision> => {
  const revision = await transaction.participant.readRevision();
  const check = await transaction.participant.checkApproval({ actorId: context.actorId, operation: context.operation });
  if (context.policyRevision !== revision) return { allowed: false, reason: 'revoked', publicCode: 'access_denied', status: 403, retriable: false };
  if (!check.approved) return { allowed: false, reason: check.reason ?? 'denied', publicCode: 'access_denied', status: 403, retriable: false };
  return { allowed: true, fence: transaction.participant.mintFence(revision, context.invocationId) };
};
const pgHost = (): GuardedEnsureHost => ({
  async lockBinding(client, binding) {
    await client.query(`INSERT INTO ensure_test.bindings (owner, name, scope_id, artifact_id, attempt)
      VALUES ($1, $2, $3, NULL, $4) ON CONFLICT DO NOTHING`,
    [binding.ownerId, binding.bindingName, binding.storageScopeId, binding.attemptId]);
    await client.query('SELECT artifact_id FROM ensure_test.bindings WHERE owner = $1 AND name = $2 FOR UPDATE', [
      binding.ownerId, binding.bindingName,
    ]);
  },
  async resolveBinding(client, binding) {
    const { rows } = await client.query<{ artifact_id: string | null; scope_id: string }>(
      'SELECT artifact_id, scope_id FROM ensure_test.bindings WHERE owner = $1 AND name = $2',
      [binding.ownerId, binding.bindingName]);
    const found = rows[0];
    if (found === undefined) {
      const artifactId = randomUUID();
      await client.query('INSERT INTO ensure_test.bindings (owner, name, scope_id, artifact_id, attempt) VALUES ($1, $2, $3, $4, $5)',
      [binding.ownerId, binding.bindingName, binding.storageScopeId, artifactId, binding.attemptId]);
      return { artifactId, created: true };
    }
    if (found.scope_id !== binding.storageScopeId) throw new Error(`binding scope mismatch for ${binding.bindingName}`);
    if (found.artifact_id !== null) return { artifactId: found.artifact_id, created: false };
    const artifactId = randomUUID();
    await client.query('UPDATE ensure_test.bindings SET artifact_id = $1, attempt = $2 WHERE owner = $3 AND name = $4',
      [artifactId, binding.attemptId, binding.ownerId, binding.bindingName]);
    return { artifactId, created: true };
  },
  async abandonAttempt(attemptId) {
    await pool.query('DELETE FROM ensure_test.bindings WHERE attempt = $1 AND artifact_id IS NULL', [attemptId]);
  },
  async readPolicyRevision() {
    const { rows } = await pool.query<{ revision: string }>('SELECT revision FROM ensure_test.policy_revision WHERE id = 1');
    return rows[0]?.revision ?? '';
  },
});
let invSeq = 0;
const invoke = (actorId: string): ArtifactInvocationContext =>
  ({ invocationId: `inv-l5-pg-${(invSeq += 1)}`, actorId, storageScopeId: SCOPE, authorizeCommit: allowGuard });
type BarrierArm = { observer: (point: 'after_finalization_locks_before_guard', invocationId: string) => Promise<void>;
  testPoints: readonly ['after_finalization_locks_before_guard'] };
const makeService = (quotaKey: string, quotaCalls?: { reserveQuota: number }, barrier?: BarrierArm) => {
  const coordinator = createArtifactCommitCoordinator({
    executor: createPostgresCommitExecutor(pool),
    policy: makeParticipantFactory(quotaKey, quotaCalls),
    ...(barrier === undefined ? {} : { testObserver: barrier.observer, testPoints: barrier.testPoints }),
  });
  return createGuardedEnsureService({
    profile: compileArtifactsProfile(RADAR_ARTIFACTS_PROFILE),
    coordinator,
    derivation: createRadarKeyDerivation({ storageScopeId: SCOPE, actorIds: ['alice', 'bob'] }),
    host: pgHost(),
  });
};
const countRows = async (table: string, where = '', params: unknown[] = []): Promise<number> => {
  const { rows } = await pool.query<{ n: string }>(`SELECT COUNT(*)::int AS n FROM ${table}${where}`, [...params]);
  return Number(rows[0]?.n ?? 0);
};
const quotaUsed = async (quotaKey: string): Promise<number> => {
  const { rows } = await pool.query<{ used: string }>('SELECT used FROM ensure_test.quotas WHERE quota_key = $1', [quotaKey]);
  return Number(rows[0]?.used ?? 0);
};
const keyFor = (actorId: string, bindingName: string, idempotencyKey: string): string => createArtifactCommand(
  compileArtifactsProfile(RADAR_ARTIFACTS_PROFILE),
  'artifacts_ensure', { bindingName, idempotencyKey },
  { storageScopeId: SCOPE, actorId },
  createRadarKeyDerivation({ storageScopeId: SCOPE, actorIds: ['alice', 'bob'] })).identity.internalKey;
beforeAll(async () => { await setupSchema(); });
afterAll(async () => {
  await pool.query('DROP SCHEMA IF EXISTS artifacts CASCADE; DROP SCHEMA IF EXISTS ensure_test CASCADE');
  await pool.end();
});

describe('ensure authorization', () => {
  it('commits one binding and replays across invocations without recharging quota', async () => {
    const quotaCalls = { reserveQuota: 0 };
    const service = makeService('q-main', quotaCalls);
    const first = await service.ensure(invoke('alice'), { bindingName: 'site-replay', idempotencyKey: 'k-replay' });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.result).toMatchObject({ created: true, replayed: false });
    const second = await service.ensure(invoke('alice'), { bindingName: 'site-replay', idempotencyKey: 'k-replay' });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.result).toEqual({ ...first.result, replayed: true });
    expect(quotaCalls.reserveQuota).toBe(1);
    expect(await countRows('artifacts.operation_receipts')).toBe(1);
    const { rows } = await pool.query<{ artifact_id: string | null }>(
      'SELECT artifact_id FROM ensure_test.bindings WHERE owner = $1 AND name = $2', ['alice', 'site-replay']);
    expect(rows[0]?.artifact_id).toBe(first.result.artifactId);
  });

  it('denies a revoked approval after waits with zero residue, then retries fresh on the same key', async () => {
    const barrier = createArtifactCommitBarrier();
    const service = makeService('q-main', undefined, {
      observer: barrier.observer, testPoints: ['after_finalization_locks_before_guard'],
    });
    const invocationId = 'inv-l5-pg-barrier';
    const invocation: ArtifactInvocationContext = { invocationId, actorId: 'alice', storageScopeId: SCOPE, authorizeCommit: allowGuard };
    const pending = service.ensure(invocation, { bindingName: 'site-barrier', idempotencyKey: 'k-barrier' });
    await barrier.waitUntilReached('after_finalization_locks_before_guard', invocationId);
    await pool.query(`UPDATE ensure_test.approvals SET approved = false WHERE actor_id = 'alice'`);
    barrier.release('after_finalization_locks_before_guard', invocationId);
    const denied = await pending;
    expect(denied.ok).toBe(false);
    if (denied.ok) return;
    expect(denied.failure).toMatchObject({ category: 'unauthorized_at_commit', httpStatus: 403, retriable: false, commitState: 'not_committed' });
    expect(await countRows('artifacts.operation_receipts', ' WHERE internal_key = $1', [keyFor('alice', 'site-barrier', 'k-barrier')])).toBe(0);
    expect(await countRows('ensure_test.bindings', ' WHERE owner = $1 AND name = $2', ['alice', 'site-barrier'])).toBe(0);
    expect(await quotaUsed('q-main')).toBe(1);
    await pool.query(`UPDATE ensure_test.approvals SET approved = true WHERE actor_id = 'alice'`);
    // Fresh unarmed service for the retry: the barrier served its purpose on the denied
    // attempt, and the armed coordinator would pause every later attempt again with no release.
    const retryService = makeService('q-main');
    const retried = await retryService.ensure(invoke('alice'), { bindingName: 'site-barrier', idempotencyKey: 'k-barrier' });
    expect(retried.ok).toBe(true);
    if (!retried.ok) return;
    expect(retried.result).toMatchObject({ created: true, replayed: false });
    const replayed = await retryService.ensure(invoke('alice'), { bindingName: 'site-barrier', idempotencyKey: 'k-barrier' });
    expect(replayed.ok).toBe(true);
    if (!replayed.ok) return;
    expect(replayed.result).toEqual({ ...retried.result, replayed: true });
  });

  it('conflicts on the same key with a different command without an extra release', async () => {
    const service = makeService('q-main');
    const first = await service.ensure(invoke('bob'), { bindingName: 'site-conflict-a', idempotencyKey: 'k-conflict' });
    expect(first.ok).toBe(true);
    const second = await service.ensure(invoke('bob'), { bindingName: 'site-conflict-b', idempotencyKey: 'k-conflict' });
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.failure).toMatchObject({ category: 'conflict', httpStatus: 409, retriable: false, commitState: 'not_committed' });
    expect(await countRows('artifacts.operation_receipts', ' WHERE internal_key = $1', [keyFor('bob', 'site-conflict-a', 'k-conflict')])).toBe(1);
    expect(await countRows('ensure_test.bindings', ' WHERE owner = $1 AND name = $2', ['bob', 'site-conflict-b'])).toBe(0);
  });

  it('grants the last quota unit to exactly one of two competing keys', async () => {
    const service = makeService('q-last');
    const first = await service.ensure(invoke('alice'), { bindingName: 'site-last-a', idempotencyKey: 'k-last-a' });
    expect(first.ok).toBe(true);
    const second = await service.ensure(invoke('alice'), { bindingName: 'site-last-b', idempotencyKey: 'k-last-b' });
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.failure).toMatchObject({ category: 'conflict', httpStatus: 409, commitState: 'not_committed' });
    expect(await quotaUsed('q-last')).toBe(1);
    expect(await countRows('ensure_test.bindings', ' WHERE owner = $1 AND name = $2', ['alice', 'site-last-b'])).toBe(0);
  });

  it('isolates identical caller keys between actors', async () => {
    const service = makeService('q-main');
    const first = await service.ensure(invoke('alice'), { bindingName: 'site-shared', idempotencyKey: 'k-shared' });
    const second = await service.ensure(invoke('bob'), { bindingName: 'site-shared', idempotencyKey: 'k-shared' });
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.result.artifactId).not.toBe(first.result.artifactId);
    expect(second.result.replayed).toBe(false);
    expect(await countRows('artifacts.operation_receipts', ' WHERE internal_key = $1', [keyFor('alice', 'site-shared', 'k-shared')])).toBe(1);
    expect(await countRows('artifacts.operation_receipts', ' WHERE internal_key = $1', [keyFor('bob', 'site-shared', 'k-shared')])).toBe(1);
  });

  it('should converge HTTP and MCP instances on one authorized PostgreSQL receipt', async () => {
    const other = new Pool({ connectionString: DATABASE_URL });
    const profile = compileArtifactsProfile({ ...RADAR_ARTIFACTS_PROFILE,
      selectedCapabilities: ['artifacts_ensure'] });
    const compose = (connectionPool: Pool) => createHttpArtifactApp({
      profile, coordinator: createArtifactCommitCoordinator({
        executor: createPostgresCommitExecutor(connectionPool), policy: makeParticipantFactory('q-main'),
      }),
      derivation: createRadarKeyDerivation({ storageScopeId: SCOPE, actorIds: ['alice', 'bob'] }),
      legacyRecords: { get: async () => undefined }, ensureHost: pgHost(),
      acls: {}, lifecycle: {}, publication: {},
    } as unknown as HttpAppDeps);
    const args = { bindingName: 'transport-race', idempotencyKey: ' cross-transport ' };
    const before = await countRows('artifacts.operation_receipts');
    const used = await quotaUsed('q-main');
    try {
      const http = compose(pool);
      const mcp = createArtifactsToolExecutor({ app: compose(other), profile });
      const [first, second] = await Promise.all([
        http.handle({ method: 'POST', path: '/ensure', actorId: 'alice', body: args }, invoke('alice')),
        mcp.invoke({ tool: 'artifacts_ensure', args, invocation: invoke('alice') }),
      ]);
      expect(first.status).toBe(201);
      expect(second.status).toBe(201);
      expect((first.body as { artifactId: string }).artifactId)
        .toBe((second.body as { artifactId: string }).artifactId);
      expect(await countRows('artifacts.operation_receipts')).toBe(before + 1);
      expect(await quotaUsed('q-main')).toBe(used + 1);
      await pool.query("UPDATE ensure_test.approvals SET approved = false WHERE actor_id = 'alice'");
      expect(await mcp.invoke({ tool: 'artifacts_ensure', args, invocation: invoke('alice') }))
        .toMatchObject({ status: 403, body: { error: 'access_denied' } });
      expect(await countRows('artifacts.operation_receipts')).toBe(before + 1);
    } finally {
      await pool.query("UPDATE ensure_test.approvals SET approved = true WHERE actor_id = 'alice'");
      await other.end();
    }
  });

  it('quarantines unknown legacy codecs instead of replaying them', async () => {
    const service = makeService('q-main');
    const key = keyFor('alice', 'site-legacy', 'k-legacy');
    await pool.query(
      `INSERT INTO artifacts.operation_receipts (storage_scope_id, internal_key, command_codec, command_hash, receipt)
       VALUES ('scope-l5', $1, 'artifacts-command/v0', 'legacy-hash', '{"artifactId":"legacy","created":true}'::jsonb)`,
      [key]);
    await expect(service.ensure(invoke('alice'), { bindingName: 'site-legacy', idempotencyKey: 'k-legacy' }))
      .rejects.toBeInstanceOf(CommitQuarantineError);
    expect(await countRows('ensure_test.bindings', ' WHERE owner = $1 AND name = $2', ['alice', 'site-legacy'])).toBe(0);
  });
});
