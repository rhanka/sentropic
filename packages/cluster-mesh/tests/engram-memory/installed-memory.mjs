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

// Installed PostgreSQL schema, migration history and kernel. The assets
// load from the installed mesh package bytes, never from a checkout.
const schemaName = `installed_${randomBytes(6).toString('hex')}`;
const layout = { dataSchema: schemaName, projectionSchemas: { 'engram-memory': `${schemaName}_projection` },
  outboxSchema: schemaName };
const history = {
  read: async (session) => (await session.execute({
    text: `SELECT receipt FROM "${schemaName}".host_history ORDER BY ordinal`, values: [],
  })).rows.map((row) => row.receipt),
  complete: async (session, receipt) => {
    await session.execute({ text: `INSERT INTO "${schemaName}".host_history
      VALUES ((SELECT COALESCE(MAX(ordinal),0)+1 FROM "${schemaName}".host_history),$1::jsonb)`,
    values: [JSON.stringify(receipt)] });
  },
};
const registration = await meshMemory.createMemoryPostgresRegistration();
await hostDriver.transaction({ readOnly: false, deadlineMs: 30000 }, async (session) => {
  await session.execute({ text: `CREATE SCHEMA "${schemaName}"; CREATE SCHEMA "${schemaName}_projection";
    CREATE TABLE "${schemaName}".host_history(ordinal integer PRIMARY KEY, receipt jsonb NOT NULL);
    CREATE TABLE "${schemaName}".host_memory_identity(scope text PRIMARY KEY, store_id text UNIQUE NOT NULL)`, values: [] });
  await meshPg.applyPgMigrations(session, layout, registration.assets, history,
    { id: 'installed-memory/001', checksum: 'a'.repeat(64) });
});
const hostHistory = await hostDriver.transaction({ readOnly: true, deadlineMs: 5000 },
  (session) => history.read(session));

// Host wire bridge: preserve memory values and decimal strings exactly;
// validation, allocation, durability and authority stay in the kernel.
const memoryFailure = (error) => {
  const source = error ?? {};
  const codes = { denied: 'unauthorized', 'invalid-command': 'invalid-schema', unavailable: 'store-unavailable',
    'capacity-exceeded': 'limit-exceeded', 'idempotency-conflict': 'digest-conflict',
    'instance-busy': 'fence-conflict', 'stale-epoch': 'fence-lost', 'terminal-loss': 'fence-lost' };
  throw Object.assign(new Error(source.message ?? String(error)), { code: codes[source.code ?? ''] ?? source.code });
};
const guarded = async (run) => { try { return await run(); } catch (error) { return memoryFailure(error); } };
const commitIndexKey = (identity) => JSON.stringify(['memory-host-commit-v1', identity]);
const neutralUnitToPg = (unit) => {
  if (unit.relationships.length || unit.barriers.length || unit.purgeIntents.length)
    throw Object.assign(new Error('unsupported memory effects'), { code: 'invalid-schema' });
  return {
    guards: unit.guards.map((guard) => guard.kind === 'aggregate-version'
      ? { kind: 'aggregate-version', key: guard.aggregateKey, version: guard.version }
      : guard.kind === 'chain-head' ? { kind: 'head', chainId: guard.chain, hash: guard.hash }
        : { kind: 'absent', chainId: guard.chain }),
    records: unit.records.map((row) => ({ key: row.key, bytes: row.value, contentHash: row.contentHash })),
    appends: unit.appends.map((row) => ({ chainId: row.chain,
      record: { id: row.id, hash: row.hash, bytes: row.value.data }, expectation: row.expectation })),
    updates: unit.updates.map((row) => ({ key: row.key, version: row.version, value: row.value })),
    indexWrites: unit.indexWrites.map((row) => ({ key: row.key,
      digest: JSON.parse(row.value.data).record_digest ?? row.value.data, resultIds: [], resultHash: null })),
    relationships: [], barriers: [], purgeIntents: [], moduleResult: unit.moduleResult,
  };
};
const neutralTransaction = (tx, units, identity) => ({
  readAggregate: async (kind, key) => {
    const found = await tx.readAggregate(key);
    return found === null ? null : { kind, key, version: String(found.version), value: found.value };
  },
  readRecords: async (kind, keys) => (await tx.readRecords(keys, { maxRecords: 2000, maxEncodedBytes: 1048576 }))
    .map((row) => ({ kind, key: row.key, value: row.bytes, contentHash: row.contentHash })),
  readChain: ({ chain, afterAllocation = '0', limit }) =>
    tx.readMemoryChain({ chainId: chain, afterAllocation, limit }),
  findIdempotency: async ({ commitIdentity }) => {
    const row = await tx.findIdempotency({ key: commitIndexKey(commitIdentity) });
    return row ? { key: commitIdentity, intentHash: row.digest, moduleResult: JSON.parse(row.resultHash) } : null;
  },
  apply: async (unit) => {
    const translated = neutralUnitToPg(unit);
    const appends = unit.appends.map((row) => row.id);
    const commitIndex = identity ? [{ key: commitIndexKey(identity),
      digest: memoryJcs({ appends, updates: [...appends, ...unit.updates.map((row) => row.key)] }).data,
      resultIds: [], resultHash: JSON.stringify(unit.moduleResult ?? memoryJcs(null)) }] : [];
    await tx.apply({ ...translated, indexWrites: [...translated.indexWrites, ...commitIndex] });
    units.push(structuredClone(unit));
  },
});
const neutralQueryResult = (name, records) => {
  if (name === 'scope-chain-index') {
    const row = records[0];
    return memoryJcs(row ? { chain: row.chainId, head: row.headHash, allocation: row.allocation }
      : { chain: 'memory-journal', head: `sha256:${'0'.repeat(64)}`, allocation: '0' });
  }
  if (name === 'memory-journal-page') return memoryJcs(records.map((event) => ({
    id: event.event_id, hash: event.event_hash, value: memoryJcs(event) })));
  if (name === 'memory-record-by-id') return memoryJcs(records.length ? { found: true, value: memoryJcs(records[0]) } : { found: false });
  return memoryJcs(records);
};
