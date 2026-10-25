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
import { ArtifactOperationError } from './dist/server/failures.js';
import { createPostgresCommitExecutor } from './dist/adapters/postgres-commit.js';
import { projectArtifactMcpOutcome, projectArtifactWriteFailure } from './dist/server/outcome-projection.js';
import { createS3BlobStore } from './dist/adapters/s3.js';
import { createMemoryIntentStore } from './dist/server/object-intents.js';
import { createMemoryRefcountStore } from './dist/server/gc.js';
import { encodeToolResult } from '@sentropic/mcp-platform/transport/result-codec';
const input = JSON.parse(process.env.L8C_CASE);
const db = new Pool({ connectionString: process.env.DATABASE_URL });
const inner = createPostgresCommitExecutor(db);
const secret = 'private postgres://user:password@host/bucket SELECT secret';
const cause = input.kind ? new ArtifactOperationError(input.kind)
  : Object.assign(new Error(secret + (input.message || '')), { code: input.code });
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
    if (input.point === 'schema') {
      holder = await db.connect();
      await holder.query('BEGIN');
      await holder.query('LOCK TABLE artifacts.operation_receipts IN ACCESS EXCLUSIVE MODE');
      await client.query("SET LOCAL lock_timeout = '50ms'", []);
      const read = client.readReceipt.bind(client);
      client.readReceipt = (...args) => { injections++; return read(...args); };
    }
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
const publishing = input.point.startsWith('s3-');
const blobs = createS3BlobStore({ bucket: 'l8c-private-bucket', client: {
  async send(command) {
    if (command.constructor.name === 'PutObjectCommand') {
      if (input.point === 's3-put') { injections++; throw cause; }
      return {};
    }
    if (input.point === 's3-get') { injections++; throw cause; }
    return { Body: { async transformToByteArray() { injections++; throw cause; } } };
  },
} });
const app = createHttpArtifactApp({ profile, coordinator: {
  async finalizePrepared(request) {
    dispatches++;
    if (input.point === 'command') {
      injections++;
      await db.query('INSERT INTO artifacts.operation_receipts(storage_scope_id, internal_key, command_codec, command_hash, receipt) VALUES ($1,$2,$3,$4,$5)',
        [request.scopeId, request.internalKey, request.codecVersion, 'different-command', '{}']);
    }
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
}, acls: {
  async listArtifactIds() { injections++; throw cause; },
  async getArtifactAcl() { return { ownerId: 'alice', storageScopeId: input.scope, isPublic: false, withdrawn: false, grants: [] }; },
}, lifecycle: { async stateOf() { return 'active'; }, canRead: () => true },
publication: { blobs, intents: createMemoryIntentStore(), refs: createMemoryRefcountStore(),
  async getCurrent() { return undefined; }, createUnitWriter() { throw new Error('S3 fault must precede finalization'); },
}, publicationUrls: () => ({ stableUrl: 'https://pages.example.test/a', pinnedUrl: 'https://pages.example.test/r' }),
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
const args = publishing ? { artifactId: '00000000-0000-4000-8000-000000000001',
  idempotencyKey: 'same caller key', files: [{ path: 'index.html', mimeType: 'text/html', text: 'hi' }] }
  : write ? { bindingName: 'site', idempotencyKey: 'same caller key' } : {};
try {
  const outcome = input.transport === 'http'
    ? await app.execute({ method: 'POST', path: publishing ? '/publish' : write ? '/ensure' : '/list', body: args, actorId: 'alice' }, invocation)
    : await createArtifactsToolExecutor({ app, profile }).execute({ tool: publishing ? 'artifacts_publish' : write ? 'artifacts_ensure' : 'artifacts_list', args, invocation });
  const descriptor = outcome.ok ? undefined : projectArtifactWriteFailure(outcome.failure, { dispatched: true, write });
  console.log(JSON.stringify({ pid: process.pid, outcome, http: projectArtifactHttpOutcome(outcome),
    mcp: projectArtifactMcpOutcome(outcome, input.id), wire: encodeToolResult(projectArtifactMcpOutcome(outcome, input.id)),
    descriptor, dispatches, injections }));
} finally {
  if (holder) { await holder.query('ROLLBACK'); holder.release(); }
  await db.end();
}
`;

beforeAll(async () => {
  await pool.query('CREATE SCHEMA IF NOT EXISTS artifacts');
  await pool.query(readFileSync(new URL('../migrations/0003_coordinator.sql', import.meta.url), 'utf8'));
  await pool.query('CREATE TABLE IF NOT EXISTS l8c_effects(scope_id text, artifact_id uuid)');
});
afterAll(async () => { await pool.end(); });

interface Fault {
  label: string;
  point: string;
  code?: string;
  kind?: string;
  name?: string;
  message?: string;
  lockClass?: string;
  status?: number;
  category?: string;
  state?: string;
}
const unavailable = (label: string, point: string, code?: string): Fault => ({ label, point, code });
const faults: Fault[] = [
  ...['57P06', '08006', 'artifact_connection_lost', 'ECONNRESET', 'ETIMEDOUT'].map(code => unavailable(code, 'acquire', code)),
  ...['40001', '40P01', '57014'].map(code => unavailable(code, 'non-key', code)),
  ...['binding-identity', 'artifact-lifecycle', 'acl', 'current-pointer', 'authority-revision', 'quota', 'blob-reference-deletion-claim']
    .map(lockClass => ({ ...unavailable(`non-key ${lockClass}`, 'non-key', '55P03'), lockClass })),
  { label: 'qualified scoped key contention', point: 'key', status: 409, category: 'conflict' },
  { label: 'same-key different command', point: 'command', status: 409, category: 'conflict' },
  unavailable('real infrastructure table lock', 'schema'),
  { label: 'guard authority outage', point: 'authority', category: 'unauthorized_at_commit' },
  { label: 'guard policy denial', point: 'deny', status: 403, category: 'unauthorized_at_commit' },
  { label: 'unrecognized lost/conflict text', point: 'acquire', message: ' lost conflict', status: 500, category: 'provider_error' },
  { ...unavailable('lost COMMIT acknowledgement', 'commit-ack', '57P06'), state: 'unknown' },
  ...['57P06', '40001', '57014', 'ERR_STREAM_PREMATURE_CLOSE'].map(code => unavailable(`read ${code}`, 'read', code)),
  ...['s3-put', 's3-get', 's3-stream'].flatMap(point => [
    { label: `${point} timeout`, point, name: 'TimeoutError' },
    unavailable(`${point} body interruption`, point, 'ERR_STREAM_PREMATURE_CLOSE'),
  ]),
  { label: 'typed pool acquisition timeout', point: 'acquire', name: 'TimeoutError' },
  { label: 'typed provider outage', point: 'acquire', kind: 'provider_unavailable' },
  unavailable('unqualified lock timeout', 'acquire', '55P03'),
  unavailable('adapter transaction timeout', 'non-key', 'lock_timeout'),
  { label: 'untyped connection-reset text', point: 'acquire', message: ' connection reset', status: 500, category: 'provider_error' },
  ...['40001', '40P01', '57014'].map(code => unavailable(`confirmed abort at COMMIT ${code}`, 'commit-abort', code)),
];

async function invoke(fault: Fault, transport: string) {
  const scope = `l8c-${crypto.randomUUID()}`;
  const id = `invocation-${crypto.randomUUID()}`;
  const { stdout } = await run(process.execPath, ['--input-type=module', '--eval', worker], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, L8C_CASE: JSON.stringify({ ...fault, lockClass: fault.lockClass ?? 'authority-revision', transport, scope, id }) },
  });
  const result = JSON.parse(stdout);
  const counts = (await pool.query(`SELECT
    (SELECT count(*)::int FROM artifacts.operation_receipts WHERE storage_scope_id=$1) AS receipts,
    (SELECT count(*)::int FROM l8c_effects WHERE scope_id=$1) AS effects`, [scope])).rows[0];
  return { ...result, counts, id };
}

describe('L8c E3 failures across isolated HTTP/MCP processes', () => {
  for (const fault of faults) {
    it(`should classify ${fault.label} without a compensating execution`, async () => {
    const results = await Promise.all(['http', 'mcp'].map(transport => invoke(fault, transport)));
    expect(results[0].pid).not.toBe(results[1].pid);
    for (const result of results) {
      const status = fault.status ?? 503;
      const category = fault.category ?? 'provider_unavailable';
      const code = status === 503 ? 'capability_unavailable' : status === 409 ? 'conflict'
        : status === 403 ? 'access_denied' : 'internal_error';
      expect(result.outcome).toMatchObject({ ok: false, failure: { category, httpStatus: status,
        publicCode: code, retriable: status === 503, invocationId: result.id, commitState: fault.state ?? 'not_committed' } });
      expect(result.http).toEqual({ status, body: { error: code } });
      expect(result.mcp).toMatchObject({ ok: false, auditId: result.id,
        error: { code, message: code, retriable: status === 503 } });
      expect(result.wire).toMatchObject({ isError: true,
        _meta: { auditId: result.id, errorCode: code, retriable: status === 503 } });
      expect(JSON.parse(result.wire.content[0].text)).toEqual({ code, message: code });
      expect(JSON.stringify(result)).not.toMatch(/private|postgres:\/\/|password|SELECT secret/);
      const read = fault.point === 'read';
      expect(result.dispatches).toBe(read || fault.point.startsWith('s3-') ? 0 : 1);
      expect(result.injections).toBe(['deny', 'authority'].includes(fault.point) ? 0 : 1);
      if (read) expect(result.descriptor).toBeUndefined();
      else expect(result.descriptor).toEqual({ invocationId: result.id, operation: fault.point.startsWith('s3-') ? 'publish' : 'ensure',
        reason: category === 'conflict' ? 'provider_conflict' : category, status });
      expect(result.counts).toEqual(fault.point === 'commit-ack' ? { receipts: 1, effects: 1 }
        : fault.point === 'command' ? { receipts: 1, effects: 0 } : { receipts: 0, effects: 0 });
    }
    });
  }
});
