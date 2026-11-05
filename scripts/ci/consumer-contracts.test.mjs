// Consumer-contract selection fixtures (make test-ci-consumer-contracts).
// A change kind maps to the consumer validations that must run before any
// integration or deployment lane is omitted. Unknown or missing evidence
// selects full blocking integration; the tuple gate alone never omits work.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  contractTestsFor,
  loadBoundaries,
  selectConsumers,
  verifyDispatch,
} from './consumer-contracts.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const boundaries = loadBoundaries(path.join(root, 'scripts', 'ci', 'consumer-boundaries.json'));

const jobs = (verdict) => verdict.required.filter((row) => row.kind === 'job').map((row) => row.identity);
const tests = (verdict) => verdict.required.filter((row) => row.kind === 'test').map((row) => row.identity);

test('should load 43 inventoried components with owning validations', () => {
  assert.equal(boundaries.components.length, 43);
  const kinds = new Set(boundaries.components.map((row) => row.kind));
  assert.deepEqual([...kinds].sort(), ['app', 'library']);
  const missing = boundaries.components.filter((row) => row.validation === null).map((row) => row.slug);
  assert.ok(missing.includes('ubo-contracts'), 'ubo-contracts must stay listed as missing');
  assert.ok(missing.includes('connector-host'), 'connector-host must stay listed as missing');
  assert.ok(missing.length >= 10, `expected the unvalidated tail, got ${missing.length}`);
});

test('should cover comments to API and cluster-mesh to API, IdP, and gateway', () => {
  const comments = boundaries.boundaries.find((row) => row.package === 'comments');
  assert.deepEqual(comments.consumers, ['api']);
  assert.deepEqual(comments.contracts, ['api/tests/contracts/comments-candidate.test.ts']);
  const mesh = boundaries.boundaries.find((row) => row.package === 'cluster-mesh');
  assert.deepEqual(mesh.consumers, ['api', 'auth-idp', 'llm-gateway']);
  assert.deepEqual(mesh.contracts, [
    'api/tests/contracts/cluster-candidate.test.ts',
    'apps/auth-idp/tests/cluster-candidate.test.ts',
    'apps/llm-gateway/tests/cluster-candidate.test.ts',
  ]);
});

test('should resolve contract tests per boundary package', () => {
  assert.deepEqual(contractTestsFor('comments', boundaries),
    ['api/tests/contracts/comments-candidate.test.ts']);
  assert.equal(contractTestsFor('cluster-mesh', boundaries).length, 3);
  assert.deepEqual(contractTestsFor('unknown-slug', boundaries), []);
});

test('should select full blocking integration for unknown evidence', () => {
  const verdict = selectConsumers({ kind: 'unknown', slugs: ['comments'], boundaries });
  assert.equal(verdict.selection, 'full');
  assert.equal(verdict.fastPath, false);
  assert.ok(jobs(verdict).includes('test-e2e'), 'full selection must include e2e');
  assert.ok(jobs(verdict).includes('test-api-unit-integration'), 'full selection must include api integration');
  assert.ok(jobs(verdict).includes('validate-comments'), 'full selection must include the boundary validation');
});

test('should select full blocking integration for breaking, runtime, and lock changes', () => {
  for (const kind of ['breaking', 'runtime-security', 'root-lock-toolchain']) {
    const verdict = selectConsumers({ kind, slugs: ['comments'], boundaries });
    assert.equal(verdict.selection, 'full', kind);
    assert.equal(verdict.fastPath, false, kind);
  }
});

test('should select boundary contracts with a tuple gate for additive and internal fixes', () => {
  for (const kind of ['additive', 'internal-fix']) {
    const verdict = selectConsumers({ kind, slugs: ['comments'], boundaries });
    assert.equal(verdict.selection, 'boundary', kind);
    assert.equal(verdict.fastPath, 'tuple-gated', kind);
    assert.deepEqual(tests(verdict), ['api/tests/contracts/comments-candidate.test.ts'], kind);
    assert.ok(jobs(verdict).includes('validate-comments'), kind);
  }
});

test('should retain cluster peer qualification for comments boundaries', () => {
  const verdict = selectConsumers({ kind: 'additive', slugs: ['comments'], boundaries });
  assert.ok(jobs(verdict).includes('validate-cluster-mesh'), 'comments peer qualification must be retained');
});

test('should select complete deterministic consumers for adopted upgrades', () => {
  const verdict = selectConsumers({ kind: 'explicit-adoption', slugs: ['cluster-mesh'], boundaries });
  assert.equal(verdict.selection, 'adopted');
  assert.equal(verdict.fastPath, false);
  assert.equal(tests(verdict).length, 3);
  assert.ok(jobs(verdict).includes('test-api-unit-integration'), 'adopters must run api integration');
  assert.ok(verdict.required.some((row) => row.identity === 'test-llm-gateway-process'),
    'adopters must run the gateway host suite');
});

test('should keep UI changes on the UI lane with preproduction while preserving the API digest', () => {
  const verdict = selectConsumers({ kind: 'ui-only', slugs: [], boundaries });
  assert.equal(verdict.selection, 'ui');
  assert.equal(verdict.fastPath, false);
  for (const job of ['test-ui', 'build-ui', 'smoke-idp-screens', 'deploy-preprod']) {
    assert.ok(jobs(verdict).includes(job), `ui selection must include ${job}`);
  }
  assert.match(verdict.reasons.join('\n'), /API digest/);
});

test('should qualify auth-ui and exercise UI, IdP, both images, and preproduction for shared assets', () => {
  const verdict = selectConsumers({ kind: 'shared-asset', slugs: ['auth-ui'], boundaries });
  assert.equal(verdict.selection, 'shared');
  assert.equal(verdict.fastPath, false);
  for (const job of ['validate-auth-ui', 'test-ui', 'smoke-idp-screens', 'build-api-image', 'build-ui-image', 'deploy-preprod']) {
    assert.ok(jobs(verdict).includes(job), `shared selection must include ${job}`);
  }
});

test('should reject an unknown change kind and missing boundaries', () => {
  assert.throws(() => selectConsumers({ kind: 'nope', slugs: [], boundaries }), /unknown change kind/);
  assert.throws(() => selectConsumers({ kind: 'additive', slugs: [], boundaries: null }), /boundaries/);
});

test('should fail closed when a boundary package lacks a contract test', () => {
  const verdict = selectConsumers({ kind: 'additive', slugs: ['connector-host'], boundaries });
  assert.equal(verdict.selection, 'full', 'a package without a contract cannot take the fast path');
});
