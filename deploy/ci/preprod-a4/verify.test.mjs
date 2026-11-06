import assert from 'node:assert/strict';
import { test } from 'node:test';
import { verify } from './verify.mjs';
import { approvedRequest, commit, image, sha } from './fixtures.mjs';
import { canonical, digest } from './guards.mjs';

test('should verify internal gates with UI stopped, then HTTP only through the restricted serving UI', async () => {
  const request = { ...approvedRequest, operationId: 'a4', candidateCommit: commit, candidateImage: image, backupTemplateSha256: sha };
  const api = { metadata: { generation: 2 }, spec: { replicas: 1, template: { spec: { containers: [{ name: 'api', image }] } } },
    status: { availableReplicas: 1, updatedReplicas: 1, observedGeneration: 2 } };
  const calls = [];
  const ui = structuredClone(api); ui.spec.replicas = 0;
  ui.spec.template.spec.containers = [{ name: 'ui', image: image.replace('sentropic-api', 'sentropic-ui') }];
  const restriction = { ipAllowList: { sourceRange: ['192.0.2.10/32'] } };
  const grant = { ...request, format: 'preprod-a4-execution/1', uiImage: ui.spec.template.spec.containers[0].image,
    middlewareSpecSha256: digest(canonical(restriction)), trafficRestrictionReceiptRef: 'tenant:external-denial-proof' };
  const worker = { kind: 'Deployment', metadata: { name: 'worker' }, spec: { replicas: 0 }, status: { replicas: 0 } };
  const call = (_config, args) => {
    calls.push(args);
    if (args[1] === 'deployment') return JSON.stringify(args[2] === 'ui' ? ui : api);
    if (args[1] === 'middleware') return JSON.stringify({ spec: restriction });
    if (args[1] === 'ingress') return JSON.stringify({ metadata: { annotations: {
      'traefik.ingress.kubernetes.io/router.middlewares': 'sentropic-preprod-a4-verification@kubernetescrd' } },
    spec: { rules: [{ http: { paths: [{ backend: { service: { name: args[2] === 'sentropic' ? 'ui' : 'auth-idp' } } }] } }] } });
    if (args[1].includes('deployments,')) return JSON.stringify({ items: [worker] });
    if (args[1] === 'endpointslices') return JSON.stringify({ items: [{ endpoints: [{ conditions: { ready: true } }] }] });
    if (args[0] === 'exec') return `verificationSha256=${sha}\n`;
    assert.fail('unexpected call');
  };
  const env = { A4_KUBECONFIG_FILE: '/private/kube', A4_REQUEST_FILE: '/private/request' };
  const read = path => path.endsWith('request') ? JSON.stringify(request) : path === '/private/grant' ? JSON.stringify(grant) : 'private';
  const result = await verify(env, call, read, () => assert.fail('stopped UI must not be probed'));
  assert(result.trim().split('\n').every(line => /^[A-Za-z]+Sha256=[a-f0-9]{64}$/.test(line)));
  assert(calls.every(args => ['get', 'exec'].includes(args[0])));
  const http = { ...env, A4_VERIFY_PHASE: 'http', A4_EXECUTION_FILE: '/private/grant', A4_EXECUTION_SHA256: digest(JSON.stringify(grant)) };
  await assert.rejects(verify(http, call, read, () => assert.fail('stopped UI must not be probed')), /ui_not_ready/);
  ui.spec.replicas = 1;
  await verify(http, call, read, async () => new Response('{}', { status: 200 }));
  await assert.rejects(verify(http, call, read, async () => new Response('{}', { status: 502 })), /public_api_not_200/);
  worker.spec.replicas = 1;
  await assert.rejects(verify(http, call, read, () => assert.fail('writer resumed')), /writer_not_fenced/);
  worker.spec.replicas = 0; restriction.ipAllowList.sourceRange = ['0.0.0.0/0'];
  await assert.rejects(verify(http, call, read, () => assert.fail('traffic restriction changed')), /traffic_not_restricted/);
  api.status.availableReplicas = 0;
  await assert.rejects(verify(env, call, read, () => assert.fail('must not probe an unready API')));
});
