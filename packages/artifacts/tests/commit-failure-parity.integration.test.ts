/** E3 qualification: real PG coordinator, isolated HTTP/MCP processes, injected adapter faults.
 * Accounting here proves descriptors only; Radar owns durable ledger acceptance.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync } from 'node:fs';
import { Pool } from 'pg';

const run = promisify(execFile);
const pool = new Pool({ connectionString: process.env['DATABASE_URL'] });
if (!process.env['DATABASE_URL']) throw new Error('L8c requires make test-artifacts-integration');

// Child processes load built provider bytes, never Vitest-transformed source or shared cause slots.
const worker = String.raw`
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { createHttpArtifactApp, projectArtifactHttpOutcome } from './dist/http.js';
import { createArtifactsToolExecutor } from './dist/mcp-core.js';
import { compileArtifactsProfile, RADAR_ARTIFACTS_PROFILE } from './dist/profile/index.js';
import { createRadarKeyDerivation } from './dist/server/command-identity.js';
import { createArtifactCommitCoordinator } from './dist/server/commit/coordinator.js';
import { createPostgresCommitExecutor } from './dist/adapters/postgres-commit.js';
import { projectArtifactMcpOutcome, projectArtifactWriteFailure } from './dist/server/outcome-projection.js';
const input = JSON.parse(process.env.L8C_CASE);
const db = new Pool({ connectionString: process.env.DATABASE_URL });
const inner = createPostgresCommitExecutor(db);
const secret = 'private postgres://user:password@host/bucket SELECT secret';
const cause = Object.assign(new Error(secret + (input.message || '')), { code: input.code });
if (input.name) cause.name = input.name;
let dispatches = 0;
let injections = 0;
let holder;
const inject = async (client) => {
  injections++;
  if (/^[0-9A-Z]{5}$/.test(input.code || '')) {
    await client.query("DO $fault$ BEGIN RAISE EXCEPTION USING ERRCODE = '" + input.code + "', MESSAGE = '" + secret + "'; END $fault$", []);
  }
  throw cause;
};
const executor = {
  ensureCoordinationRow: (...args) => inner.ensureCoordinationRow(...args),
  async beginFinalization() {
    if (input.point === 'acquire') { injections++; throw cause; }
    const client = await inner.beginFinalization();
    const lock = client.lockOperationKey.bind(client);
    client.lockOperationKey = async (scope, key) => {
      if (input.point === 'key') {
        holder = await db.connect();
        await holder.query('BEGIN');
        await holder.query('SELECT 1 FROM artifacts.operation_keys WHERE storage_scope_id=$1 AND internal_key=$2 FOR UPDATE', [scope, key]);
        await client.query("SET LOCAL lock_timeout = '50ms'", []);
        injections++;
      }
      return lock(scope, key);
    };
    const commit = client.commit.bind(client);
    client.commit = async () => {
      if (input.point === 'commit-abort') return inject(client);
      await commit();
      if (input.point === 'commit-ack') { injections++; throw cause; }
    };
    return client;
  },
};
const coordinator = createArtifactCommitCoordinator({ executor, policy: {
  createParticipant: (client, transactionId) => ({
    async readRevision() { return 'rev-1'; }, async checkApproval() { return { approved: true }; },
    async reserveQuota() { return { reserved: true }; },
    mintFence: (policyRevision, invocationId) => ({ fenceId: randomUUID(), transactionId, invocationId, policyRevision }),
  }),
} });
const profile = compileArtifactsProfile(RADAR_ARTIFACTS_PROFILE);
const app = createHttpArtifactApp({ profile, coordinator: {
  async finalizePrepared(request) {
    dispatches++;
    if (input.point === 'non-key') request = { ...request, locks: {
      ...request.locks, [input.lockClass]: [client => inject(client)],
    } };
    return coordinator.finalizePrepared(request);
  }, replayPrepared: request => coordinator.replayPrepared(request),
}, derivation: createRadarKeyDerivation({ storageScopeId: input.scope, actorIds: ['alice'] }),
legacyRecords: { async get() { return undefined; } },
ensureHost: {
  async readPolicyRevision() { return 'rev-1'; }, async lockBinding() {}, async abandonAttempt() {},
  async resolveBinding(client) {
    const artifactId = randomUUID();
    await client.query('INSERT INTO l8c_effects(scope_id, artifact_id) VALUES ($1,$2)', [input.scope, artifactId]);
    return { artifactId, created: true };
  },
}, acls: { async listArtifactIds() { injections++; throw cause; } },
});
const invocation = { invocationId: input.id, actorId: 'alice', storageScopeId: input.scope,
  async authorizeCommit(context, tx) {
    if (input.point === 'deny' || input.point === 'authority') return { allowed: false,
      reason: input.point === 'deny' ? 'revoked' : 'unavailable',
      status: input.point === 'deny' ? 403 : 503,
      publicCode: input.point === 'deny' ? 'access_denied' : 'capability_unavailable', retriable: input.point !== 'deny' };
    return { allowed: true, fence: tx.participant.mintFence(context.policyRevision, context.invocationId) };
  },
};
const write = input.point !== 'read';
const args = write ? { bindingName: 'site', idempotencyKey: 'same caller key' } : {};
try {
  const outcome = input.transport === 'http'
    ? await app.execute({ method: 'POST', path: write ? '/ensure' : '/list', body: args, actorId: 'alice' }, invocation)
    : await createArtifactsToolExecutor({ app, profile }).execute({ tool: write ? 'artifacts_ensure' : 'artifacts_list', args, invocation });
  const descriptor = outcome.ok ? undefined : projectArtifactWriteFailure(outcome.failure, { dispatched: true, write });
  console.log(JSON.stringify({ pid: process.pid, outcome, http: projectArtifactHttpOutcome(outcome),
    mcp: projectArtifactMcpOutcome(outcome, input.id), descriptor, dispatches, injections }));
} finally {
  if (holder) { await holder.query('ROLLBACK'); holder.release(); }
  await db.end();
}
`;
