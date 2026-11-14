import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { legacy } from './t3-legacy-fixture.mjs';
import { deployments, judge, templateDiff } from './t3-template-diff.mjs';

// Hermetic P-0.8: real kubectl (kustomize, patch --local, set image --local), no cluster, no network.
function render(overlay) {
  const result = spawnSync('kubectl', ['kustomize', `deploy/k8s/overlays/${overlay}`], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}
const container = (set, name) => set[name].spec.template.spec.containers[0];
const rendered = render('prod-a4'), pins = deployments(rendered), live = JSON.stringify(legacy());
// The wire and the annex set the attempt images. Here they are the pins of the render under test,
// whatever release this tree pins; t3-iac.test.mjs holds the cutover pins themselves.
const image = container(pins, 'api').image;
const annexCommands = ['auth-idp', 'ui'].map(name => ['set', 'image', `deployment/${name}`, `${name}=${container(pins, name).image}`]);

const receipt = judge({ live, rendered, image, annexCommands });
for (const [name, entry] of Object.entries(receipt.deployments)) assert.deepEqual(entry.diff, [], `${name} pod template`);
assert.equal(receipt.strictZero, true);
console.log('PASS: legacy prod templates, W3 wire and annex images give the prod-a4 pod templates (zero diff, no rollout at apply)');

// Controls: the judge sees an unwired legacy template and an annex image that is not the pin.
const unwired = templateDiff(legacy().items[0].spec.template, pins.api.spec.template);
for (const path of ['/spec/affinity', '/spec/volumes', '/spec/securityContext/runAsUser', '/spec/containers/api/command',
  '/spec/containers/api/env', '/spec/containers/api/volumeMounts']) assert.ok(unwired.includes(path), path);
const drift = judge({ live, rendered, image, annexCommands: [['set', 'image', 'deployment/ui', 'ui=ghcr.io/rhanka/sentropic-ui:other']] });
assert.deepEqual(drift.deployments.ui.diff, ['/spec/containers/ui/image']);
assert.equal(drift.strictZero, false);
console.log('PASS: an unwired template and an annex image off the rendered pin are reported');

// The wiring restates base entries for the legacy template. It must never override or outlive
// them: the A4 overlay renders every base entry unchanged and adds only its own names.
const own = { api: { env: ['CM_A4_NAMESPACE', 'CM_IDENTITY_CUTOVER_IDP_RP_ID', 'EMAIL_CODE_HMAC_KEY_ACTIVE', 'EMAIL_CODE_HMAC_KEY_ACTIVE_REF',
  'EMAIL_CODE_HMAC_KEY_PREVIOUS', 'EMAIL_CODE_HMAC_KEY_PREVIOUS_REF', 'CM_IDENTITY_DELETION_BUDGETS_JSON'], volumes: ['cm-cutover', 'cm-runtime'] } };
own['auth-idp'] = { env: own.api.env.filter(name => name !== 'CM_IDENTITY_CUTOVER_IDP_RP_ID'), volumes: ['cm-runtime'] };
for (const [base, a4] of [['prod', 'prod-a4'], ['preprod', 'preprod-a4']]) {
  const plain = deployments(render(base)), wiredOverlay = a4 === 'prod-a4' ? pins : deployments(render(a4));
  for (const name of ['api', 'auth-idp']) {
    const lists = set => { const spec = set[name].spec.template.spec;
      return { env: spec.containers[0].env ?? [], volumes: spec.volumes ?? [], mounts: spec.containers[0].volumeMounts ?? [] }; };
    const [from, to] = [lists(plain), lists(wiredOverlay)];
    for (const [kind, key] of [['env', 'name'], ['volumes', 'name'], ['mounts', 'mountPath']]) {
      for (const entry of from[kind]) assert.deepEqual(to[kind].find(item => item[key] === entry[key]), entry, `${a4} ${name} ${kind} ${entry[key]}`);
    }
    const added = kind => to[kind].map(item => item.name).filter(value => !from[kind].some(item => item.name === value));
    assert.deepEqual(added('env'), own[name].env, `${a4} ${name} adds only A4 env`);
    assert.deepEqual(added('volumes').sort(), own[name].volumes, `${a4} ${name} adds only A4 volumes`);
  }
}
console.log('PASS: A4 wiring restates the base entries unchanged in prod-a4 and preprod-a4');
