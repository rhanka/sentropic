import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { run } from './run.mjs';
import { assertDigestOutput, assertFence, canonical, digest } from './guards.mjs';
import { commit, cron, fixture, image, sha } from './fixtures.mjs';

const request = { namespace: 'sentropic-preprod', operationId: 'approved-cutover', candidateCommit: commit,
  candidateImage: image, backupTemplateSha256: digest(canonical(cron.spec.jobTemplate.spec)) };
const env = { A4_KUBECONFIG_FILE: '/private/kubeconfig', A4_REQUEST_FILE: '/private/request', A4_DRY_RUN: '1' };
const read = path => path.endsWith('request') ? JSON.stringify(request) : 'PRIVATE-KUBECONFIG-SENTINEL';

for (const phase of ['snapshot', 'checkpoint']) test(`should perform no writes in ${phase} dry-run`, () => {
  const fake = fixture();
  const result = run({ ...env, A4_PHASE: phase }, fake.call, read);
  assertDigestOutput(result);
  assert(fake.calls.every(({ args }) => ['get', 'exec'].includes(args[0])));
  assert(fake.calls.filter(({ args }) => args[0] === 'exec').every(({ input }) => JSON.parse(input).dryRun === true));
  assert(!JSON.stringify(fake.calls).includes('PRIVATE-KUBECONFIG-SENTINEL'));
});
test('should clone only the reviewed tenant backup template and suppress backup logs', () => {
  const fake = fixture();
  const result = run({ ...env, A4_PHASE: 'snapshot', A4_DRY_RUN: '0' }, fake.call, read);
  assertDigestOutput(result);
  assert(!result.includes('PRIVATE-LOG-SENTINEL'));
  const create = fake.calls.find(({ args }) => args[0] === 'create');
  assert.deepEqual(JSON.parse(create.input).spec, cron.spec.jobTemplate.spec);
  assert.equal(JSON.parse(create.input).metadata.namespace, 'sentropic-preprod');
  const last = fake.calls.filter(({ args }) => args[0] === 'exec').at(-1);
  assert.equal(JSON.parse(last.input).backupKey, 'pg/20261106T150000Z.sql.gz');
  assert.equal(JSON.parse(last.input).dryRun, false);
});
test('should reject a changed backup template before creating any Job', () => {
  const fake = fixture(); fake.data.cron.spec.jobTemplate.spec.backoffLimit = 7;
  assert.throws(() => run({ ...env, A4_DRY_RUN: '0' }, fake.call, read));
  assert(fake.calls.every(({ args }) => args[0] === 'get'));
});
for (const failure of ['replica', 'pod', 'cron', 'job', 'image', 'volume']) {
  test(`should refuse ${failure} fence drift before backup creation`, () => {
    const fake = fixture();
    if (failure === 'replica') fake.data.objects[0].status.replicas = 1;
    if (failure === 'pod') fake.data.pods.push({ metadata: { name: 'stray-writer' }, status: { phase: 'Running' } });
    if (failure === 'cron') fake.data.objects[1].spec.suspend = false;
    if (failure === 'job') fake.data.objects.push({ kind: 'Job', status: { active: 1 } });
    if (failure === 'image') fake.data.pods[0].status.containerStatuses[0].imageID = 'unapproved';
    if (failure === 'volume') fake.data.pods[0].spec.volumes = [];
    assert.throws(() => assertFence(fake.data.objects, fake.data.pods, image));
    assert.throws(() => run({ ...env, A4_DRY_RUN: '0' }, fake.call, read));
    assert(!fake.calls.some(({ args }) => args[0] === 'create'));
  });
}
test('should reject unexpected worker output instead of forwarding row or credential material', () => {
  const fake = fixture({ workerOutput: `checkpointSha256=${sha}\nPRIVATE-ROW-SENTINEL\n` });
  assert.throws(() => run(env, fake.call, read), /unsafe_worker_output/);
});
test('should print only a fixed failure digest when invocation fails', () => {
  const result = spawnSync(process.execPath, ['deploy/ci/preprod-a4/run.mjs'], {
    encoding: 'utf8', env: { ...process.env, A4_PHASE: 'PRIVATE-ERROR-SENTINEL' } });
  assert.equal(result.status, 1); assert.equal(result.stdout, '');
  assert.match(result.stderr, /^failureSha256=[a-f0-9]{64}\n$/);
});
