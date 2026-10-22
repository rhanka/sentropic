import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BUDGET, type CommonManifestBody, type ObjectFixtureFactory, type ObjectRef } from './kit.js';
import { sha256 } from './objects-reference.js';
import { COMMON_RULE_VECTORS } from './vectors.js';

export const objectRef = (bytes: Uint8Array, id = 'object'): ObjectRef => ({
  id, locator: `common/${id}`, scope: 'workspace-a', version: '1', byteLength: bytes.byteLength, sha256: sha256(bytes),
});
const manifest = (refs: readonly ObjectRef[]): CommonManifestBody => ({
  ...JSON.parse(COMMON_RULE_VECTORS[0].canonicalBytes), objects: refs, terminal: { count: String(refs.length), complete: true },
});
const fixture = (factory: ObjectFixtureFactory, ct: string) => {
  const f = factory();
  assert.ok(f?.clients?.length === 2 && f.encode && f.counters, `missing ${ct} fixture environment`);
  for (const name of ['io', 'encodes', 'verifiedBytes'] as const) {
    assert.ok(Number.isSafeInteger(f.counters[name]), `missing ${ct} instrumentation: ${name}`);
  }
  return f;
};
export const assertCT01 = async (makeFixture: ObjectFixtureFactory): Promise<void> => {
  const f = fixture(makeFixture, 'CT-01');
  const bytes = Buffer.from('é immutable bytes'), ref = objectRef(bytes);
  const receipts = await Promise.all(f.clients.map((c) => c.preparer.create(ref, bytes)));
  assert.deepEqual(receipts, [ref, ref]);
  const other = Buffer.from('different verified bytes'), unequal = objectRef(other);
  const retry = await Promise.allSettled([f.clients[1].preparer.create(unequal, other)]);
  assert.deepEqual(f.inspect(ref), Uint8Array.from(bytes), 'CT-01: first accepted bytes remain unchanged');
  assert.equal(retry[0].status, 'rejected');
  assert.deepEqual(await f.clients[0].preparer.create(ref, bytes), receipts[0]);
  assert.deepEqual(await f.reopen().clients[0].reader.read(ref, BUDGET), Uint8Array.from(bytes));
  await assert.rejects(f.reopen().clients[0].preparer.create(unequal, other), /conflict/);
  for (const locator of ['common/race', 'manifest/race']) {
    const race = makeFixture(), contenders = [bytes, other];
    const refs = contenders.map((b) => ({ ...objectRef(b), locator }));
    const outcomes = await Promise.allSettled(contenders.map((b, i) => race.clients[i].preparer.create(refs[i], b)));
    assert.equal(outcomes.filter((o) => o.status === 'fulfilled').length, 1);
    assert.equal(outcomes.filter((o) => o.status === 'rejected').length, 1);
    const winner = outcomes.findIndex((o) => o.status === 'fulfilled');
    assert.deepEqual(await race.clients[0].reader.read(refs[winner], BUDGET), Uint8Array.from(contenders[winner]));
  }
  const owned = Buffer.from(bytes), original = Uint8Array.from(owned), ownedRef = objectRef(owned, 'owned');
  const pending = f.clients[0].preparer.create(ownedRef, owned);
  owned.fill(0);
  await pending;
  assert.deepEqual(await f.clients[0].reader.read(ownedRef, BUDGET), original);
  const returned = await f.clients[0].reader.read(ownedRef, BUDGET);
  returned.fill(0);
  assert.deepEqual(await f.clients[0].reader.read(ownedRef, BUDGET), original);
  const committed = objectRef(bytes, `sha256:${sha256(bytes)}`);
  const invalidRetries = [
    { name: 'digest', ref: { ...committed, sha256: '0'.repeat(64) }, bytes },
    { name: 'length', ref: { ...committed, byteLength: 1 }, bytes },
    { name: 'digest/key', ref: { ...committed, sha256: sha256(other), byteLength: other.byteLength }, bytes: other },
  ];
  for (const bad of invalidRetries) for (const reopened of [false, true]) {
    const isolated = makeFixture();
    const receipt = await isolated.clients[0].preparer.create(committed, bytes);
    const retry = reopened ? isolated.reopen() : isolated;
    await assert.rejects(retry.clients[0].preparer.create(bad.ref, bad.bytes), /corrupt/);
    const message = `CT-01: invalid ${bad.name} retry preserves accepted bytes`;
    assert.deepEqual(isolated.inspect(committed), Uint8Array.from(bytes), message);
    for (const current of [retry, isolated.reopen()]) {
      await assert.doesNotReject(async () => {
        assert.deepEqual(await current.clients[0].reader.read(committed, BUDGET), Uint8Array.from(bytes));
      }, `${message} and commitment after reopen=${reopened}`);
      assert.deepEqual(await current.clients[0].preparer.create(committed, bytes), receipt);
    }
  }
  for (const exists of [false, true]) {
    const isolated = makeFixture();
    const foreign = { ...ref, scope: 'workspace-b', locator: 'foreign/private' };
    if (exists) await isolated.client('workspace-b').preparer.create(foreign, bytes);
    const before = isolated.counters.io;
    await assert.rejects(isolated.clients[0].reader.read(foreign, BUDGET), /denied/);
    await assert.rejects(isolated.clients[0].preparer.create(foreign, bytes), /denied/);
    assert.equal(isolated.counters.io, before, 'foreign denial must make zero backend calls');
    await assert.rejects(isolated.clients[0].reader.read(ref, BUDGET), /unavailable/);
    assert.deepEqual(await isolated.clients[0].preparer.create(ref, bytes), ref);
    assert.deepEqual(await isolated.clients[0].reader.read(ref, BUDGET), Uint8Array.from(bytes));
  }
  const pageBytes = Buffer.from('{}'), page = { ...objectRef(pageBytes, 'manifest'), locator: 'manifest/page' };
  await f.clients[0].preparer.create(page, pageBytes);
  await assert.rejects(f.clients[1].preparer.create({ ...page, ...objectRef(other, 'manifest'), locator: page.locator }, other));
  assert.deepEqual(f.inspect(page), Uint8Array.from(pageBytes));
};

export const assertCT02 = async (makeFixture: ObjectFixtureFactory): Promise<void> => {
  const f = fixture(makeFixture, 'CT-02');
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
  const payload = Buffer.from('populated CT-02 payload'), payloadRef = objectRef(payload, 'ct02-payload');
  await f.clients[0].preparer.create(payloadRef, payload);
  const pages: ObjectRef[] = [];
  for (const id of ['page-a', 'page-b']) {
    const page = f.encode({ ...manifest([payloadRef]), publicationId: id });
    const ref = { ...objectRef(page.bytes, id), locator: `manifest/${id}` };
    await f.clients[0].preparer.create(ref, page.bytes);
    pages.push(ref);
  }
  const populated = { ...body, objects: [payloadRef, pages[0]] }, commitment = f.encode(populated).sha256;
  await f.verify(populated, commitment, BUDGET);
  assert.notEqual(commitment, '0'.repeat(64));
  await assert.rejects(f.verify(populated, '0'.repeat(64), BUDGET), /manifest commitment/,
    'CT-02: supplied manifest digest must match');
  for (const change of [...substitutions.filter((s) => !('objects' in s)), { units: [...populated.units].reverse() }]) {
    await assert.rejects(f.verify({ ...populated, ...change }, commitment, BUDGET), /manifest commitment/);
  }
  const replacedPage = { ...populated, objects: [payloadRef, pages[1]] };
  const extended = { ...populated, objects: [payloadRef, ...pages], terminal: { count: '3', complete: true } };
  for (const changed of [replacedPage, extended]) {
    await f.verify(changed, f.encode(changed).sha256, BUDGET);
    await assert.rejects(f.verify(changed, commitment, BUDGET), /manifest commitment/);
  }
  await f.verify({ ...populated, objects: [...populated.objects].reverse() }, commitment, BUDGET);
  for (const field of Object.keys(body)) {
    await assert.rejects(f.verify({ ...populated, [field]: null }, commitment, BUDGET), undefined, `unbound ${field}`);
  }
  for (const object of [{ ...pages[0], id: 'other' }, { ...pages[0], byteLength: 1 },
    { ...pages[0], sha256: '0'.repeat(64) }, { ...pages[0], locator: 'manifest/substituted' }]) {
    await assert.rejects(f.verify({ ...populated, objects: [payloadRef, object] }, commitment, BUDGET), /manifest commitment/);
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
  await assert.rejects(f.verify(populated, '', BUDGET), /manifest commitment/);
  const legacy = readFileSync(new URL('../../../assets/storage/comments/transport-v1.json', import.meta.url));
  const ref = objectRef(legacy, 'legacy-l3a'), wrapped = manifest([ref]);
  assert.equal(ref.sha256, 'c65c06f69c7806dd86326b64fd5712e17ab9c91de59074dd9a466de58d2573f7');
  await f.clients[0].preparer.create(ref, legacy);
  await f.verify(wrapped, f.encode(wrapped).sha256, BUDGET);
  assert.deepEqual(await f.clients[0].reader.read(ref, BUDGET), Uint8Array.from(legacy));
};

export const assertCT03 = async (makeFixture: ObjectFixtureFactory): Promise<void> => {
  const bytes = Buffer.from('é🙂 exact encoded bytes'), ref = objectRef(bytes), body = manifest([ref]);
  const corrupt = fixture(makeFixture, 'CT-03');
  await corrupt.clients[0].preparer.create(ref, bytes);
  corrupt.fault(ref, 'corrupt');
  await assert.rejects(corrupt.verify(body, corrupt.encode(body).sha256, BUDGET),
    undefined, 'CT-03: corrupt payload cannot be verified');
  for (const fault of ['delete', 'truncate', 'scope', 'version'] as const) {
    const f = makeFixture();
    await f.clients[0].preparer.create(ref, bytes);
    f.fault(ref, fault);
    await assert.rejects(f.clients[0].reader.read(ref, BUDGET));
    await assert.rejects(f.verify(body, f.encode(body).sha256, BUDGET));
    await f.clients[0].preparer.create(objectRef(bytes, 'unrelated'), bytes);
    await assert.rejects(f.verify(body, f.encode(body).sha256, BUDGET));
  }
  const f = makeFixture();
  await f.clients[0].preparer.create(ref, bytes);
  const mutableRefs = [ref, { ...ref, id: 'missing' }], mutableBody = manifest(mutableRefs);
  const pending = f.verify(mutableBody, f.encode(mutableBody).sha256, BUDGET);
  mutableRefs.pop();
  await assert.rejects(pending, /unavailable/, 'verification must own the committed inventory across waits');
  const encoded = f.encode(body);
  const before = f.counters.verifiedBytes;
  await f.verify(body, encoded.sha256, BUDGET);
  assert.equal(f.counters.verifiedBytes - before, bytes.byteLength, 'missing verification instrumentation');
  await assert.rejects(f.clients[0].reader.read(ref, { ...BUDGET, maxBytes: bytes.byteLength - 1 }), /limit/);
  await assert.rejects(f.verify(body, encoded.sha256, { ...BUDGET, maxBytes: encoded.bytes.byteLength }), /limit/);
  await assert.rejects(f.verify(body, encoded.sha256, { ...BUDGET, maxObjects: Infinity }), /limit/);
  for (const fault of ['delete', 'truncate', 'corrupt', 'scope', 'version'] as const) {
    const pages = makeFixture();
    await pages.clients[0].preparer.create(ref, bytes);
    const page = pages.encode(body), pageRef = { ...objectRef(page.bytes, 'page'), locator: 'manifest/page' };
    await pages.clients[0].preparer.create(pageRef, page.bytes);
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
