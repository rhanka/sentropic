// E10 installed injection proof: this file runs only inside the clean
// consumer staged by qualification.mk. Every runtime import must resolve
// from the consumer node_modules (the retained installed bytes); the
// resolution guard below refuses any resolution outside the consumer root.
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { createHash, randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

const consumerRoot = process.env.INSTALLED_CONSUMER_ROOT;
const receiptPath = process.env.INSTALLED_RECEIPT;
const pgUrl = process.env.CM_PG_URL;
assert.ok(consumerRoot && receiptPath && pgUrl, 'installed consumer env is required');
const resolutions = [];
registerHooks({
  resolve(specifier, context, next) {
    const result = next(specifier, context);
    resolutions.push(result.url);
    if (result.url.startsWith('file://')) {
      assert.ok(
        result.url.startsWith(`file://${consumerRoot}/`),
        `checkout resolution refused: ${specifier} -> ${result.url}`,
      );
    }
    return result;
  },
});

const ENGRAM_TARBALL_SHA256 = '26a0edd50c338f30593d22ae1f06ac13d82f5557f18558750659bcfefec64c10';
const P3_MANIFEST_SHA256 = '1c96bada2a749155f29aae763fa73ea6379c385d619f70614110f59b6b10b730';
const sha256File = async (path) => createHash('sha256').update(await readFile(path)).digest('hex');
const sha256Text = (text) => createHash('sha256').update(text, 'utf8').digest('hex');
const integrityOf = async (path) =>
  `sha512-${createHash('sha512').update(await readFile(path)).digest('base64')}`;

const engramTgz = process.env.INSTALLED_ENGRAM_TGZ;
const meshTgz = process.env.INSTALLED_MESH_TGZ;
assert.ok(engramTgz && meshTgz, 'installed tarball paths are required');
const engramSha256 = await sha256File(engramTgz);
const meshSha256 = await sha256File(meshTgz);
assert.equal(engramSha256, ENGRAM_TARBALL_SHA256, 'engram tarball bytes differ from the pinned candidate');
assert.equal(await sha256File(process.env.INSTALLED_P3_MANIFEST), P3_MANIFEST_SHA256,
  'p3 manifest bytes differ from the pinned manifest');

const meshPkg = JSON.parse(await readFile(
  new URL('./node_modules/@sentropic/cluster-mesh/package.json', import.meta.url), 'utf8'));
const engramPkg = JSON.parse(await readFile(
  new URL('./node_modules/@sentropic/engram/package.json', import.meta.url), 'utf8'));
assert.equal(engramPkg.version, '0.22.0');
assert.equal(meshPkg.version, '0.24.0-dev.1', 'candidate mesh tarball version');

const pg = (await import('pg')).default;
const meshMemory = await import('@sentropic/cluster-mesh/engram-memory');
const meshPg = await import('@sentropic/cluster-mesh/storage/postgres');
const substrate = await import('@sentropic/engram/memory-substrate');
const { canonicalizeMemoryJcs, memoryJcs, MEMORY_DESCRIPTOR, MEMORY_PINNED_PROFILES } = meshMemory;
const receiptDigest = (kind, value, field = 'receipt_digest') => {
  const body = { ...value };
  delete body[field];
  return `sha256:${sha256Text(`graphify-memory/${kind}/v1\0${canonicalizeMemoryJcs(body)}`)}`;
};

// Host-owned PostgreSQL driver closure: the installed `pg` pool is the
// only database edge. The provider describes this exact live pool.
const pool = new pg.Pool({ connectionString: pgUrl, max: 8, connectionTimeoutMillis: 2000 });
let statements = 0;
let transactions = 0;
const hostDriver = {
  transaction: async (options, operation) => {
    const client = await pool.connect();
    transactions += 1;
    let expired = false;
    const timer = setTimeout(() => { expired = true; client.release(true); }, options.deadlineMs);
    try {
      await client.query(`BEGIN ISOLATION LEVEL SERIALIZABLE ${options.readOnly ? 'READ ONLY' : 'READ WRITE'}`);
      const result = await operation({
        execute: (statement) => { statements += 1; return client.query(statement.text, statement.values); },
      });
      await client.query('COMMIT');
      return result;
    } catch (error) {
      if (!expired) await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      clearTimeout(timer);
      if (!expired) client.release();
    }
  },
};
const pgPackageBytes = await readFile(new URL('./node_modules/pg/package.json', import.meta.url), 'utf8');
const provider = {
  identity: { name: 'node-pg-installed', version: JSON.parse(pgPackageBytes).version,
    artifactDigest: sha256Text(pgPackageBytes) },
  serverFloor: '17.0.0',
  pool: hostDriver,
};
const serverVersion = await provider.pool.transaction(
  { isolation: 'serializable', readOnly: true, deadlineMs: 5000 },
  async (session) => (await session.execute({ text: 'SHOW server_version', values: [] })).rows[0].server_version,
);

// Refusals before any durable effect: missing driver, a wrong driver
// identity and a provider without the live pool are each refused.
const refusals = {};
const expectRefusal = async (name, run, pattern) => {
  try {
    await run();
  } catch (error) {
    assert.match(`${error.name}: ${error.message}`, pattern, name);
    refusals[name] = `${error.name}: ${error.message}`;
    return;
  }
  assert.fail(`${name} must refuse`);
};
await expectRefusal('missing-driver', () => meshMemory.checkMemoryPostgresDriver(undefined), /driver/);
await expectRefusal('missing-pool', () => meshMemory.checkMemoryPostgresDriver(
  { identity: provider.identity, serverFloor: '17.0.0' }), /pool/);
await expectRefusal('wrong-driver-identity', () => meshMemory.checkMemoryPostgresDriver(
  { identity: { name: 'node-pg-installed', version: '8.16.3', artifactDigest: 'not-a-digest' },
    serverFloor: '17.0.0', pool: hostDriver }), /identity|digest/);
await expectRefusal('storage-without-provider', () => meshMemory.createMemoryPostgresStorage(
  { layout: {}, history: {}, cursorSecret: 'installed-secret' }), /provider/);
meshMemory.checkMemoryPostgresDriver(provider);

// Host grants: the maintain grant stays host-side; Engram receives only
// the derived neutral grant with exactly ['read', 'write'].
const scope = { tenantId: 'tenant-installed', workspaceId: 'workspace-installed' };
const invocationId = 'inv-installed-1';
const storeId = 'installed-memory-store';
const maintainGrant = {
  token: 'installed-maintain-token', moduleId: 'engram-memory', scope,
  principalId: 'installed-host-principal', operations: ['read', 'maintain'],
  issuer: 'installed-host', authorityRevision: '1', policyRevision: '1',
  moduleAuthority: null, lifetime: { kind: 'invocation', invocationId },
};
const binding = meshMemory.assembleMemoryHostBinding({ driver: provider, maintainGrant, invocationId, storeId });
assert.deepEqual([...binding.memoryGrant.operations], ['read', 'write']);
assert.deepEqual([...binding.maintainGrant.operations], ['read', 'maintain']);
