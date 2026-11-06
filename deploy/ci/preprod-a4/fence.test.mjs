import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execute } from './execution.mjs';
import { run } from './run.mjs';
import { digest } from './guards.mjs';
import { approvedRequest, fixture } from './fixtures.mjs';

const authorization = Object.fromEntries(['namespace', 'operationId', 'authorizationRef', 'candidateCommit', 'candidateImage']
  .map(name => [name, approvedRequest[name]]));
authorization.format = 'preprod-a4-authorization/1';
const commands = [['scale', 'deployment/api', '--replicas=0'],
  ['patch', 'cronjob', 'pgbackup', '--type=merge', '-p', '{"spec":{"suspend":true}}']];
function setup(overrides = {}, binding = {}) {
  const grant = { ...authorization, ...binding, format: 'preprod-a4-execution/1', actions: { fence: commands } };
  const bytes = JSON.stringify(grant), fake = fixture();
  const env = { A4_KUBECONFIG_FILE: '/private/kube', A4_AUTHORIZATION_FILE: '/private/authorization',
    A4_REQUEST_FILE: '/private/request', A4_EXECUTION_FILE: '/private/annex', A4_EXECUTION_SHA256: digest(bytes),
    A4_ACTION: 'fence', A4_DRY_RUN: '0', A4_PHASE: 'checkpoint' };
  let request = { ...approvedRequest, legacyWritersStopped: false, remoteFileWriterStopped: false };
  const read = path => {
    if (path === env.A4_AUTHORIZATION_FILE) return JSON.stringify({ ...authorization, ...overrides });
    if (path === env.A4_EXECUTION_FILE) return bytes;
    if (path === env.A4_REQUEST_FILE) return JSON.stringify(request);
    return 'private';
  };
  return { env, fake, read, request, complete: () => { request = { ...approvedRequest }; } };
}
test('should fence running writers using prior approval then require actual evidence before preparation', () => {
  const f = setup(), calls = [];
  const api = f.fake.data.objects[0], cron = f.fake.data.objects[1];
  api.spec.replicas = api.status.replicas = 1; cron.spec.suspend = false;
  let remoteWriterRunning = true;
  const readApproval = path => {
    assert.notEqual(path, f.env.A4_REQUEST_FILE, 'fence must not read post-fence evidence');
    return f.read(path);
  };
  assert.match(execute({ ...f.env, A4_DRY_RUN: '1' }, () => assert.fail('dry-run write'), readApproval), /executionSha256=/);
  assert.equal(api.status.replicas, 1);
  execute(f.env, (_config, args) => {
    calls.push(args);
    if (args[0] === 'scale') api.spec.replicas = api.status.replicas = 0;
    if (args[0] === 'patch') cron.spec.suspend = true;
  }, readApproval);
  assert.deepEqual(calls, commands);
  assert.throws(() => run(f.env, f.fake.call, f.read), /request_invalid/);
  f.request.legacyWritersStopped = api.status.replicas === 0 && cron.spec.suspend;
  assert.throws(() => run(f.env, f.fake.call, f.read), /request_invalid/);
  remoteWriterRunning = false; // Separately performed tenant exclusion/export, never inferred from kubectl success.
  f.request.remoteFileWriterStopped = !remoteWriterRunning;
  f.request.writerFenceRef = 'custody:observed-fence';
  f.request.remoteSnapshotRef = 'custody:observed-remote-export';
  f.request.remoteSnapshotDigest = digest('{}');
  assert.match(run({ ...f.env, A4_DRY_RUN: '1' }, f.fake.call, f.read), /checkpointSha256=/);
  assert(!f.fake.calls.some(({ args }) => args[0] === 'create'));
});
test('should refuse missing or changed authorization before any fence command', () => {
  for (const overrides of [{ authorizationRef: undefined }, { authorizationRef: 'pending' },
    { format: 'preprod-a4-request/1' }, { candidateCommit: '0'.repeat(40) }]) {
    const f = setup(overrides);
    assert.throws(() => execute(f.env, () => assert.fail('unauthorized write'), f.read), /authorization_invalid/);
  }
  const f = setup({}, { authorizationRef: 'another:approval' });
  assert.throws(() => execute(f.env, () => assert.fail('unbound write'), f.read), /annex_binding_invalid/);
  assert.throws(() => execute({ ...f.env, A4_EXECUTION_SHA256: '0'.repeat(64) },
    () => assert.fail('changed annex write'), f.read), /annex_changed/);
});
test('should refuse preparation when a successful fence command has not stopped the observed writer', () => {
  const f = setup();
  f.fake.data.objects[0].status.replicas = 1;
  execute(f.env, () => '', f.read);
  f.complete();
  assert.throws(() => run(f.env, f.fake.call, f.read), /writer_not_quiesced/);
  assert(f.fake.calls.every(({ args }) => args[0] === 'get'));
});
