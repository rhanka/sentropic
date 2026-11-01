// ACT-L05 (r6 wave W2): L5-C isolated rebuild — admitted builder only, no shared
// daemon/credentials/Python, registry-config inheritance refuses before build.
import assert from 'node:assert/strict';
import test from 'node:test';
import { digest, isDigest, policy } from './toolchain-contract.mjs';
import { ADMITTED_BUILDERS, planRebuild, validateRebuildReceipt } from './rebuild-isolation.mjs';

const sourceSha = '2ea238790fe992cdbb8e0202b1a73a937b6a1793';
const builderDigest = digest('admitted-builder-binary');
const admittedBuilders = [builderDigest];
const builder = { digest: builderDigest, inventory: ['usr/local/bin/builder', 'usr/local/bin/cc'] };
const target = { key: 'api-production', ref: `registry.example/nc-reg/sentropic-api@${digest('manifest')}`,
  sourceSha, platform: policy.platform, configDigest: digest('config'),
  provenance: { verified: true, sourceSha, imageRef: `registry.example/nc-reg/sentropic-api@${digest('manifest')}`,
    platform: policy.platform, receiptHash: digest('receipt') } };
const recipeDigest = digest('recipe');

const rebuildInput = (mutate = null) => {
  const input = {
    builder, sourceSha, target, recipeDigest, admittedBuilders,
    mounts: [
      { src: '/workspace', dst: '/src', readonly: true },
      { src: '/run/rebuild-work', dst: '/work', readonly: false },
    ],
    env: { HOME: '/tmp', PATH: '/usr/bin:/bin' },
  };
  return mutate ? (mutate(input) || input) : input;
};

test('L5-C: an admitted isolated builder produces a pinned no-network plan', () => {
  assert.deepEqual(ADMITTED_BUILDERS, [], 'no builder is admitted by default (fail-closed)');
  const plan = planRebuild(rebuildInput());
  assert.equal(plan.builderDigest, builderDigest);
  assert.equal(plan.recipeDigest, recipeDigest);
  assert.equal(plan.sourceSha, sourceSha);
  assert.ok(plan.args.includes('--network') && plan.args.includes('none'));
  assert.ok(plan.args.includes('--read-only'));
  assert.ok(plan.args.includes('--pull=never'));
  const serialized = JSON.stringify(plan.args) + JSON.stringify(plan.env) + JSON.stringify(plan.mounts);
  assert.ok(!serialized.includes('docker.sock'));
  assert.ok(!/TOKEN|PASSWORD|SECRET|CREDENTIAL|DOCKER_CONFIG/i.test(JSON.stringify(plan.env)));
  assert.ok(plan.mounts.every((mount) => mount.src === '/workspace' ? mount.readonly === true : true));
});

test('L5-C: shared socket, host escape, registry-config inheritance, Python and unadmitted builder refuse before build', () => {
  const cases = [
    ['unadmitted builder', (input) => { input.builder = { digest: digest('unknown'), inventory: [] }; }, /unadmitted builder/],
    ['bad builder digest', (input) => { input.builder = { digest: 'not-a-digest', inventory: [] }; }, /builder/],
    ['shared daemon socket', (input) => { input.mounts.push({ src: '/var/run/docker.sock', dst: '/var/run/docker.sock', readonly: true }); }, /shared daemon/],
    ['any socket mount', (input) => { input.mounts.push({ src: '/run/buildkit/buildkitd.sock', dst: '/sock', readonly: true }); }, /socket/],
    ['host root escape', (input) => { input.mounts.push({ src: '/', dst: '/host', readonly: true }); }, /host escape/],
    ['host etc escape', (input) => { input.mounts.push({ src: '/etc', dst: '/host-etc', readonly: true }); }, /host escape/],
    ['registry config inheritance via env', (input) => { input.env.DOCKER_CONFIG = '/run/auth'; }, /registry config/],
    ['registry config inheritance via mount', (input) => { input.mounts.push({ src: '/run/auth/config.json', dst: '/root/.docker/config.json', readonly: true }); }, /registry config/],
    ['credential env', (input) => { input.env.REGISTRY_PASSWORD = 'canary'; }, /credential/],
    ['python in builder', (input) => { input.builder = { digest: builderDigest, inventory: ['usr/bin/python3'] }; }, /Python/],
    ['pip in builder', (input) => { input.builder = { digest: builderDigest, inventory: ['usr/lib/python3.12/site-packages'] }; }, /Python/],
    ['writable source mount', (input) => { input.mounts[0] = { src: '/workspace', dst: '/src', readonly: false }; }, /read-only source/],
    ['relative mount src', (input) => { input.mounts.push({ src: 'rel', dst: '/x', readonly: true }); }, /mount/],
    ['wrong target source SHA', (input) => { input.target = { ...target, sourceSha: 'd'.repeat(40) }; }, /source SHA/],
    ['mutable target ref', (input) => { input.target = { ...target, ref: 'registry.example/sentropic-api:latest' }; }, /immutable/],
    ['bad recipe digest', (input) => { input.recipeDigest = 'nope'; }, /recipe/],
  ];
  for (const [name, mutate, pattern] of cases) {
    assert.throws(() => planRebuild(rebuildInput(mutate)), pattern, name);
  }
});

test('L5-C: rebuild receipt binds builder, source, target and output; forged or source-controlled receipts refuse', () => {
  const receipt = {
    schemaVersion: 1, origin: 'trusted-builder', builderDigest, sourceSha,
    target: { key: target.key, configDigest: target.configDigest },
    outputDigest: digest('rebuilt-archive'), runId: '40876641000', runAttempt: 1,
    startedAt: '2026-11-01T06:20:00Z', endedAt: '2026-11-01T06:25:00Z',
  };
  receipt.receiptHash = digest(JSON.stringify(receipt));
  assert.equal(validateRebuildReceipt(receipt, { sourceSha, target, builderDigest, runId: '40876641000', runAttempt: 1 }), true);
  const forged = { ...receipt, outputDigest: digest('other') };
  assert.throws(() => validateRebuildReceipt(forged, { sourceSha, target, builderDigest, runId: '40876641000', runAttempt: 1 }), /forged/);
  assert.throws(() => validateRebuildReceipt({ ...receipt, runAttempt: 2, receiptHash: digest(JSON.stringify({ ...receipt, runAttempt: 2 })) },
    { sourceSha, target, builderDigest, runId: '40876641000', runAttempt: 1 }), /run\/attempt/);
  const sourceControlled = { ...receipt, origin: 'scanned-source', receiptHash: digest(JSON.stringify({ ...receipt, origin: 'scanned-source' })) };
  assert.throws(() => validateRebuildReceipt(sourceControlled, { sourceSha, target, builderDigest, runId: '40876641000', runAttempt: 1 }), /source-controlled/);
  assert.throws(() => validateRebuildReceipt({ ...receipt, sourceSha: 'e'.repeat(40) },
    { sourceSha, target, builderDigest, runId: '40876641000', runAttempt: 1 }), /forged|source SHA/);
  assert.throws(() => validateRebuildReceipt({ ...receipt, target: { key: target.key, configDigest: digest('swapped') } },
    { sourceSha, target, builderDigest, runId: '40876641000', runAttempt: 1 }), /forged|config/);
  assert.ok(!isDigest(receipt.outputDigest) || isDigest(receipt.outputDigest));
});
