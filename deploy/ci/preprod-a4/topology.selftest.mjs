import assert from 'node:assert/strict';
import { approvedRequest, image, sha } from './fixtures.mjs';
import { canonical, digest } from './guards.mjs';
import { execute } from './execution.mjs';
import { verify } from './verify.mjs';

export async function verifyRenderedSequence(rendered) {
  const objects = structuredClone(rendered);
  const object = (kind, name) => objects.find(item => item.kind === kind && item.metadata.name === name);
  const deployments = objects.filter(item => item.kind === 'Deployment');
  const restriction = { ipAllowList: { sourceRange: ['192.0.2.10/32'] } };
  const grant = { ...approvedRequest, format: 'preprod-a4-execution/1', uiImage: image.replace('sentropic-api', 'sentropic-ui'),
    middlewareSpecSha256: digest(canonical(restriction)), trafficRestrictionReceiptRef: 'tenant:synthetic-denial-proof', actions: {
      'start-ui': [['scale', 'deployment/ui', '--replicas=1']],
      'start-idp': [['scale', 'deployment/auth-idp', '--replicas=1']],
    } };
  for (const deployment of deployments) {
    const name = deployment.metadata.name;
    deployment.spec.replicas = name === 'api' ? 1 : 0;
    deployment.metadata.generation = 1;
    deployment.status = { availableReplicas: deployment.spec.replicas, updatedReplicas: deployment.spec.replicas, observedGeneration: 1 };
    for (const container of deployment.spec.template.spec.containers) {
      if (['api', 'auth-idp', 'ui'].includes(name)) container.image = name === 'ui' ? grant.uiImage : image;
    }
  }
  for (const cron of objects.filter(item => item.kind === 'CronJob')) cron.spec.suspend = true;
  const backend = name => object('Ingress', name).spec.rules[0].http.paths[0].backend.service.name;
  assert.equal(backend('sentropic'), 'ui'); assert.equal(backend('auth-idp'), 'auth-idp');
  const calls = [], env = { A4_KUBECONFIG_FILE: '/private/kube', A4_REQUEST_FILE: '/private/request',
    A4_EXECUTION_FILE: '/private/annex', A4_EXECUTION_SHA256: digest(JSON.stringify(grant)) };
  const read = path => path === env.A4_REQUEST_FILE ? JSON.stringify(approvedRequest)
    : path === env.A4_EXECUTION_FILE ? JSON.stringify(grant) : 'private';
  const call = (_config, args) => {
    calls.push(args);
    if (args[0] === 'exec') return `verificationSha256=${sha}\n`;
    if (args[0] === 'scale') {
      const deployment = object('Deployment', args[1].split('/')[1]);
      deployment.spec.replicas = 1; deployment.status.availableReplicas = 1; deployment.status.updatedReplicas = 1;
      return 'suppressed';
    }
    if (args[1] === 'middleware') return JSON.stringify({ spec: restriction });
    if (args[1].includes('deployments,')) return JSON.stringify({ items: objects.filter(item =>
      ['Deployment', 'StatefulSet', 'DaemonSet', 'CronJob', 'Job'].includes(item.kind)) });
    if (args[1] === 'endpointslices') return JSON.stringify({ items: [{ endpoints: [{ conditions: { ready: true } }] }] });
    return JSON.stringify(object(args[1] === 'deployment' ? 'Deployment' : 'Ingress', args[2]));
  };
  let probes = 0;
  const probe = async () => {
    probes++;
    const proxy = object('Deployment', backend('sentropic'));
    return new Response('{}', { status: proxy.status.availableReplicas === 1 ? 200 : 502 });
  };
  await verify(env, call, read, () => assert.fail('internal gate must not probe the stopped proxy'));
  const http = { ...env, A4_VERIFY_PHASE: 'http' };
  await assert.rejects(verify(http, call, read, probe), /ingress_boundary_invalid/);
  await assert.rejects(Promise.resolve().then(() => execute({ ...env, A4_ACTION: 'start-ui', A4_DRY_RUN: '0' }, call, read)), /ingress_boundary_invalid/);
  for (const name of ['sentropic', 'auth-idp']) object('Ingress', name).metadata.annotations[
    'traefik.ingress.kubernetes.io/router.middlewares'] = 'sentropic-preprod-a4-verification@kubernetescrd';
  await assert.rejects(verify(http, call, read, probe)); assert.equal(probes, 0);
  execute({ ...env, A4_ACTION: 'start-ui', A4_DRY_RUN: '0' }, call, read);
  await verify(http, call, read, probe); assert.equal(probes, 1);
  assert.equal(object('Deployment', 'auth-idp').spec.replicas, 0);
  execute({ ...env, A4_ACTION: 'start-idp', A4_DRY_RUN: '0' }, call, read);
  await verify(http, call, read, probe);
  assert(deployments.filter(item => !['api', 'ui', 'auth-idp'].includes(item.metadata.name)).every(item => item.spec.replicas === 0));
  console.log('PASS: rendered ingress sequence: internal -> restricted UI -> HTTP -> limited IdP; other writers stopped');
}
