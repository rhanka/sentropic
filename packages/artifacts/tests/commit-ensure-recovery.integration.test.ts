import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { createPostgresCommitExecutor } from '../src/adapters/postgres-commit.js';
import { createArtifactCommitCoordinator } from '../src/server/commit/coordinator.js';
import { createGuardedEnsureService, type GuardedEnsureHost } from '../src/server/service.js';
import { createArtifactCommand, createRadarKeyDerivation } from '../src/server/command-identity.js';
import { compileArtifactsProfile, RADAR_ARTIFACTS_PROFILE } from '../src/profile/index.js';
import { createArtifactCommitBarrier } from '../src/testing.js';
import type { ArtifactInvocationContext, AuthorizeCommit, CommitExecutor,
  CommitPolicyParticipantFactory, CoordinatorTestPoint } from '../src/server/commit/types.js';

// Upstream provider evidence only: Radar H3 quota/admission integration is not covered.
const connectionString = process.env['DATABASE_URL'];
if (!connectionString) throw new Error('Use make test-artifacts-integration with DATABASE_URL');
const pool = new Pool({ connectionString });
const scope = 'scope-l8b';
const profile = compileArtifactsProfile(RADAR_ARTIFACTS_PROFILE);
const derivation = createRadarKeyDerivation({ storageScopeId: scope, actorIds: ['alice'] });
const command = (key: string, bindingName = key) => createArtifactCommand(profile, 'artifacts_ensure',
  { bindingName, idempotencyKey: key }, { storageScopeId: scope, actorId: 'alice' }, derivation);
const args = (key: string) => ({ bindingName: key, idempotencyKey: key });
const guard: AuthorizeCommit = async (context, transaction) => {
  const admission = await transaction.participant.checkApproval({ actorId: context.actorId, operation: 'ensure' });
  if (!admission.approved) return { allowed: false, reason: 'revoked', publicCode: 'access_denied', status: 403, retriable: false };
  return { allowed: true, fence: transaction.participant.mintFence(context.policyRevision, context.invocationId) };
};
const invocation = (invocationId: string): ArtifactInvocationContext => ({
  invocationId, actorId: 'alice', storageScopeId: scope, authorizeCommit: guard,
});
const policy: CommitPolicyParticipantFactory = {
  createParticipant: (client, token) => ({
    async readRevision() {
      const { rows } = await client.query<{ revision: string }>('SELECT revision FROM l8b.revision FOR SHARE', []);
      return rows[0]!.revision;
    },
    async checkApproval() {
      const { rows } = await client.query<{ approved: boolean }>('SELECT approved FROM l8b.admission', []);
      return { approved: rows[0]!.approved };
    },
    async reserveQuota() {
      const result = await client.query('UPDATE l8b.quota SET used = used + 1 WHERE used < total', []);
      return { reserved: result.rowCount === 1 };
    },
    mintFence: (revision, invocationId) => ({ fenceId: randomUUID(), transactionId: token, invocationId, policyRevision: revision }),
  }),
};
function compose(db = pool, options: { executor?: CommitExecutor; barrier?: ReturnType<typeof createArtifactCommitBarrier>;
  points?: readonly CoordinatorTestPoint[] } = {}) {
  const created = new Map<string, boolean>();
  const host: GuardedEnsureHost = {
    async lockBinding(client, binding) {
      const inserted = await client.query(`INSERT INTO artifacts.artifacts (id, storage_scope_id, owner_id, binding_name)
        VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
      [randomUUID(), scope, binding.ownerId, binding.bindingName]);
      created.set(binding.attemptId, inserted.rowCount === 1);
      await client.query(`SELECT id FROM artifacts.artifacts
        WHERE storage_scope_id = $1 AND owner_id = $2 AND binding_name = $3 FOR UPDATE`,
      [scope, binding.ownerId, binding.bindingName]);
    },
    async resolveBinding(client, binding) {
      const { rows } = await client.query<{ id: string }>(`SELECT id FROM artifacts.artifacts
        WHERE storage_scope_id = $1 AND owner_id = $2 AND binding_name = $3`, [scope, binding.ownerId, binding.bindingName]);
      const artifactId = rows[0]!.id;
      await client.query(`INSERT INTO artifacts.artifact_access (artifact_id, principal_id, permission)
        VALUES ($1, $2, 'read') ON CONFLICT DO NOTHING`, [artifactId, binding.ownerId]);
      return { artifactId, created: created.get(binding.attemptId) === true };
    },
    abandonAttempt: async (attemptId) => { created.delete(attemptId); },
    readPolicyRevision: async () => {
      const { rows } = await db.query<{ revision: string }>('SELECT revision FROM l8b.revision');
      return rows[0]!.revision;
    },
  };
  return createGuardedEnsureService({ profile, derivation, host,
    coordinator: createArtifactCommitCoordinator({ executor: options.executor ?? createPostgresCommitExecutor(db), policy,
      ...(options.barrier ? { testObserver: options.barrier.observer, testPoints: options.points } : {}) }),
  });
}
async function snapshot() {
  const { rows } = await pool.query(`SELECT
    (SELECT count(*)::int FROM artifacts.artifacts) AS bindings,
    (SELECT count(*)::int FROM artifacts.artifacts WHERE lifecycle_state = 'active') AS lifecycle,
    (SELECT count(*)::int FROM artifacts.artifact_access) AS acls,
    (SELECT count(*)::int FROM artifacts.operation_receipts) AS receipts,
    (SELECT count(*)::int FROM artifacts.idempotency_keys) AS legacy,
    (SELECT used FROM l8b.quota) AS used`);
  return rows[0];
}
beforeAll(async () => {
  await pool.query('DROP SCHEMA IF EXISTS artifacts CASCADE; DROP SCHEMA IF EXISTS l8b CASCADE');
  for (const name of ['0001_artifacts.sql', '0002_lifecycle.sql', '0003_coordinator.sql']) {
    await pool.query(readFileSync(new URL(`../migrations/${name}`, import.meta.url), 'utf8'));
  }
  await pool.query(`CREATE SCHEMA l8b;
    CREATE TABLE l8b.revision (revision TEXT NOT NULL); INSERT INTO l8b.revision VALUES ('r1');
    CREATE TABLE l8b.admission (approved BOOLEAN NOT NULL); INSERT INTO l8b.admission VALUES (true);
    CREATE TABLE l8b.quota (total INT NOT NULL, used INT NOT NULL); INSERT INTO l8b.quota VALUES (100, 0)`);
});
beforeEach(async () => {
  await pool.query(`TRUNCATE artifacts.artifacts, artifacts.operation_keys, artifacts.operation_receipts,
    artifacts.idempotency_keys CASCADE; UPDATE l8b.admission SET approved = true;
    UPDATE l8b.quota SET total = 100, used = 0`);
});
afterAll(async () => {
  await pool.query('DROP SCHEMA IF EXISTS artifacts CASCADE; DROP SCHEMA IF EXISTS l8b CASCADE');
  await pool.end();
});

describe('L8b ensure recovery on PostgreSQL', () => {
  it('should commit binding, ACL, active lifecycle, receipt and quota together', async () => {
    expect(await compose().ensure(invocation('initial'), args('initial'))).toMatchObject({ ok: true,
      result: { created: true, replayed: false } });
    expect(await snapshot()).toEqual({ bindings: 1, lifecycle: 1, acls: 1, receipts: 1, legacy: 0, used: 1 });
  });
});
