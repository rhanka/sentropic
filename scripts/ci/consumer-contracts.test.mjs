// Consumer-contract selection fixtures (make test-ci-consumer-contracts).
// A change kind maps to the consumer validations that must run before any
// integration or deployment lane is omitted. Unknown or missing evidence
// selects full blocking integration; the tuple gate alone never omits work.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { classifyCompatibility } from './compatibility-classifier.mjs';
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

test('should retain full runtime integration for shell and SQL mounted by Kubernetes', () => {
  for (const name of ['export-prod.sh', 'export-prod.sql', 'reader-role.sql']) {
    const { kind } = classifyCompatibility({ files: [`deploy/k8s/overlays/prod/idp-identity-sync/${name}`] });
    const verdict = selectConsumers({ kind, slugs: [], boundaries });
    assert.equal(verdict.selection, 'full', name);
    assert.equal(verdict.fastPath, false, name);
    assert.ok(jobs(verdict).includes('test-e2e'), name);
    assert.ok(jobs(verdict).includes('test-api-unit-integration'), name);
  }
});

test('should require manifest validation and identical installed tuples for deployment-only changes', () => {
  const workflow = { jobs: { changes: {}, 'ci-gate': { needs: ['validate-idp-sync'] },
    'validate-idp-sync': { if: "needs.changes.outputs.idp_sync == 'true'" } } };
  const tuples = { before: { api: { digest: 'api' }, ui: { digest: 'ui' } },
    after: { api: { digest: 'api' }, ui: { digest: 'ui' } } };
  const input = { kind: 'deployment-only', boundaries, workflow, tuples, changes: { idp_sync: 'true' } };
  const good = verifyDispatch(input);
  assert.equal(good.ok, true, JSON.stringify(good.problems));
  assert.deepEqual(jobs(good), ['validate-idp-sync']);
  assert.equal(verifyDispatch({ ...input, changes: { idp_sync: 'false' } }).ok, false);
  assert.equal(verifyDispatch({ ...input, workflow: { jobs: {} } }).ok, false);
  for (const evidence of [null, {}, { before: {}, after: {} },
    { ...tuples, after: { ...tuples.after, api: { digest: 'changed' } } }]) {
    assert.equal(verifyDispatch({ ...input, tuples: evidence }).ok, false, JSON.stringify(evidence));
  }
});

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
  const verdict = selectConsumers({ kind: 'ui-only', slugs: [], boundaries, ref: 'refs/heads/main' });
  assert.equal(verdict.selection, 'ui');
  assert.equal(verdict.fastPath, false);
  for (const job of ['test-ui', 'build-ui', 'smoke-idp-screens', 'deploy-preprod']) {
    assert.ok(jobs(verdict).includes(job), `ui selection must include ${job}`);
  }
  assert.match(verdict.reasons.join('\n'), /API digest/);
});

test('should qualify auth-ui and exercise UI, IdP, both images, and preproduction for shared assets', () => {
  const verdict = selectConsumers({ kind: 'shared-asset', slugs: ['auth-ui'], boundaries, ref: 'refs/heads/main' });
  assert.equal(verdict.selection, 'shared');
  assert.equal(verdict.fastPath, false);
  for (const job of ['validate-auth-ui', 'test-ui', 'smoke-idp-screens', 'build-api-image', 'build-ui', 'deploy-preprod']) {
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

test('should prove dispatch on a synthetic workflow when every required consumer is selected', () => {
  const workflow = { jobs: {
    changes: {},
    'ci-gate': { needs: ['validate-comments', 'validate-cluster-mesh', 'test-e2e'] },
    'validate-comments': { if: "needs.changes.outputs.comments == 'true'" },
    'validate-cluster-mesh': { if: "needs.changes.outputs.cluster_mesh == 'true'" },
    'test-e2e': { if: "needs.changes.outputs.api == 'true'" },
  } };
  const text = 'run suite: contracts for api/tests/contracts/comments-candidate.test.ts and validate-cluster-mesh';
  const good = verifyDispatch({ kind: 'additive', slugs: ['comments'], boundaries,
    workflow, workflowText: text, changes: { comments: 'true', cluster_mesh: 'true', api: 'false' } });
  assert.equal(good.ok, true, JSON.stringify(good.problems));
  const unselected = verifyDispatch({ kind: 'additive', slugs: ['comments'], boundaries,
    workflow, workflowText: text, changes: { comments: 'true', cluster_mesh: 'false', api: 'false' } });
  assert.equal(unselected.ok, false);
  assert.ok(unselected.problems.some((row) => row.includes('validate-cluster-mesh') && row.includes('not selected')));
  const unwired = verifyDispatch({ kind: 'additive', slugs: ['comments'], boundaries,
    workflow, workflowText: 'nothing relevant here', changes: { comments: 'true', cluster_mesh: 'true', api: 'true' } });
  assert.equal(unwired.ok, false);
  assert.ok(unwired.problems.some((row) => row.includes('not wired')));
});

test('should match matrix members by bare job identity', () => {
  const workflow = { jobs: {
    changes: {},
    'ci-gate': { needs: ['validate-comments', 'validate-cluster-mesh'] },
    'validate-comments': { if: "needs.changes.outputs.comments == 'true'",
      strategy: { matrix: { include: [{ lane: 'unit' }, { lane: 'postgres' }] } } },
    'validate-cluster-mesh': { if: "needs.changes.outputs.cluster_mesh == 'true'" },
  } };
  const text = 'run suite: contracts for api/tests/contracts/comments-candidate.test.ts';
  const good = verifyDispatch({ kind: 'additive', slugs: ['comments'], boundaries,
    workflow, workflowText: text, changes: { comments: 'true', cluster_mesh: 'true' } });
  assert.equal(good.ok, true, JSON.stringify(good.problems));
  const unselected = verifyDispatch({ kind: 'additive', slugs: ['comments'], boundaries,
    workflow, workflowText: text, changes: { comments: 'true', cluster_mesh: 'false' } });
  assert.equal(unselected.ok, false);
  assert.ok(unselected.problems.some((row) => row.includes('validate-cluster-mesh')));
});

test('should fail tuple proof only for selections that omit consumer work', () => {
  const workflow = { jobs: {
    changes: {},
    'ci-gate': { needs: ['validate-comments', 'validate-cluster-mesh'] },
    'validate-comments': { if: "needs.changes.outputs.comments == 'true'" },
    'validate-cluster-mesh': { if: "needs.changes.outputs.cluster_mesh == 'true'" },
  } };
  const text = 'run suite: contracts for api/tests/contracts/comments-candidate.test.ts';
  const tuples = { before: { api: { digest: 'a' } }, after: { api: { digest: 'b' } } };
  const gated = verifyDispatch({ kind: 'additive', slugs: ['comments'], boundaries,
    workflow, workflowText: text, changes: { comments: 'true', cluster_mesh: 'true' }, tuples });
  assert.equal(gated.ok, false);
  assert.ok(gated.problems.some((row) => row.includes('installed tuple changed for api')));
  const same = verifyDispatch({ kind: 'additive', slugs: ['comments'], boundaries,
    workflow, workflowText: text, changes: { comments: 'true', cluster_mesh: 'true' },
    tuples: { before: { api: { digest: 'a' } }, after: { api: { digest: 'a' } } } });
  assert.equal(same.ok, true, JSON.stringify(same.problems));
  const full = verifyDispatch({ kind: 'breaking', slugs: ['comments'], boundaries,
    workflow, workflowText: text, changes: {}, tuples });
  assert.ok(!full.problems.some((row) => row.includes('installed tuple')),
    'full integration omits nothing so tuple drift stays informational');
});

test('should fail closed when an affected package owns no validation or contract', () => {
  const workflow = { jobs: {
    changes: {},
    'ci-gate': { needs: ['validate-comments'] },
    'validate-comments': { if: "needs.changes.outputs.comments == 'true'" },
  } };
  const verdict = verifyDispatch({ kind: 'breaking', slugs: ['connector-host'], boundaries,
    workflow, workflowText: '', changes: { connector_host: 'true' } });
  assert.equal(verdict.ok, false);
  assert.ok(verdict.problems.some((row) => row.includes('no owning validation for connector-host')));
  const covered = verifyDispatch({ kind: 'breaking', slugs: ['comments'], boundaries,
    workflow, workflowText: '', changes: { comments: 'true' } });
  assert.ok(!covered.problems.some((row) => row.includes('no owning validation')),
    JSON.stringify(covered.problems));
});

test('should carry the workflow-visible lane on every boundary contract', () => {
  const verdict = selectConsumers({ kind: 'additive', slugs: ['comments', 'cluster-mesh'], boundaries });
  for (const item of verdict.required.filter((row) => row.kind === 'test')) {
    assert.ok(item.via, `${item.identity} must declare its workflow-visible lane`);
    assert.equal(item.via, boundaries.contractLanes[item.identity]);
  }
});

test('should approve omission on identical qualified tuples', () => {
  const workflow = { jobs: {
    changes: {},
    'ci-gate': { needs: ['validate-comments', 'validate-cluster-mesh'] },
    'validate-comments': { if: "needs.changes.outputs.comments == 'true'" },
    'validate-cluster-mesh': { if: "needs.changes.outputs.cluster_mesh == 'true'" },
  } };
  const text = 'run suite: contracts for api/tests/contracts/comments-candidate.test.ts';
  const sha = 'a'.repeat(64);
  const closure = { hono: { version: '4.13.14', integrity: 'sha512-x' },
    '@sentropic/comments': { version: '0.3.2', candidate: sha, qualified: true } };
  const identical = { before: { api: { closure, docker: {} } }, after: { api: { closure, docker: {} } } };
  const verdict = verifyDispatch({ kind: 'additive', slugs: ['comments'], boundaries,
    workflow, workflowText: text, changes: { comments: 'true', cluster_mesh: 'true' }, tuples: identical });
  assert.equal(verdict.ok, true, JSON.stringify(verdict.problems));
});

test('should refuse omission on identical but unqualified tuples', () => {
  const workflow = { jobs: {
    changes: {},
    'ci-gate': { needs: ['validate-comments', 'validate-cluster-mesh'] },
    'validate-comments': { if: "needs.changes.outputs.comments == 'true'" },
    'validate-cluster-mesh': { if: "needs.changes.outputs.cluster_mesh == 'true'" },
  } };
  const text = 'run suite: contracts for api/tests/contracts/comments-candidate.test.ts';
  const closure = { hono: { version: '4.13.14' },
    '@sentropic/comments': { version: '0.3.1', qualified: false } };
  const identical = { before: { api: { closure, docker: {} } }, after: { api: { closure, docker: {} } } };
  const verdict = verifyDispatch({ kind: 'additive', slugs: ['comments'], boundaries,
    workflow, workflowText: text, changes: { comments: 'true', cluster_mesh: 'true' }, tuples: identical });
  assert.equal(verdict.ok, false);
  assert.ok(verdict.problems.some((row) => row.includes('without candidate bytes')));
});

test('should reject omission claims outside tuple-gated boundaries and missing workflows', () => {
  const claim = verifyDispatch({ kind: 'ui-only', slugs: [], boundaries, expectOmission: true });
  assert.equal(claim.ok, false);
  assert.ok(claim.problems.some((row) => row.includes('only tuple-gated boundaries may omit')));
  const missing = verifyDispatch({ kind: 'additive', slugs: ['comments'], boundaries });
  assert.equal(missing.ok, false);
  assert.ok(missing.problems.some((row) => row.includes('workflow is missing')));
});

test('should keep owning validations for chat-core, the gateway host, and ubo-contracts', () => {
  assert.equal(boundaries.owningValidations['chat-core'].make, 'test-pkg-chat-core');
  assert.equal(boundaries.owningValidations['llm-gateway-host'].make, 'test-llm-gateway-process');
  assert.equal(boundaries.owningValidations['ubo-contracts'].test,
    'api/tests/object-registry/object-type-registry.test.ts');
  for (const file of ['api/tests/object-registry/object-type-registry.test.ts']) {
    assert.ok(fs.existsSync(path.join(root, file)), `${file} must exist: delegation is not passing evidence`);
  }
});

test('should reject omitted or missing full-integration consumers even without changed package slugs', () => {
  const names = ['test-api-unit-integration', 'test-ui', 'test-e2e', 'e2e-vscode', 'smoke-idp-screens'];
  const workflow = { jobs: { changes: {}, 'ci-gate': { needs: names },
    ...Object.fromEntries(names.map(name => [name, { if: "needs.changes.outputs.global == 'true'" }])) } };
  for (const kind of ['unknown', 'breaking', 'runtime-security', 'root-lock-toolchain']) {
    const good = verifyDispatch({ kind, boundaries, workflow, changes: { global: 'true' } });
    assert.equal(good.ok, true, JSON.stringify(good.problems));
    const omitted = verifyDispatch({ kind, boundaries, workflow, changes: { global: 'false' } });
    assert.equal(omitted.ok, false, `${kind} must not erase unselected consumers`);
    assert.ok(omitted.problems.some(problem => problem.includes('test-ui') && problem.includes('not selected')));
    const missing = structuredClone(workflow);
    delete missing.jobs['test-ui'];
    assert.equal(verifyDispatch({ kind, boundaries, workflow: missing, changes: { global: 'true' } }).ok, false);
  }
});

test('should reject an unselected owning validation on the full path', () => {
  const names = ['test-api-unit-integration', 'test-ui', 'test-e2e', 'e2e-vscode', 'smoke-idp-screens'];
  const workflow = { jobs: { changes: {}, 'ci-gate': { needs: [...names, 'validate-comments'] },
    ...Object.fromEntries(names.map(name => [name, {}])),
    'validate-comments': { if: "needs.changes.outputs.comments == 'true'" } } };
  const result = verifyDispatch({ kind: 'breaking', slugs: ['comments'], boundaries,
    workflow, changes: { comments: 'false' } });
  assert.equal(result.ok, false);
  assert.ok(result.problems.some(problem => problem.includes('validate-comments') && problem.includes('not selected')));
});
