import assert from 'node:assert/strict';
import { test } from 'node:test';
import { verify } from './verify.mjs';
import { approvedRequest, commit, image, sha } from './fixtures.mjs';

test('should require readiness, serving endpoints, database evidence and HTTP 200', async () => {
  const request = { ...approvedRequest, operationId: 'a4', candidateCommit: commit, candidateImage: image, backupTemplateSha256: sha };
  const api = { metadata: { generation: 2 }, spec: { replicas: 1, template: { spec: { containers: [{ name: 'api', image }] } } },
    status: { availableReplicas: 1, updatedReplicas: 1, observedGeneration: 2 } };
  const calls = [];
  const call = (_config, args) => {
    calls.push(args);
    if (args[1] === 'deployment') return JSON.stringify(api);
    if (args[1] === 'endpointslices') return JSON.stringify({ items: [{ endpoints: [{ conditions: { ready: true } }] }] });
    if (args[0] === 'exec') return `verificationSha256=${sha}\n`;
    assert.fail('unexpected call');
  };
  const env = { A4_KUBECONFIG_FILE: '/private/kube', A4_REQUEST_FILE: '/private/request' };
  const read = path => path.endsWith('request') ? JSON.stringify(request) : 'private';
  const result = await verify(env, call, read, async () => new Response('{}', { status: 200 }));
  assert(result.trim().split('\n').every(line => /^[A-Za-z]+Sha256=[a-f0-9]{64}$/.test(line)));
  assert(calls.every(args => ['get', 'exec'].includes(args[0])));
  await assert.rejects(verify(env, call, read, async () => new Response('{}', { status: 502 })));
  api.status.availableReplicas = 0;
  await assert.rejects(verify(env, call, read, () => assert.fail('must not probe an unready API')));
});
