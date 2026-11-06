import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execute } from './execution.mjs';
import { canonical, digest } from './guards.mjs';
import { approvedRequest, image } from './fixtures.mjs';

const fixture = (commands = [['scale', 'deployment/api', '--replicas=1']]) => {
  const grant = { ...approvedRequest, format: 'preprod-a4-execution/1', actions: { 'start-api': commands } };
  const bytes = JSON.stringify(grant), calls = [];
  const env = { A4_KUBECONFIG_FILE: '/private/kube', A4_REQUEST_FILE: '/private/request', A4_ACTION: 'start-api',
    A4_EXECUTION_FILE: '/private/annex', A4_EXECUTION_SHA256: digest(bytes) };
  return { env, calls, call: (...args) => { calls.push(args); return 'PRIVATE-RESPONSE-SENTINEL'; },
    read: path => path === env.A4_REQUEST_FILE ? JSON.stringify(approvedRequest) : path === env.A4_EXECUTION_FILE ? bytes : 'private' };
};
test('should execute only the exact approved action and suppress Kubernetes output', () => {
  const f = fixture();
  assert.match(execute(f.env, f.call, f.read), /^executionSha256=[a-f0-9]{64}\n$/); assert.equal(f.calls.length, 0);
  assert.match(execute({ ...f.env, A4_DRY_RUN: '0' }, f.call, f.read), /^executionSha256=[a-f0-9]{64}\n$/);
  assert.deepEqual(f.calls[0][1], ['scale', 'deployment/api', '--replicas=1']);
});
test('should refuse annex drift, missing action and unreviewed commands before writes', () => {
  const f = fixture();
  assert.throws(() => execute({ ...f.env, A4_EXECUTION_SHA256: '0'.repeat(64) }, f.call, f.read), /annex_changed/);
  assert.throws(() => execute({ ...f.env, A4_ACTION: 'start-idp' }, f.call, f.read), /action_not_authorized/);
  assert.equal(f.calls.length, 0);
  for (const command of [['get', 'secret', 'email-code-hmac'], ['scale', 'statefulset/postgres', '--replicas=0'],
    ['set', 'image', 'deployment/api', `api=${image.replace(/a{64}/, 'c'.repeat(64))}`],
    ['patch', 'cronjob', 'sentropic-idp-identity-sync', '--type=merge', '-p', '{"spec":{"suspend":false}}']]) {
    const g = fixture([command]);
    assert.throws(() => execute({ ...g.env, A4_DRY_RUN: '0' }, g.call, g.read)); assert.equal(g.calls.length, 0);
  }
});
test('should establish only the approved host allowlist and refuse to replace another middleware', () => {
  const spec = { ipAllowList: { sourceRange: ['192.0.2.10/32'] } };
  const grant = { ...approvedRequest, format: 'preprod-a4-execution/1', middlewareSpec: spec,
    middlewareSpecSha256: digest(canonical(spec)), actions: { restrict: ['sentropic', 'auth-idp'].map(name =>
      ['annotate', 'ingress', name, 'traefik.ingress.kubernetes.io/router.middlewares=sentropic-preprod-a4-verification@kubernetescrd', '--overwrite']) } };
  const env = { ...fixture().env, A4_ACTION: 'restrict', A4_DRY_RUN: '0', A4_EXECUTION_SHA256: digest(JSON.stringify(grant)) };
  const read = path => path === env.A4_REQUEST_FILE ? JSON.stringify(approvedRequest)
    : path === env.A4_EXECUTION_FILE ? JSON.stringify(grant) : 'private';
  const calls = [];
  execute(env, (_config, args, input) => {
    calls.push({ args, input }); return JSON.stringify({ metadata: { annotations: {} } });
  }, read);
  assert.equal(calls[2].args[0], 'create'); assert.deepEqual(JSON.parse(calls[2].input).spec, spec);
  assert.equal(calls.filter(call => call.args[0] === 'annotate').length, 2);
  assert.throws(() => execute(env, (_config, args) => {
    assert.equal(args[0], 'get'); return JSON.stringify({ metadata: { annotations: {
      'traefik.ingress.kubernetes.io/router.middlewares': 'tenant-security@kubernetescrd' } } });
  }, read), /existing_ingress_middleware/);
});
