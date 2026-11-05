// Installed-tuple fixtures (make test-ci-installed-tuple).
// An omitted consumer integration or deployment is only valid on identical
// installed tuples and Docker input digests. Workspaces, file: links, and
// numeric ranges are not proof: only locked exact versions with integrity,
// candidate tarballs for linked libraries, and hashed Docker inputs count.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  compareTuples,
  resolveInstalledTuple,
} from './installed-tuple.mjs';

const sha = (text) => createHash('sha256').update(text).digest('hex');
const integrity = (text) => `sha512-${Buffer.from(sha(text)).toString('base64')}`;

const lockPackages = {
  'node_modules/hono': { version: '4.13.14', resolved: 'https://registry.npmjs.org/hono/-/hono-4.13.14.tgz', integrity: integrity('hono') },
  'node_modules/zod': { version: '3.25.76', resolved: 'https://registry.npmjs.org/zod/-/zod-3.25.76.tgz', integrity: integrity('zod') },
  'node_modules/@sentropic/comments': { version: '0.3.1', resolved: 'https://registry.npmjs.org/@sentropic/comments/-/comments-0.3.1.tgz', integrity: integrity('comments') },
};

const manifest = { name: 'api', version: '0.0.0',
  dependencies: { hono: '^4.10.7', zod: '^3.25.76', '@sentropic/comments': 'file:../packages/comments' } };
const candidates = [{ name: '@sentropic/comments', version: '0.3.1', sha256: sha('comments-tgz') }];
const dockerfiles = { 'api/Dockerfile': 'FROM node:24-bookworm-slim\n' };

const tuple = () => resolveInstalledTuple({ manifest, lockPackages, candidates, dockerfiles });

test('should resolve an immutable closure with locked integrity and candidate bytes', () => {
  const resolved = tuple();
  assert.equal(resolved.closure.hono.version, '4.13.14');
  assert.equal(resolved.closure.hono.integrity, integrity('hono'));
  assert.equal(resolved.closure['@sentropic/comments'].candidate, sha('comments-tgz'));
  assert.equal(resolved.closure['@sentropic/comments'].qualified, true);
  assert.equal(resolved.docker['api/Dockerfile'], sha(dockerfiles['api/Dockerfile']));
  assert.match(resolved.digest, /^[a-f0-9]{64}$/);
});

test('should resolve linked sources as comparable but unqualified without candidate bytes', () => {
  const unqualified = resolveInstalledTuple({ manifest, lockPackages, candidates: [], dockerfiles,
    workspaceVersions: { '@sentropic/comments': '0.3.1' } });
  assert.equal(unqualified.closure['@sentropic/comments'].version, '0.3.1');
  assert.equal(unqualified.closure['@sentropic/comments'].qualified, false);
  const qualified = tuple();
  const verdict = compareTuples(unqualified, qualified);
  assert.equal(verdict.equal, false);
  assert.ok(verdict.differences.some((row) => row.includes('unqualified workspace source')));
});

test('should resolve the same digest for identical inputs regardless of key order', () => {
  const reordered = resolveInstalledTuple({
    manifest: { ...manifest, dependencies: { zod: '^3.25.76', hono: '^4.10.7', '@sentropic/comments': 'file:../packages/comments' } },
    lockPackages: Object.fromEntries(Object.entries(lockPackages).reverse()),
    candidates, dockerfiles,
  });
  assert.equal(reordered.digest, tuple().digest);
  assert.deepEqual(compareTuples(tuple(), reordered), { equal: true, differences: [] });
});

test('should report every changed dependency and Docker input', () => {
  const before = tuple();
  const bumped = resolveInstalledTuple({ manifest, candidates, dockerfiles,
    lockPackages: { ...lockPackages, 'node_modules/hono': { ...lockPackages['node_modules/hono'], version: '4.14.0', integrity: integrity('hono-4.14') } } });
  const verdict = compareTuples(before, bumped);
  assert.equal(verdict.equal, false);
  assert.ok(verdict.differences.some((row) => row.includes('hono')), JSON.stringify(verdict.differences));
  const rebuilt = resolveInstalledTuple({ manifest, lockPackages, candidates,
    dockerfiles: { 'api/Dockerfile': 'FROM node:24-bookworm-slim\nRUN extra\n' } });
  const dockerDiff = compareTuples(before, rebuilt);
  assert.equal(dockerDiff.equal, false);
  assert.ok(dockerDiff.differences.some((row) => row.includes('api/Dockerfile')));
});

test('should reject a file: dependency without a matching qualified candidate', () => {
  assert.throws(() => resolveInstalledTuple({ manifest, lockPackages, candidates: [], dockerfiles }),
    /@sentropic\/comments.*not proof/);
  assert.throws(() => resolveInstalledTuple({ manifest, lockPackages,
    candidates: [{ name: '@sentropic/comments', version: '0.4.0', sha256: sha('other') }], dockerfiles }),
    /candidate version mismatch/);
});

test('should reject a locked version outside the declared range', () => {
  const drifted = { ...lockPackages, 'node_modules/hono': { ...lockPackages['node_modules/hono'], version: '3.0.0' } };
  assert.throws(() => resolveInstalledTuple({ manifest, lockPackages: drifted, candidates, dockerfiles }),
    /outside the declared range/);
});

test('should reject a missing lock entry or a missing integrity', () => {
  const missing = { ...lockPackages };
  delete missing['node_modules/zod'];
  assert.throws(() => resolveInstalledTuple({ manifest, lockPackages: missing, candidates, dockerfiles }),
    /missing lock entry: zod/);
  const noIntegrity = { ...lockPackages, 'node_modules/zod': { version: '3.25.76' } };
  assert.throws(() => resolveInstalledTuple({ manifest, lockPackages: noIntegrity, candidates, dockerfiles }),
    /missing integrity: zod/);
});

test('should reject a numeric range recorded without a locked exact version', () => {
  const ranged = { ...lockPackages, 'node_modules/zod': { version: '*', integrity: integrity('zod') } };
  assert.throws(() => resolveInstalledTuple({ manifest, lockPackages: ranged, candidates, dockerfiles }),
    /not an exact locked version/);
});

test('should compare tuples structurally and never call equal on digest alone', () => {
  const before = tuple();
  const tampered = { ...before, digest: before.digest };
  tampered.closure = { ...before.closure, extra: { version: '1.0.0', integrity: integrity('x') } };
  const verdict = compareTuples(before, tampered);
  assert.equal(verdict.equal, false);
  assert.ok(verdict.differences.some((row) => row.includes('extra')));
});
