import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { drive } from './t3-window-driver.mjs';
import { ops } from './ops.mjs';
import { digest } from './guards.mjs';
import { approvedRequest } from './fixtures.mjs';
import { probeEndpoints } from './t3-probe-fixture.mjs';

test('RUN6 delivered ops create required pod Secret and stage checkpoint files on an empty PVC', async () => {
  const stateDir = mkdtempSync(join(tmpdir(), 't3-delivered-'));
  const request = { ...approvedRequest, remoteSnapshotDigest: digest('{}') };
  const budgets = { qualificationReceiptRef: 'track:qualified-replica-budget' };
  for (const key of ['reservation', 'deletion', 'diagnostic', 'read', 'workspace', 'replicaExport', 'replicaValidation', 'replicaSync']) {
    budgets[key] = { deadlineMs: 12345, maxAttempts: 1 };
  }
  const patch = readFileSync(new URL('../../k8s/components/a4-wiring/patch-api-a4.yaml', import.meta.url), 'utf8');
  const dependency = patch.match(/secretKeyRef: \{ name: (sentropic-identity-budgets), key: (\S+) \}/);
  assert.ok(dependency, 'derive the mandatory Secret reference from the shipped pod wiring');
  const container = { name: 'api', command: ['node', '/run/cm-runtime/launch.mjs'], envFrom: [],
    env: [{ name: dependency[2], valueFrom: { secretKeyRef: { name: dependency[1], key: dependency[2] } } }],
    volumeMounts: [{ name: 'custody', readOnly: true }] };
  const api = { spec: { replicas: 0, template: { spec: { containers: [container], volumes: [
    { name: 'runtime', configMap: { name: 'sentropic-a4-runtime' } },
    { name: 'custody', persistentVolumeClaim: { claimName: 'sentropic-a4-custody' } },
  ] } } } };
  const secrets = new Set(), pvc = {};
  let checkpoint = false;
  const read = path => path.endsWith('request.json') ? JSON.stringify(request)
    : path === '/budgets' ? JSON.stringify(budgets) : path === '/remote' ? '{}' : 'rehearsal-bytes';
  const kubectl = (_kube, args, input) => {
    if (args[0] === 'get') return JSON.stringify(api);
    if (args[0] === 'create') {
      const resource = JSON.parse(input);
      if (resource.kind === 'Secret') secrets.add(resource.metadata.name);
      if (resource.kind === 'Pod') {
        for (const env of resource.spec.containers[0].env) {
          if (env.valueFrom?.secretKeyRef) assert.ok(secrets.has(env.valueFrom.secretKeyRef.name), 'pod cannot become Ready without its required Secret');
        }
      }
    }
    if (args[0] === 'exec') {
      Object.assign(pvc, JSON.parse(input));
      return Object.entries(JSON.parse(input)).map(([name, bytes]) => `${name.replace('.json', '')}Sha256=${digest(bytes)}\n`).join('');
    }
    return '';
  };
  const code = await drive({ stateDir, dryRun: true, print: () => {}, call: () => '', tier: 'preprod',
    config: { request, endpoints: probeEndpoints(), namespace: 'sentropic-preprod', kubeconfigFile: '/kube', budgetsFile: '/budgets',
      remoteFile: '/remote', rehearsalFile: '/rehearsal', images: { candidate: 'c', ui: 'u' } },
    delivered: (_ctx, _script, env) => {
      if (['budgets', 'custodian', 'stage'].includes(env.A4_OPERATION)) {
        return ops({ ...env, A4_DRY_RUN: '0' }, kubectl, read);
      }
      if (env.A4_PHASE === 'snapshot') assert.deepEqual(Object.keys(pvc).sort(), ['remote.json', 'request.json']);
      if (env.A4_PHASE === 'checkpoint') {
        assert.equal(pvc['rehearsal.json'], 'rehearsal-bytes');
        assert.equal(digest(pvc['remote.json']), request.remoteSnapshotDigest);
        checkpoint = true;
      }
      return '';
    } });
  assert.equal(code, 0);
  assert.equal(checkpoint, true, 'real ops reached the checkpoint with all protected inputs');
});
