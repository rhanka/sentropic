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

// Neutral handle over the installed kernel: the installed Engram
// constructor receives exactly this handle plus the neutral grant.
let kernel;
let fence;
let acquired = false;
const units = [];
const castGrant = (grant) => {
  if (grant.moduleId !== 'engram-memory' || grant.scope.tenantId !== scope.tenantId
    || grant.scope.workspaceId !== scope.workspaceId)
    throw Object.assign(new Error('grant differs from the bound memory scope'), { code: 'unauthorized' });
  return grant;
};
const handle = Object.freeze({
  moduleId: 'engram-memory', backend: 'postgres', descriptor: MEMORY_DESCRIPTOR,
  profiles: MEMORY_PINNED_PROFILES.filter((claim) => MEMORY_DESCRIPTOR.requiredProfiles.includes(claim.name)),
  acquireFence: (input) => guarded(async () => {
    if (JSON.stringify(input.scope) !== JSON.stringify(scope))
      throw Object.assign(new Error('foreign acquisition scope'), { code: 'unauthorized' });
    await kernel.bind(castGrant(input.grant));
    await hostDriver.transaction({ readOnly: false, deadlineMs: 5000 }, async (session) => {
      await kernel.ownership.verify(session);
      await session.execute({ text: `INSERT INTO "${schemaName}".host_memory_identity(scope,store_id) VALUES($1,$2)
        ON CONFLICT DO NOTHING`, values: [JSON.stringify(scope), input.store_id] });
      const rows = await session.execute({ text: `SELECT scope,store_id FROM "${schemaName}".host_memory_identity
        WHERE scope=$1 OR store_id=$2`, values: [JSON.stringify(scope), input.store_id] });
      if (rows.rows.length !== 1 || rows.rows[0].scope !== JSON.stringify(scope) || rows.rows[0].store_id !== input.store_id)
        throw Object.assign(new Error('store_id and scope must be bijective'), { code: 'fence-conflict' });
      await kernel.ownership.verify(session);
    });
    if (acquired) throw Object.assign(new Error('a live canonical holder already owns this host handle'), { code: 'fence-conflict' });
    fence = { fenceId: kernel.ownership.handle.instanceId, epoch: kernel.ownership.handle.storageEpoch };
    await kernel.provisionFence(binding.memoryGrant, fence);
    acquired = true;
    return fence;
  }),
  checkFence: (grant, supplied) => guarded(async () => {
    await kernel.bind(castGrant(grant));
    if (!fence || supplied.fenceId !== fence.fenceId || supplied.epoch !== fence.epoch)
      throw Object.assign(new Error('canonical fence differs'), { code: 'fence-lost' });
  }),
  releaseFence: (supplied) => guarded(async () => {
    if (fence?.fenceId === supplied.fenceId && fence?.epoch === supplied.epoch) {
      await kernel.ownership.release(); acquired = false;
    }
  }),
  transact: (options, operation) => guarded(async () => {
    const bound = await kernel.bind(castGrant(options.grant));
    return bound.transact(options, (tx) => operation(neutralTransaction(tx, units, options.idempotencyKey)));
  }),
  readAggregate: (kind, key, grant) => guarded(async () => {
    const row = await (await kernel.bind(castGrant(grant))).readAggregate(key);
    return row ? { kind, key, version: String(row.version), value: row.value } : null;
  }),
  readCommitResult: (identity, grant) => guarded(async () =>
    (await (await kernel.bind(castGrant(grant)))).readCommitResult(identity, fence)),
  query: (name, encoded, grant) => guarded(async () => {
    const input = JSON.parse(encoded.data);
    const bound = await kernel.bind(castGrant(grant));
    const page = await bound.query(name, input, { limit: input.limit ?? input.max_candidates ?? 2000 });
    return neutralQueryResult(name, page.records);
  }),
});
const scopeBinding = { scope, store_id: storeId,
  resolveScope: (ref) => (ref === 'installed-memory-scope' ? scope : null) };
let clockNow = '2026-10-27T00:00:00.000Z';
let store;
const openStore = async () => {
  kernel = await meshPg.createPostgresKernel({ ...registration, moduleId: 'engram-memory',
    driver: provider.pool, layout, history, cursorSecret: 'installed-memory-secret',
    canonicalOwnership: { leaseMs: 30000 } });
  await kernel.bindNew(binding.memoryGrant);
  await kernel.bindNew(binding.maintainGrant);
  const opened = await substrate.openModuleStorageCanonicalMemoryStoreV1({ handle,
    grant: binding.memoryGrant, scope_binding: scopeBinding,
    clock: { now: () => clockNow }, deadline_at: '2026-10-27T01:00:00.000Z' });
  assert.ok(opened.ok, `installed open refused: ${opened.ok ? '' : `${opened.error.code}: ${opened.error.message}`}`);
  store = opened.value;
};

// Missing required profile: the constructor refuses in its option check,
// before any fence acquisition or durable effect.
const truncatedHandle = Object.freeze({ ...handle,
  profiles: handle.profiles.filter((claim) => claim.name !== 'fenced-writers-v1') });
const refusedOpen = await substrate.openModuleStorageCanonicalMemoryStoreV1({ handle: truncatedHandle,
  grant: binding.memoryGrant, scope_binding: scopeBinding,
  clock: { now: () => clockNow }, deadline_at: '2026-10-27T01:00:00.000Z' });
assert.equal(refusedOpen.ok, false, 'missing profile must refuse');
assert.equal(refusedOpen.error.code, 'CAPABILITY_UNAVAILABLE');
refusals['missing-profile'] = `${refusedOpen.error.code}: ${refusedOpen.error.message}`;

// Real durable memory operations through the installed memory port.
const NOW = '2026-10-27T00:00:00.000Z';
const DEADLINE = '2026-10-27T01:00:00.000Z';
const DIGEST = `sha256:${'a'.repeat(64)}`;
let destroyedTotal = 0;
const makeEngine = () => {
  const plaintext = new Map();
  const crypto = {
    version: 1,
    seal: async (input) => {
      plaintext.set(input.candidate_id, input.plaintext);
      const body = { candidate_id: input.candidate_id, envelope_ref: `envelope-${input.candidate_id}`,
        key_ref: `key-${input.candidate_id}`, ciphertext: `ciphertext-${input.candidate_id}` };
      return { ok: true, value: { ...body, envelope_digest: receiptDigest('sealed-candidate', body) } };
    },
    open: async ({ sealed }) => {
      const value = plaintext.get(sealed.candidate_id);
      return value === undefined
        ? { ok: false, error: { code: 'UNAUTHORIZED', operation: 'inspect_candidate', retryable: false, message: 'key destroyed' } }
        : { ok: true, value: { plaintext: value } };
    },
    destroy: async ({ key_ref }) => {
      plaintext.delete(key_ref.slice(4));
      destroyedTotal += 1;
      return { ok: true, value: { destroyed: true,
        receipt_digest: receiptDigest('key-destruction', { destroyed: true, key_ref }) } };
    },
  };
  return substrate.createMemoryPortV2({
    canonical_store: store, crypto, activity_sources: [], clock: { now: () => NOW },
    authorization: {
      version: 1,
      authorize: async (request) => {
        const body = { allowed: true, decision_id: 'decision-installed', policy_version: '1',
          operation: request.operation, resource_digest: request.resource_digest,
          scope_ref: 'installed-memory-scope', not_before: NOW, expires_at: DEADLINE, revocation_epoch: '0',
          redaction: { mode: 'field-allowlist', allowed_fields: [], allow_derivation_lineage: false, max_packet_bytes: 4096 },
          authentication_receipt_digest: DIGEST };
        return { ok: true, value: { ...body, receipt_digest: receiptDigest('authorization-allowed', body) } };
      },
      revalidate: async (digest, checked_at) => {
        const body = { receipt_digest: digest, checked_at, valid: true, current_revocation_epoch: '0', reason: 'valid' };
        return { ok: true, value: { ...body,
          revalidation_receipt_digest: receiptDigest('authorization-revalidation', body, 'revalidation_receipt_digest') } };
      },
      redact: async () => { throw new Error('unused redaction'); },
    },
    admission_policy: { policy_id: 'policy-installed', policy_version: '1',
      decide: async ({ record_digest }) => {
        const body = { policy_id: 'policy-installed', policy_version: '1', record_digest, decision: 'accept', issued_at: NOW };
        return { ok: true, value: { ...body, receipt_digest: receiptDigest('admission-decision', body) } };
      } },
  });
};
const valueOf = (result) => {
  assert.ok(result.ok, `installed operation refused: ${result.ok ? '' : `${result.error.code}: ${result.error.message}`}`);
  return result.value;
};
const captureRequest = {
  schema_version: 2, idempotency_key: 'installed-idempotency-1',
  payload: { schema_version: 2, scope_ref: 'installed-memory-scope', purpose_ref: 'purpose-installed',
    valid_time: { t: 1 },
    components: [{ component_id: 'component-installed', kind: 'context', text: 'installed memory body',
      citation_ids: ['citation-installed'] }],
    primary_component_id: 'component-installed',
    primary_event: { at: 1, type_ref: 'event-installed', citation_id: 'citation-installed' },
    citations: [{ citation_id: 'citation-installed', source_ref: 'source-installed',
      locator: { scheme: 'document', value: 'installed#one' }, content_digest: DIGEST }],
    retention: { derivative_rule: 'retain' }, reconciliation: { family_refs: [] } },
  evidence: { evidence_ref: 'evidence-installed', evidence_digest: DIGEST, citation_ids: ['citation-installed'] },
  authorization: { credential: 'credential-installed' },
  source_order: { source_ref: 'source-installed', sequence: '1' },
  deadline_at: DEADLINE, cancellation_ref: 'cancel-installed-1',
};

const operations = {};
try {
  await openStore();
  let engine = makeEngine();
  const captured = valueOf(await engine.capture(captureRequest));
  assert.equal(captured.status, 'committed_pending');
  const candidate = { candidate_id: captured.candidate_id };
  const captureProof = valueOf(await store.readCaptureIdempotency(candidate));
  assert.ok(captureProof.record_digest, 'capture proof retained');
  const admitted = valueOf(await engine.requestAdmission({ ...candidate,
    authorization: { credential: 'credential-installed' }, deadline_at: DEADLINE }));
  assert.equal(admitted.status, 'accepted');
  assert.equal(destroyedTotal, 1, 'admission destroys the sealed envelope key');
  const firstOutcome = valueOf(await store.readAdmissionOutcome(candidate));
  const record = valueOf(await store.readRecord({ record_id: firstOutcome.record_id,
    system_as_of: '2', authorization_receipt_digest: DIGEST }));
  assert.equal(record.scope_ref, 'installed-memory-scope');
  const journalBefore = valueOf(await store.readJournal({ after: '0', limit: 10 }));
  assert.equal(journalBefore.length, 2);
  const original = await handle.readCommitResult(journalBefore.at(-1).event_id, binding.memoryGrant);
  assert.equal(JSON.parse(original.data).receipt_digest, admitted.transaction_receipt_digest);
  operations.capture = { candidate_id: captured.candidate_id, record_digest: captureProof.record_digest,
    transaction_receipt_digest: captured.transaction_receipt_digest };
  operations.admission = { status: admitted.status, record_id: firstOutcome.record_id,
    transaction_receipt_digest: admitted.transaction_receipt_digest };
  operations.journal = { events: journalBefore.length, last_event: journalBefore.at(-1).event_id };

  // Restart: close the store, reopen a new kernel and store on the same
  // PostgreSQL schema, then read the retained proofs and replay exactly.
  await store.close();
  clockNow = '2026-10-27T00:30:00.000Z';
  await openStore();
  assert.deepEqual(valueOf(await store.readCaptureIdempotency(candidate)), captureProof);
  assert.deepEqual(valueOf(await store.readAdmissionOutcome(candidate)), firstOutcome);
  assert.deepEqual(valueOf(await store.readJournal({ after: '0', limit: 10 })), journalBefore);
  assert.deepEqual(await handle.readCommitResult(journalBefore.at(-1).event_id, binding.memoryGrant), original);
  engine = makeEngine();
  const replay = valueOf(await engine.capture(captureRequest));
  assert.equal(replay.status, 'duplicate_exact');
  assert.equal(replay.transaction_receipt_digest, captured.transaction_receipt_digest);
  assert.deepEqual(valueOf(await engine.requestAdmission({ ...candidate,
    authorization: { credential: 'credential-installed' }, deadline_at: DEADLINE })), admitted);
  assert.equal(destroyedTotal, 1, 'restart replay must not destroy a second key');
  operations.restart = { capture_replay: replay.status, record_id: firstOutcome.record_id,
    journal_events: journalBefore.length };
  await store.close();
} finally {
  await hostDriver.transaction({ readOnly: false, deadlineMs: 30000 }, (session) =>
    session.execute({ text: `DROP SCHEMA "${schemaName}_projection" CASCADE; DROP SCHEMA "${schemaName}" CASCADE`, values: [] }))
    .catch(() => undefined);
  await pool.end();
}

const runtimeClosure = [...new Set(resolutions.filter((url) => url.startsWith('file://'))
  .map((url) => url.slice(`file://${consumerRoot}/`.length)))].sort();
const receipt = {
  version: 1,
  kind: 'engram-e10-installed-receipt',
  head: process.env.INSTALLED_HEAD ?? null,
  tree: process.env.INSTALLED_TREE ?? null,
  consumer: { node: process.version, platform: process.platform, arch: process.arch,
    root: 'clean-consumer-outside-repository', lockSha256: await sha256File(new URL('./package-lock.json', import.meta.url)) },
  engram: { version: engramPkg.version, tarballSha256: engramSha256, integrity: await integrityOf(engramTgz) },
  clusterMesh: { version: meshPkg.version, tarballSha256: meshSha256, integrity: await integrityOf(meshTgz) },
  p3ManifestSha256: P3_MANIFEST_SHA256,
  postgres: { serverVersion, image: process.env.INSTALLED_PG_IMAGE ?? null,
    driver: provider.identity, statements, transactions },
  migrations: registration.assets.map((asset) => ({ id: asset.id, checksum: asset.checksum })),
  hostHistory: hostHistory.map((row) => row.id),
  profiles: handle.profiles.map((claim) => ({ ...claim })),
  requiredProfiles: [...MEMORY_DESCRIPTOR.requiredProfiles],
  contractDigest: MEMORY_DESCRIPTOR.contractDigest,
  refusals,
  operations,
  runtimeClosure,
};
await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
console.log(JSON.stringify({ ok: true, receipt: receiptPath, operations, refusals }));
