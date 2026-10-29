// E10 installed injection proof: this file runs only inside the clean
// consumer staged by qualification.mk. Every runtime import must resolve
// from the consumer node_modules (the retained installed bytes); the
// resolution guard below refuses any resolution outside the consumer root.
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { createHash, randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

const phase = process.argv[2];
assert.ok(phase === 'write' || phase === 'reopen', 'usage: installed-memory.mjs write|reopen');
const statePath = new URL('./installed-state.json', import.meta.url);

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

const ENGRAM_TARBALL_SHA256 = '32d47df1880cf5c43b0f16145f75aebeda5fd341d8b1317f3b89acc428bbd05b';
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
assert.equal(engramPkg.version, '0.21.3');
assert.equal(meshPkg.version, '0.24.0-dev.7', 'candidate mesh tarball version');

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
await meshMemory.verifyMemoryPostgresProvider(provider);
const serverVersion = await provider.pool.transaction(
  { isolation: 'serializable', readOnly: true, deadlineMs: 5000 },
  async (session) => (await session.execute({ text: 'SHOW server_version', values: [] })).rows[0].server_version,
);

// Refusals before any durable effect, asserted on typed errors.
const refusals = {};
const expectTypedRefusal = async (name, run, check) => {
  try {
    await run();
  } catch (error) {
    check(error);
    refusals[name] = `${error.name}: ${error.message}`;
    return;
  }
  assert.fail(`${name} must refuse`);
};
const expectDriverRequired = (error) => {
  assert.ok(error instanceof meshMemory.MemoryHostDriverRequiredError,
    `expected MemoryHostDriverRequiredError, got ${error?.name}`);
  assert.equal(error.code, 'HOST_DRIVER_REQUIRED');
};
const expectUnavailable = (error) => {
  assert.equal(error.name, 'StorageUnavailableError');
  assert.equal(error.code, 'unavailable');
};
if (phase === 'write') {
  await expectTypedRefusal('missing-driver',
    () => meshMemory.checkMemoryPostgresDriver(undefined), expectDriverRequired);
  await expectTypedRefusal('missing-pool', () => meshMemory.checkMemoryPostgresDriver(
    { identity: provider.identity, serverFloor: '17.0.0' }), expectDriverRequired);
  await expectTypedRefusal('wrong-driver-identity', () => meshMemory.checkMemoryPostgresDriver(
    { identity: { name: 'node-pg-installed', version: '8.22.0', artifactDigest: 'not-a-digest' },
      serverFloor: '17.0.0', pool: hostDriver }), expectDriverRequired);
  await expectTypedRefusal('storage-without-provider', () => meshMemory.createMemoryPostgresStorage(
    { layout: {}, history: {}, cursorSecret: 'installed-secret' }), expectUnavailable);
  await expectTypedRefusal('wrong-driver-live', () => meshMemory.verifyMemoryPostgresProvider(
    { identity: provider.identity, serverFloor: '99.0.0', pool: hostDriver }), expectUnavailable);
}

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
if (phase === 'write') {
  await expectTypedRefusal('assembly-missing-driver', () => meshMemory.assembleMemoryHostBinding(
    { driver: undefined, maintainGrant, invocationId, storeId }), expectDriverRequired);
}
const binding = meshMemory.assembleMemoryHostBinding({ driver: provider, maintainGrant, invocationId, storeId });
assert.deepEqual([...binding.memoryGrant.operations], ['read', 'write']);
assert.deepEqual([...binding.maintainGrant.operations], ['read', 'maintain']);

// Installed PostgreSQL schema, migration history and kernel. The assets
// load from the installed mesh package bytes, never from a checkout.
const priorState = phase === 'reopen' ? JSON.parse(await readFile(statePath, 'utf8')) : null;
if (priorState) Object.assign(refusals, priorState.refusals);
const schemaName = priorState?.schemaName ?? `installed_${randomBytes(6).toString('hex')}`;
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
if (phase === 'write') {
  await hostDriver.transaction({ readOnly: false, deadlineMs: 30000 }, async (session) => {
    await session.execute({ text: `CREATE SCHEMA "${schemaName}"; CREATE SCHEMA "${schemaName}_projection";
      CREATE TABLE "${schemaName}".host_history(ordinal integer PRIMARY KEY, receipt jsonb NOT NULL);
      CREATE TABLE "${schemaName}".host_memory_identity(scope text PRIMARY KEY, store_id text UNIQUE NOT NULL)`, values: [] });
    await meshPg.applyPgMigrations(session, layout, registration.assets, history,
      { id: 'installed-memory/001', checksum: 'a'.repeat(64) });
  });
}
const hostHistory = phase === 'write'
  ? await hostDriver.transaction({ readOnly: true, deadlineMs: 5000 }, (session) => history.read(session))
  : priorState.hostHistory;

// Memory is constructed only through the installed cluster-mesh export:
// the fenced neutral handle comes from the installed bytes, with the host
// driver, the assembled binding and the opened kernel injected.
const kernel = await meshPg.createPostgresKernel({ ...registration, moduleId: 'engram-memory',
  driver: provider.pool, layout, history, cursorSecret: 'installed-memory-secret',
  canonicalOwnership: { leaseMs: 30000 } });
const installed = meshMemory.createMemoryNeutralHandle({ kernel, binding, driver: hostDriver, schemaName, scope });
const handle = installed.handle;
const scopeBinding = { scope, store_id: storeId,
  resolveScope: (ref) => (ref === 'installed-memory-scope' ? scope : null) };
let clockNow = '2026-10-27T00:00:00.000Z';
let store;
const openStore = async () => {
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
if (phase === 'write') {
  const truncatedHandle = Object.freeze({ ...handle,
    profiles: handle.profiles.filter((claim) => claim.name !== 'fenced-writers-v1') });
  const refusedOpen = await substrate.openModuleStorageCanonicalMemoryStoreV1({ handle: truncatedHandle,
    grant: binding.memoryGrant, scope_binding: scopeBinding,
    clock: { now: () => clockNow }, deadline_at: '2026-10-27T01:00:00.000Z' });
  assert.equal(refusedOpen.ok, false, 'missing profile must refuse');
  assert.equal(refusedOpen.error.code, 'CAPABILITY_UNAVAILABLE');
  refusals['missing-profile'] = `${refusedOpen.error.code}: ${refusedOpen.error.message}`;
}

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

const operations = priorState?.operations ?? {};
try {
  if (phase === 'write') {
    await openStore();
    const fenceEpochWrite = installed.getFence()?.epoch;
    assert.ok(typeof fenceEpochWrite === 'string', 'write fence epoch retained');
    const engine = makeEngine();
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
    await store.close();
    await writeFile(statePath, `${JSON.stringify({ schemaName, refusals, hostHistory, operations,
      captureProof, firstOutcome, journalBefore, original, captured, admitted, candidate,
      fenceEpochWrite, statements, transactions }, null, 2)}\n`);
    console.log(JSON.stringify({ ok: true, phase, schemaName, fenceEpochWrite }));
  } else {
    const { captureProof, firstOutcome, journalBefore, original, captured, admitted, candidate } = priorState;
    clockNow = '2026-10-27T00:30:00.000Z';
    await openStore();
    const fenceEpochReopen = installed.getFence()?.epoch;
    assert.ok(typeof fenceEpochReopen === 'string', 'reopen fence epoch retained');
    assert.equal(BigInt(fenceEpochReopen), BigInt(priorState.fenceEpochWrite) + 1n,
      'exact u64 epoch advance across processes');
    operations.epochs = { write: priorState.fenceEpochWrite, reopen: fenceEpochReopen,
      advance: (BigInt(fenceEpochReopen) - BigInt(priorState.fenceEpochWrite)).toString() };
    assert.deepEqual(valueOf(await store.readCaptureIdempotency(candidate)), captureProof);
    assert.deepEqual(valueOf(await store.readAdmissionOutcome(candidate)), firstOutcome);
    assert.deepEqual(valueOf(await store.readJournal({ after: '0', limit: 10 })), journalBefore);
    assert.deepEqual(await handle.readCommitResult(journalBefore.at(-1).event_id, binding.memoryGrant), original);
    const engine = makeEngine();
    const replay = valueOf(await engine.capture(captureRequest));
    assert.equal(replay.status, 'duplicate_exact');
    assert.equal(replay.transaction_receipt_digest, captured.transaction_receipt_digest);
    assert.deepEqual(valueOf(await engine.requestAdmission({ ...candidate,
      authorization: { credential: 'credential-installed' }, deadline_at: DEADLINE })), admitted);
    assert.equal(destroyedTotal, 0, 'restart replay must not destroy a second key');
    operations.restart = { capture_replay: replay.status, record_id: firstOutcome.record_id,
      journal_events: journalBefore.length, processes: 2 };
    await store.close();
  }
  if (phase === 'reopen') {
    const { installedHydrationRefusals } = await import('./installed-hydration.mjs');
    operations.hydration = await installedHydrationRefusals({ grant: binding.memoryGrant,
      scopeBinding, now: NOW, deadline: DEADLINE, digest: DIGEST });
  }
} finally {
  if (phase === 'reopen') {
    await hostDriver.transaction({ readOnly: false, deadlineMs: 30000 }, (session) =>
      session.execute({ text: `DROP SCHEMA "${schemaName}_projection" CASCADE; DROP SCHEMA "${schemaName}" CASCADE`, values: [] }))
      .catch(() => undefined);
  }
  await pool.end();
}
if (phase === 'write') process.exit(0);

const runtimeClosure = [...new Set(resolutions.filter((url) => url.startsWith('file://'))
  .map((url) => url.slice(`file://${consumerRoot}/`.length)))].sort();
const receipt = {
  version: 1,
  kind: 'engram-e10-installed-receipt',
  head: process.env.INSTALLED_HEAD ?? null,
  tree: process.env.INSTALLED_TREE ?? null,
  consumer: { node: process.version, platform: process.platform, arch: process.arch,
    root: 'clean-consumer-outside-repository', lockSha256: await sha256File(new URL('./package-lock.json', import.meta.url)),
    npmVersion: null },
  engram: { version: engramPkg.version, tarballSha256: engramSha256, integrity: await integrityOf(engramTgz) },
  clusterMesh: { version: meshPkg.version, tarballSha256: meshSha256, integrity: await integrityOf(meshTgz),
    fileListSha256: process.env.INSTALLED_MESH_FILELIST_SHA256 ?? null },
  p3ManifestSha256: P3_MANIFEST_SHA256,
  qualificationImage: process.env.INSTALLED_QUAL_IMAGE ?? null,
  tupleCoverage: 'full',
  postgres: { serverVersion, image: process.env.INSTALLED_PG_IMAGE ?? null,
    driver: provider.identity, statements: (priorState?.statements ?? 0) + statements,
    transactions: (priorState?.transactions ?? 0) + transactions },
  migrations: registration.assets.map((asset) => ({ id: asset.id, checksum: asset.checksum })),
  hostHistory: hostHistory.map((row) => row.id),
  declaredProfileClaims: handle.profiles.map((claim) => ({ ...claim, status: 'declared' })),
  fiveProfileEquivalence: { status: 'not-covered', reason: 'This E10 injection lane does not run Stage B; E11 binds its separate installed campaign.' },
  requiredProfiles: [...MEMORY_DESCRIPTOR.requiredProfiles],
  contractDigest: MEMORY_DESCRIPTOR.contractDigest,
  refusals,
  operations,
  runtimeClosure,
};
await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
console.log(JSON.stringify({ ok: true, receipt: receiptPath, operations, refusals }));
