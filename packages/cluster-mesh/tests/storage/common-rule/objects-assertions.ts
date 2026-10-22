import assert from 'node:assert/strict';
import { BUDGET, type CommonManifestBody, type ObjectFixtureFactory, type ObjectRef } from './kit.js';
import { sha256 } from './objects-reference.js';
import { COMMON_RULE_VECTORS } from './vectors.js';

export const objectRef = (bytes: Uint8Array, id = 'object'): ObjectRef => ({
  id, locator: `common/${id}`, scope: 'workspace-a', version: '1', byteLength: bytes.byteLength, sha256: sha256(bytes),
});
const manifest = (refs: readonly ObjectRef[]): CommonManifestBody => ({
  ...JSON.parse(COMMON_RULE_VECTORS[0].canonicalBytes), objects: refs, terminal: { count: String(refs.length), complete: true },
});
export const assertCT01 = async (makeFixture: ObjectFixtureFactory): Promise<void> => {
  const f = makeFixture();
  assert.ok(f?.clients?.length === 2 && f.counters, 'missing CT-01 fixture/instrumentation');
  const bytes = Buffer.from('é immutable bytes'), ref = objectRef(bytes);
  const receipts = await Promise.all(f.clients.map((c) => c.create(ref, bytes)));
  assert.deepEqual(receipts, [ref, ref]);
  const other = Buffer.from('different verified bytes'), unequal = objectRef(other);
  const retry = await Promise.allSettled([f.clients[1].create(unequal, other)]);
  assert.deepEqual(f.inspect(ref), Uint8Array.from(bytes), 'CT-01: first accepted bytes remain unchanged');
  assert.equal(retry[0].status, 'rejected');
  assert.deepEqual(await f.clients[0].create(ref, bytes), receipts[0]);
  assert.deepEqual(await f.reopen().clients[0].read(ref, BUDGET), Uint8Array.from(bytes));
  await assert.rejects(f.reopen().clients[0].create(unequal, other), /conflict/);
  const race = makeFixture(), contenders = [bytes, other];
  const outcomes = await Promise.allSettled(contenders.map((b, i) => race.clients[i].create(objectRef(b), b)));
  assert.equal(outcomes.filter((o) => o.status === 'fulfilled').length, 1);
  assert.equal(outcomes.filter((o) => o.status === 'rejected').length, 1);
  const owned = Buffer.from(bytes), original = Uint8Array.from(owned), ownedRef = objectRef(owned, 'owned');
  const pending = f.clients[0].create(ownedRef, owned);
  owned.fill(0);
  await pending;
  assert.deepEqual(await f.clients[0].read(ownedRef, BUDGET), original);
  const returned = await f.clients[0].read(ownedRef, BUDGET);
  returned.fill(0);
  assert.deepEqual(await f.clients[0].read(ownedRef, BUDGET), original);
  for (const bad of [{ ...ref, sha256: '0'.repeat(64) }, { ...ref, byteLength: 1 }, { ...ref, id: 'sha256:wrong' }]) {
    await assert.rejects(f.clients[0].create(bad, bytes), /corrupt/);
  }
  for (const exists of [false, true]) {
    const foreign = { ...ref, scope: 'workspace-b', locator: 'foreign/private' };
    if (exists) await f.client('workspace-b').create(foreign, bytes);
    const before = f.counters.io;
    await assert.rejects(f.clients[0].read(foreign, BUDGET), /denied/);
    await assert.rejects(f.clients[0].create(foreign, bytes), /denied/);
    assert.equal(f.counters.io, before, 'foreign denial must make zero backend calls');
    assert.deepEqual(await f.clients[0].create(ref, bytes), ref);
  }
  const pageBytes = Buffer.from('{}'), page = { ...objectRef(pageBytes, 'manifest'), locator: 'manifest/page' };
  await f.clients[0].create(page, pageBytes);
  await assert.rejects(f.clients[1].create({ ...page, ...objectRef(other, 'manifest'), locator: page.locator }, other));
  assert.deepEqual(f.inspect(page), Uint8Array.from(pageBytes));
};

export const assertCT02 = async (makeFixture: ObjectFixtureFactory): Promise<void> => {
  const f = makeFixture();
  assert.ok(f?.encode && f.counters, 'missing CT-02 fixture/instrumentation');
  const bodies = COMMON_RULE_VECTORS.map((v) => JSON.parse(v.canonicalBytes) as CommonManifestBody);
  assert.notEqual(f.encode(bodies[1]).sha256, f.encode(bodies[2]).sha256, 'CT-02: ordered-unit permutation changes digest');
  for (const [i, body] of bodies.entries()) {
    const encoded = f.encode(body);
    assert.equal(Buffer.from(encoded.bytes).toString('utf8'), COMMON_RULE_VECTORS[i].canonicalBytes);
    assert.equal(encoded.sha256, COMMON_RULE_VECTORS[i].sha256);
  }
  const body = bodies[1], encoded = f.encode(body);
  const substitutions: Partial<CommonManifestBody>[] = [
    { module: 'engram-live' }, { scope: { ...body.scope, tenantId: 'tenant-b' } },
    { surface: 'live-graph', sourceBoundary: { kind: 'projection-generation', ref: 'generation-1' } },
    { incarnation: 'store-2' }, { publicationId: 'pub-other' }, { predecessorRoot: null },
    { sourceBoundary: { ...body.sourceBoundary, ref: 'other' } }, { schemaVersion: 'other' },
    { descriptorVersion: 'other' }, { encodingVersion: 'other' },
    { units: [{ ...body.units[0], unitId: 'other' }, body.units[1]] },
    { objects: [{ ...body.objects[0], id: 'other' }, body.objects[1]] },
  ];
  for (const change of substitutions) assert.notEqual(f.encode({ ...body, ...change }).sha256, encoded.sha256);
  assert.equal(f.encode({ ...body, objects: [...body.objects].reverse() }).sha256, encoded.sha256);
  const units = body.units.map((u) => ({ ...u, roots: [...u.roots].reverse() }));
  assert.notEqual(f.encode({ ...body, units }).sha256, encoded.sha256);
  assert.equal(f.encode({ ...body, sha256: 'not part of the body' } as CommonManifestBody).sha256, encoded.sha256);
  for (const field of Object.keys(body)) {
    await assert.rejects(f.verify({ ...body, [field]: null }, encoded.sha256, BUDGET), undefined, `unbound ${field}`);
  }
  for (const object of [{ ...body.objects[0], byteLength: 1 }, { ...body.objects[0], sha256: '0'.repeat(64) },
    { ...body.objects[0], locator: 'manifest/substituted' }]) {
    await assert.rejects(f.verify({ ...body, objects: [object, body.objects[1]] }, encoded.sha256, BUDGET));
  }
  for (const field of ['commonContract', 'manifestVersion']) {
    const before = f.counters.encodes;
    const unknown = { ...body, [field]: 'unknown', get units(): never { throw new Error('interpreted unknown ordering'); } };
    assert.throws(() => f.encode(unknown), /unsupported version/);
    assert.equal(f.counters.encodes, before);
  }
  for (const terminal of [undefined, { count: '1', complete: true }, { count: '2', complete: false }]) {
    assert.throws(() => f.encode({ ...body, terminal } as CommonManifestBody), /incomplete manifest/);
  }
  await assert.rejects(f.verify(body, '', BUDGET), /manifest commitment/);
};

export const assertCT03 = async (makeFixture: ObjectFixtureFactory): Promise<void> => {
  const bytes = Buffer.from('é🙂 exact encoded bytes'), ref = objectRef(bytes), body = manifest([ref]);
  const corrupt = makeFixture();
  assert.ok(corrupt?.clients && corrupt.counters, 'missing CT-03 fixture/instrumentation');
  await corrupt.clients[0].create(ref, bytes);
  corrupt.fault(ref, 'corrupt');
  await assert.rejects(corrupt.verify(body, corrupt.encode(body).sha256, BUDGET),
    undefined, 'CT-03: corrupt payload cannot be verified');
  for (const fault of ['delete', 'truncate', 'scope', 'version'] as const) {
    const f = makeFixture();
    await f.clients[0].create(ref, bytes);
    f.fault(ref, fault);
    await assert.rejects(f.clients[0].read(ref, BUDGET));
    await assert.rejects(f.verify(body, f.encode(body).sha256, BUDGET));
    await f.clients[0].create(objectRef(bytes, 'unrelated'), bytes);
    await assert.rejects(f.verify(body, f.encode(body).sha256, BUDGET));
  }
  const f = makeFixture();
  await f.clients[0].create(ref, bytes);
  const encoded = f.encode(body);
  await f.verify(body, encoded.sha256, BUDGET);
  assert.equal(f.counters.verifiedBytes, bytes.byteLength, 'missing verification instrumentation');
  await assert.rejects(f.clients[0].read(ref, { ...BUDGET, maxBytes: bytes.byteLength - 1 }), /limit/);
  await assert.rejects(f.verify(body, encoded.sha256, { ...BUDGET, maxBytes: encoded.bytes.byteLength }), /limit/);
  await assert.rejects(f.verify(body, encoded.sha256, { ...BUDGET, maxObjects: Infinity }), /limit/);
  for (const fault of ['delete', 'truncate', 'corrupt', 'scope', 'version'] as const) {
    const pages = makeFixture();
    await pages.clients[0].create(ref, bytes);
    const page = pages.encode(body), pageRef = { ...objectRef(page.bytes, 'page'), locator: 'manifest/page' };
    await pages.clients[0].create(pageRef, page.bytes);
    const root = manifest([pageRef]), digest = pages.encode(root).sha256;
    await pages.verify(root, digest, BUDGET);
    await assert.rejects(pages.verify(root, digest, { ...BUDGET, maxObjects: 1 }), /limit/);
    pages.fault(pageRef, fault);
    await assert.rejects(pages.verify(root, digest, BUDGET));
  }
  // No subtree cache: prior validation never substitutes for identity-bound evidence.
  f.fault(ref, 'corrupt');
  await assert.rejects(f.verify(body, encoded.sha256, BUDGET));
};
