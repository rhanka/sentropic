// ACT-L05 (r6 wave W2): L5-A exact main image cohort identity, L5-B trusted
// acquisition boundary. Synthetic fixtures only; no live registry or credential.
import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { digest, isDigest, policy } from './toolchain-contract.mjs';
import { COHORT_KEYS, PRODUCER_JOBS, resolveCohort, validateAcquisitionBoundary, validateAnonymousImagePull } from './target-custody.mjs';
import { L05_ACCEPTANCE, validateDisposition } from './acceptance-disposition.mjs';
import { validateTarget } from './trivy.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const sourceSha = '2ea238790fe992cdbb8e0202b1a73a937b6a1793';
const registry = 'registry.example/nc-reg';
const workflowBytes = Buffer.from('protected ci workflow bytes');
const imageNames = { 'api-production': 'sentropic-api', 'api-toolbox': 'sentropic-api-tools', 'ui-production': 'sentropic-ui' };

const producer = (key, overrides = {}) => ({
  schema: 1, kind: key, ref: `${registry}/${imageNames[key]}:f751cf`, sourceSha,
  inputTree: digest(`tree-${key}`), workflowDigest: digest(workflowBytes), runId: '40876641000',
  architecture: policy.platform, imageId: digest(`config-${key}`), archiveDigest: digest(`archive-${key}`),
  producer: { job: PRODUCER_JOBS[key], attempt: '1' }, ...overrides,
});
const job = (key, overrides = {}) => ({ name: PRODUCER_JOBS[key], conclusion: 'success', head_sha: sourceSha,
  id: 123458209133, run_attempt: 1, run_id: 40876641000, ...overrides });
const inspection = (key, overrides = {}) => ({
  Descriptor: { digest: digest(`manifest-${key}`), platform: { os: 'linux', architecture: 'amd64' } },
  SchemaV2Manifest: { config: { digest: digest(`config-${key}`) } },
  Layers: [{ digest: digest(`layer-${key}`) }], ...overrides,
});
const cohortInput = (mutate = null) => {
  const input = {
    sourceSha, workflowBytes, registry,
    producers: Object.fromEntries(COHORT_KEYS.map((key) => [key, producer(key)])),
    jobs: COHORT_KEYS.map((key) => job(key)),
    inspections: Object.fromEntries(COHORT_KEYS.map((key) => [key, inspection(key)])),
    admittedRefs: Object.fromEntries(COHORT_KEYS.map((key) => [key, digest(`manifest-${key}`)])),
  };
  return mutate ? (mutate(input) || input) : input;
};

test('L5-A: resolves the exact three-image cohort at one immutable main SHA', () => {
  const cohort = resolveCohort(cohortInput());
  assert.deepEqual(Object.keys(cohort.targets).sort(), [...COHORT_KEYS].sort());
  assert.equal(cohort.sourceSha, sourceSha);
  for (const key of COHORT_KEYS) {
    const target = cohort.targets[key];
    assert.equal(validateTarget(target, sourceSha, key), target);
    assert.match(target.ref, /@sha256:[a-f0-9]{64}$/);
    assert.ok(target.ref.startsWith(`${registry}/${imageNames[key]}@`));
    assert.equal(target.platform, policy.platform);
    assert.equal(target.configDigest, digest(`config-${key}`));
    assert.equal(target.provenance.verified, true);
    assert.equal(target.provenance.sourceSha, sourceSha);
    assert.equal(target.provenance.imageRef, target.ref);
    assert.ok(isDigest(target.provenance.receiptHash));
  }
});

test('L5-A: missing producer, wrong SHA/config/platform, tag movement and unrelated image reject the surface', () => {
  const cases = [
    ['missing producer', (input) => { delete input.producers['ui-production']; }, /missing producer/],
    ['missing CI job', (input) => { input.jobs = input.jobs.filter((entry) => entry.name !== 'build-ui'); }, /missing producer job/],
    ['failed job', (input) => { input.jobs[2] = job('ui-production', { conclusion: 'failure' }); }, /producer job/],
    ['wrong job head SHA', (input) => { input.jobs[0] = job('api-production', { head_sha: 'b'.repeat(40) }); }, /head SHA/],
    ['wrong producer source SHA', (input) => { input.producers['api-toolbox'] = producer('api-toolbox', { sourceSha: 'c'.repeat(40) }); }, /source SHA/],
    ['swapped run/attempt', (input) => { input.jobs[1] = job('api-toolbox', { run_attempt: 2 }); }, /run\/attempt/],
    ['wrong run id', (input) => { input.jobs[0] = job('api-production', { run_id: 40876641001 }); }, /run\/attempt/],
    ['wrong workflow digest', (input) => { input.producers['ui-production'] = producer('ui-production', { workflowDigest: digest('other') }); }, /workflow/],
    ['wrong platform', (input) => { input.producers['api-production'] = producer('api-production', { architecture: 'linux/arm64' }); }, /platform/],
    ['registry config mismatch', (input) => { input.inspections['api-production'] = inspection('api-production', { SchemaV2Manifest: { config: { digest: digest('other-config') } } }); }, /config/],
    ['missing amd64 platform descriptor', (input) => { input.inspections['ui-production'] = inspection('ui-production', { Descriptor: { digest: digest('manifest-ui-production'), platform: { os: 'linux', architecture: 'arm64' } } }); }, /platform/],
    ['tag movement', (input) => { input.admittedRefs['api-toolbox'] = digest('moved'); }, /tag movement/],
    ['unrelated image', (input) => { input.producers['ui-production'] = producer('ui-production', { ref: `${registry}/sentropic-evil:latest` }); }, /unrelated image/],
    ['mutable tag ref', (input) => { input.producers['api-production'] = producer('api-production', { ref: `${registry}/${imageNames['api-production']}:latest` }); }, /tag/],
    ['bad source SHA', (input) => { input.sourceSha = 'xyz'; }, /source SHA/],
  ];
  for (const [name, mutate, pattern] of cases) {
    assert.throws(() => resolveCohort(cohortInput(mutate)), pattern, name);
  }
});

test('L5-B: target-scoped acquisition credential stays outside scanner children and bridge paths', () => {
  const credentialDir = '/run/security-acquire/auth.abc123';
  const clean = {
    credentialDir,
    scannerArgs: ['run', '--rm', '--pull=never', '--read-only', '--image-src', 'remote',
      `${registry}/sentropic-api@${digest('manifest-api-production')}`],
    scannerEnv: { HOME: '/tmp', PATH: '/usr/bin:/bin' },
    mounts: [{ src: '/cache/db', dst: '/cache/db', readonly: true }],
  };
  assert.equal(validateAcquisitionBoundary(clean), true);
  for (const [name, mutate] of [
    ['credential dir in args', (input) => { input.scannerArgs.push(credentialDir); }],
    ['credential dir in env', (input) => { input.scannerEnv.DOCKER_CONFIG = credentialDir; }],
    ['credential dir mounted', (input) => { input.mounts.push({ src: credentialDir, dst: '/auth', readonly: true }); }],
    ['token env leaks', (input) => { input.scannerEnv.GITHUB_TOKEN = 'canary'; }],
    ['writable mount', (input) => { input.mounts.push({ src: '/data', dst: '/data', readonly: false }); }],
    ['relative mount src', (input) => { input.mounts.push({ src: 'relative', dst: '/data', readonly: true }); }],
    ['env-file flag', (input) => { input.scannerArgs.push('--env-file', credentialDir); }],
  ]) {
    const input = structuredClone(clean);
    mutate(input);
    assert.throws(() => validateAcquisitionBoundary(input), /coverage-blocked/, name);
  }
});

test('L5-B: anonymous public CI images keep digest/visibility gates with no private re-upload fallback', () => {
  const good = { packageName: 'ghcr.io/rhanka/sentropic-trivy', visibility: 'public',
    ref: `ghcr.io/rhanka/sentropic-trivy@${digest('index')}`, credentialUsed: false, reuploadFallback: false };
  assert.equal(validateAnonymousImagePull(good), true);
  for (const [name, delta] of [
    ['private package', { visibility: 'private' }],
    ['auth required', { authRequired: true }],
    ['credential used', { credentialUsed: true }],
    ['re-upload fallback', { reuploadFallback: true }],
    ['mutable tag', { ref: 'ghcr.io/rhanka/sentropic-trivy:latest' }],
    ['other package', { packageName: 'ghcr.io/other/image', ref: `ghcr.io/other/image@${digest('x')}` }],
  ]) {
    assert.throws(() => validateAnonymousImagePull({ ...good, ...delta }), /coverage-blocked/, name);
  }
});

test('T6-M1: ACT-L05 acceptance rows are complete with on-disk destinations', () => {
  assert.deepEqual(validateDisposition(L05_ACCEPTANCE), []);
  const ids = L05_ACCEPTANCE.map((row) => row.id);
  assert.deepEqual(ids, ['L5-A', 'L5-B', 'L5-C', 'L5-D', 'L5-E']);
  for (const row of L05_ACCEPTANCE) {
    assert.equal(row.owner, 'ACT-L05');
    assert.equal(row.suite, 'test-security-daily');
    assert.notEqual(row.disposition, 'na');
    for (const destination of row.destinations) {
      assert.ok(existsSync(join(here, destination)), `${row.id}: ${destination} must exist`);
    }
  }
});
