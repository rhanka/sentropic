import assert from 'node:assert/strict';
import { test } from 'node:test';
import { templateDiff } from './t3-template-diff.mjs';
import { qualify } from './t3-qualify.mjs';
import { digest } from './guards.mjs';
import { approvedRequest } from './fixtures.mjs';

const env = (name, value) => ({ name, value });
const rendered = { metadata: { labels: { app: 'api' } }, spec: { serviceAccountName: 'sentropic-app', containers: [
  { name: 'api', image: 'candidate', command: ['node', 'launch.mjs'], env: [env('A', '1'), env('B', '2')],
    volumeMounts: [{ name: 'cm-runtime', mountPath: '/run/cm-runtime', readOnly: true }] }],
  volumes: [{ name: 'cm-runtime', configMap: { name: 'runtime', defaultMode: 292 } }] } };
// Live objects carry API defaults, restartedAt and fields nobody applied: apply keeps them all.
const live = () => { const copy = structuredClone(rendered);
  copy.metadata.annotations = { 'kubectl.kubernetes.io/restartedAt': '2026-11-03T21:57:23Z' };
  Object.assign(copy.spec, { dnsPolicy: 'ClusterFirst', securityContext: {}, terminationGracePeriodSeconds: 30 });
  copy.spec.containers[0].env.splice(1, 0, env('LIVE_ONLY', 'kept'));
  copy.spec.containers[0].terminationMessagePath = '/dev/termination-log';
  return copy; };

test('apply keeps live-only fields, so defaults and restartedAt are not a template change', () => {
  assert.deepEqual(templateDiff(live(), rendered, structuredClone(rendered)), []);
});
test('a rendered entry missing from the wired template is one path per entry', () => {
  const wired = live(); wired.spec.containers[0].env = [env('A', '1')];
  wired.spec.volumes = []; wired.spec.containers[0].volumeMounts = [];
  assert.deepEqual(templateDiff(wired, rendered), ['/spec/containers/api/env/B',
    '/spec/containers/api/volumeMounts//run/cm-runtime', '/spec/volumes/cm-runtime']);
});
test('changed values, reordered keyed lists and replaced plain lists each start a rollout', () => {
  const wired = live(); wired.spec.containers[0].image = 'legacy';
  wired.spec.containers[0].env.reverse(); wired.spec.containers[0].command = ['node', 'index.js'];
  wired.spec.volumes[0].configMap.defaultMode = 420;
  assert.deepEqual(templateDiff(wired, rendered), ['/spec/containers/api/image', '/spec/containers/api/command',
    '/spec/containers/api/env:order', '/spec/volumes/cm-runtime/configMap/defaultMode']);
});
test('a field owned by the previous applied configuration and no longer rendered is deleted', () => {
  const previous = structuredClone(rendered);
  previous.spec.hostNetwork = true; previous.spec.containers[0].env.push(env('OWNED', 'x'));
  const wired = live(); wired.spec.hostNetwork = true; wired.spec.containers[0].env.push(env('OWNED', 'x'));
  assert.deepEqual(templateDiff(wired, rendered, previous), ['/spec/containers/api/env/OWNED:delete', '/spec/hostNetwork:delete']);
});

const config = { tier: 'restore', namespace: 'sentropic-restore-a4', executionFile: '/private/annex', templateLiveFile: '/private/live',
  templateRenderFile: '/private/render', templateDiffFile: '/private/receipt',
  request: { ...approvedRequest, format: 'prod-a4-request/1', namespace: 'sentropic' } };
const uiImage = 'ghcr.io/rhanka/sentropic-ui@sha256:' + 'c'.repeat(64);
const annex = JSON.stringify({ format: 'prod-a4-execution/1', namespace: 'sentropic', uiImage,
  ...Object.fromEntries(['authorizationRef', 'operationId', 'candidateCommit', 'candidateImage'].map(name => [name, config.request[name]])),
  actions: { 'start-ui': [['set', 'image', 'deployment/ui', `ui=${uiImage}`], ['scale', 'deployment/ui', '--replicas=1']] } });
function dependencies(strictZero) {
  const seen = { receipts: [] };
  return { seen, read: path => path === '/private/annex' ? annex : path, write: (path, value) => seen.receipts.push({ path, value }),
    judge: input => { seen.input = input; return { version: 't3-template-diff/1', strictZero, deployments: {} }; } };
}
test('P-0.8 qualification judges the captured templates with the annex images and keeps a receipt', async () => {
  const d = dependencies(true);
  assert.deepEqual(await qualify('template-diff', { ...config, executionSha256: digest(annex) }, d), { templateDiffZero: true });
  assert.deepEqual(d.seen.input, { live: '/private/live', rendered: '/private/render', image: config.request.candidateImage,
    annexCommands: [['set', 'image', 'deployment/ui', `ui=${uiImage}`]] });
  assert.equal(d.seen.receipts[0].path, '/private/receipt');
});
test('P-0.8 qualification refuses a non-zero diff and an annex that changed, after writing the evidence', async () => {
  const d = dependencies(false);
  await assert.rejects(qualify('template-diff', { ...config, executionSha256: digest(annex) }, d), /template_diff_nonzero/);
  assert.equal(d.seen.receipts.length, 1);
  await assert.rejects(qualify('template-diff', { ...config, executionSha256: '0'.repeat(64) }, dependencies(true)), /annex_changed/);
});
