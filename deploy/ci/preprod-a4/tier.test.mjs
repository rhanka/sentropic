import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { assertAuthorization, assertRequest, canonical, digest, tierOf } from './guards.mjs';
import { execute } from './execution.mjs';
import { ops } from './ops.mjs';
import { run } from './run.mjs';
import { verify } from './verify.mjs';
import { approvedRequest, cron, fixture, image, sha } from './fixtures.mjs';

const prod = { ...approvedRequest, format: 'prod-a4-request/1', namespace: 'sentropic',
  emailCodeActiveKeyRef: 'email-code-hmac:v1:prod:0123456789abcdef' };
const authorization = { format: 'prod-a4-authorization/1', ...Object.fromEntries(['namespace', 'operationId',
  'authorizationRef', 'candidateCommit', 'candidateImage'].map(name => [name, prod[name]])) };
const env = { A4_TIER: 'prod', A4_KUBECONFIG_FILE: '/private/kube', A4_REQUEST_FILE: '/private/request', A4_DRY_RUN: '1' };
const read = (extra = {}) => path => path === env.A4_REQUEST_FILE ? JSON.stringify(prod) : extra[path] ?? 'private';

test('should require an explicit known tier and bind each tier to its own namespace and public origin', () => {
  for (const tier of [undefined, '', 'dev', 'PROD']) assert.throws(() => tierOf({ A4_TIER: tier }), /tier_invalid/);
  assert.deepEqual([tierOf({ A4_TIER: 'prod' }).namespace, tierOf({ A4_TIER: 'prod' }).origin],
    ['sentropic', 'https://sentropic.sent-tech.ca']);
  assert.deepEqual([tierOf({ A4_TIER: 'preprod' }).namespace, tierOf({ A4_TIER: 'preprod' }).origin],
    ['sentropic-preprod', 'https://preprod.sentropic.sent-tech.ca']);
});

test('should refuse a preprod authorization or request under the prod tier and the reverse', () => {
  const t = tierOf(env), p = tierOf({ A4_TIER: 'preprod' });
  assertAuthorization(authorization, t); assertRequest(prod, t);
  for (const change of [{ format: 'preprod-a4-authorization/1' }, { namespace: 'sentropic-preprod' }]) {
    assert.throws(() => assertAuthorization({ ...authorization, ...change }, t), /authorization_invalid/);
  }
  for (const change of [{ format: 'preprod-a4-request/1' }, { namespace: 'sentropic-preprod' },
    { emailCodeActiveKeyRef: 'email-code-hmac:v1:preprod:0123456789abcdef' }, { emailCodeActiveKeyRef: undefined }]) {
    assert.throws(() => assertRequest({ ...prod, ...change }, t), /request_invalid/);
  }
  assert.throws(() => assertRequest(prod, p), /request_invalid/);
});

test('should run every prod kubectl call in the sentropic namespace and clone the prod backup template', () => {
  const fake = fixture({ cron: { ...structuredClone(cron), metadata: { namespace: 'sentropic' } } });
  const namespaces = [];
  const call = (config, args, input, namespace) => { namespaces.push(namespace); return fake.call(config, args, input); };
  const request = { ...prod, backupTemplateSha256: digest(canonical(cron.spec.jobTemplate.spec)) };
  run({ ...env, A4_PHASE: 'snapshot', A4_DRY_RUN: '0' }, call, path => path === env.A4_REQUEST_FILE ? JSON.stringify(request) : 'private');
  assert.equal(JSON.parse(fake.calls.find(({ args }) => args[0] === 'create').input).metadata.namespace, 'sentropic');
  assert(namespaces.length > 0 && namespaces.every(namespace => namespace === 'sentropic'));
  assert.throws(() => run({ ...env, A4_PHASE: 'inspect' }, fixture().call, read()), /backup_path_invalid/);
});

test('should wire prod from the shared A4 wiring component and create prod budgets and custody', () => {
  const calls = [];
  ops({ ...env, A4_OPERATION: 'wire', A4_DRY_RUN: '0' }, (_config, args, input, namespace) => {
    calls.push({ args, input, namespace }); return args[0] === 'get' ? JSON.stringify({ spec: { replicas: 0 } }) : 'runtime';
  }, read());
  const files = calls.flatMap(({ args }) => args.filter(arg => arg.startsWith('--patch-file=') || arg.endsWith('.yaml')));
  assert.deepEqual(files, ['deploy/ci/preprod-a4/custody-pvc.yaml', '--patch-file=deploy/k8s/components/a4-wiring/patch-api-config.yaml',
    '--patch-file=deploy/k8s/components/a4-wiring/patch-api-a4.yaml', '--patch-file=deploy/k8s/components/a4-wiring/patch-auth-idp-config.yaml',
    '--patch-file=deploy/k8s/components/a4-wiring/patch-auth-idp-a4.yaml']);
  assert(calls.every(({ namespace }) => namespace === 'sentropic'));
  assert.doesNotMatch(readFileSync('deploy/ci/preprod-a4/custody-pvc.yaml', 'utf8'), /namespace:/);
  const budgets = { qualificationReceiptRef: 'track:prod-rehearsal-budgets' };
  for (const name of ['reservation', 'deletion', 'diagnostic', 'read', 'workspace', 'replicaExport', 'replicaValidation', 'replicaSync']) {
    budgets[name] = { deadlineMs: 1000, maxAttempts: 1 };
  }
  const created = [];
  ops({ ...env, A4_OPERATION: 'budgets', A4_DRY_RUN: '0', A4_BUDGETS_FILE: '/private/budgets' },
    (_config, args, input) => created.push(JSON.parse(input)), read({ '/private/budgets': JSON.stringify(budgets) }));
  assert.equal(created[0].metadata.namespace, 'sentropic');
});

test('should restrict prod traffic only with the prod verification middleware and probe the prod origin', async () => {
  const spec = { ipAllowList: { sourceRange: ['192.0.2.10/32'] } };
  const annotate = middleware => ['sentropic', 'auth-idp'].map(name =>
    ['annotate', 'ingress', name, `traefik.ingress.kubernetes.io/router.middlewares=${middleware}@kubernetescrd`, '--overwrite']);
  const grant = (middleware) => ({ ...prod, format: 'prod-a4-execution/1', middlewareSpec: spec,
    middlewareSpecSha256: digest(canonical(spec)), actions: { restrict: annotate(middleware) } });
  const attempt = middleware => {
    const bytes = JSON.stringify(grant(middleware));
    const e = { ...env, A4_ACTION: 'restrict', A4_DRY_RUN: '1', A4_EXECUTION_FILE: '/private/annex', A4_EXECUTION_SHA256: digest(bytes) };
    return execute(e, () => JSON.stringify({ metadata: { annotations: {} } }), read({ '/private/annex': bytes }));
  };
  assert.match(attempt('sentropic-a4-verification'), /executionSha256=/);
  assert.throws(() => attempt('sentropic-preprod-a4-verification'), /command_not_allowed/);
  const api = { metadata: { generation: 1 }, spec: { replicas: 1, template: { spec: { containers: [{ name: 'api', image }] } } },
    status: { availableReplicas: 1, updatedReplicas: 1, observedGeneration: 1 } };
  const ui = structuredClone(api); ui.spec.template.spec.containers = [{ name: 'ui', image: image.replace('sentropic-api', 'sentropic-ui') }];
  const g = { ...grant('sentropic-a4-verification'), uiImage: ui.spec.template.spec.containers[0].image, trafficRestrictionReceiptRef: 'tenant:denial-proof' };
  const call = (_config, args) => {
    if (args[1] === 'deployment') return JSON.stringify(args[2] === 'ui' ? ui : api);
    if (args[1] === 'middleware') return JSON.stringify({ spec });
    if (args[1] === 'ingress') return JSON.stringify({ metadata: { annotations: {
      'traefik.ingress.kubernetes.io/router.middlewares': 'sentropic-a4-verification@kubernetescrd' } },
    spec: { rules: [{ http: { paths: [{ backend: { service: { name: args[2] === 'sentropic' ? 'ui' : 'auth-idp' } } }] } }] } });
    if (args[1].includes('deployments,')) return JSON.stringify({ items: [] });
    if (args[1] === 'endpointslices') return JSON.stringify({ items: [{ endpoints: [{ conditions: { ready: true } }] }] });
    return `verificationSha256=${sha}\n`;
  };
  const probed = [];
  const bytes = JSON.stringify(g);
  await verify({ ...env, A4_VERIFY_PHASE: 'http', A4_EXECUTION_FILE: '/private/annex', A4_EXECUTION_SHA256: digest(bytes) },
    call, read({ '/private/annex': bytes }), async url => { probed.push(url); return new Response('{}', { status: 200 }); });
  assert.deepEqual(probed, ['https://sentropic.sent-tech.ca/api/v1/health']);
});
