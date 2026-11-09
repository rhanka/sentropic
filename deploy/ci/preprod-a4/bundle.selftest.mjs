import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { verifyRenderedSequence } from './topology.selftest.mjs';
const { parseAllDocuments } = createRequire(process.env.A4_YAML_PACKAGE ?? '/workspace/package.json')('yaml');
const load = tier => parseAllDocuments(readFileSync(`/rendered/${tier}.yaml`, 'utf8')).map(doc => doc.toJSON());
const base = load('preprod'), preprod = load('preprod-a4'), prod = load('prod'), prodA4 = load('prod-a4');
const object = (objects, kind, name) => objects.find(object => object.kind === kind && object.metadata.name === name);
for (const [objects, namespace] of [[base, 'sentropic-preprod'], [preprod, 'sentropic-preprod'], [prodA4, 'sentropic']]) {
  for (const resource of objects) assert.equal(resource.metadata.namespace, namespace, `${resource.kind}/${resource.metadata.name}`);
}
for (const name of ['api', 'auth-idp', 'artifact-content', 'ui']) {
  const tag = name === 'ui'
    ? 'sentropic-ui@sha256:bf1aa5096ad41750a3dec307c37d0929a418f76c168588d3b8dc8287ab34d3e0'
    : 'sentropic-api@sha256:f9e11434aa5fe23c87f3446b2c133bad438fc22105998f167f1267ca4cc610c2';
  for (const objects of [base, preprod]) assert.equal(object(objects, 'Deployment', name).spec.template.spec.containers[0].image, `ghcr.io/rhanka/${tag}`);
  console.log(`PASS: deploy-preprod (preprod-a4) would deploy ${name} on ${tag}`);
}
assert(!object(base, 'ConfigMap', 'sentropic-a4-runtime'));
assert.equal(object(base, 'ConfigMap', 'api').data.CM_IDENTITY_CUTOVER_CHECKPOINT_FILE, undefined);
for (const [name, image] of Object.entries({
  api: 'sentropic-api@sha256:4bfa71ce7e231a9ed752e4aaceb23129a3399540af4720e32e76782c3f798c05',
  'auth-idp': 'sentropic-api@sha256:4b78a02fc743ae85ce9f5819d5ebc6b49e02fca7b3161a87ea06afa401a3dc34',
  ui: 'sentropic-ui@sha256:1f33dd0cde7733d2061f02ab1a5a14eb1a6276ce99001c697f5c697e2c0c9d4e',
  'artifact-content': 'sentropic-api@sha256:4bfa71ce7e231a9ed752e4aaceb23129a3399540af4720e32e76782c3f798c05',
})) {
  assert.equal(object(prod, 'Deployment', name).spec.template.spec.containers[0].image,
    `ghcr.io/rhanka/${image}`);
}
// prod-a4 keeps the live prod release pins until the cutover IaC change replaces them.
for (const name of ['api', 'auth-idp', 'artifact-content', 'ui']) {
  assert.equal(object(prodA4, 'Deployment', name).spec.template.spec.containers[0].image,
    object(prod, 'Deployment', name).spec.template.spec.containers[0].image);
}
function checkA4(objects, tier) {
  const api = object(objects, 'Deployment', 'api').spec.template.spec;
  const config = object(objects, 'ConfigMap', 'api').data;
  const container = api.containers.find(container => container.name === 'api');
  assert.equal(config.CM_IDENTITY_CUTOVER_CHECKPOINT_FILE, '/run/cm-cutover/checkpoint.json');
  assert.equal(config.CM_IDENTITY_EMAIL_CODE_POLICY, 'hmac-sha256');
  assert.equal(config.CM_IDENTITY_EMAIL_CODE_POLICY_APPROVAL_REF, 'qk-secret-custody-r2:Q-K=A:2026-11-02');
  assert.equal(config.CM_IDENTITY_EMAIL_CODE_ACTIVE_KEY_REF, undefined);
  assert.deepEqual(container.command, ['node', '/run/cm-runtime/launch.mjs']);
  assert.equal(api.securityContext.runAsUser, 0); assert.equal(api.securityContext.runAsGroup, 0);
  assert.equal(api.securityContext.fsGroup, undefined);
  assert.equal(container.volumeMounts.find(mount => mount.name === 'cm-cutover').readOnly, true);
  assert.equal(api.volumes.find(volume => volume.name === 'cm-cutover').persistentVolumeClaim.claimName, 'sentropic-a4-custody');
  assert.equal(api.volumes.find(volume => volume.name === 'cm-cutover').persistentVolumeClaim.readOnly, true);
  for (const name of ['EMAIL_CODE_HMAC_KEY_ACTIVE', 'EMAIL_CODE_HMAC_KEY_ACTIVE_REF']) {
    assert.deepEqual(container.env.find(env => env.name === name).valueFrom.secretKeyRef, { name: 'email-code-hmac', key: name });
  }
  assert.equal(container.env.find(env => env.name === 'CM_IDENTITY_DELETION_BUDGETS_JSON').valueFrom.secretKeyRef.name, 'sentropic-identity-budgets');
  assert(!container.env.some(env => env.name === 'CM_IDENTITY_EMAIL_CODE_KEYS_JSON'));
  const runtime = object(objects, 'ConfigMap', 'sentropic-a4-runtime');
  const idp = object(objects, 'Deployment', 'auth-idp').spec.template.spec.containers[0];
  assert.deepEqual(idp.command, ['node', '/run/cm-runtime/launch.mjs', '--idp']);
  assert.equal(idp.workingDir, '/workspace');
  assert.equal(idp.env.find(env => env.name === 'JWT_SECRET').valueFrom.secretKeyRef.name, 'auth-idp-session-signing');
  assert.equal(idp.env.find(env => env.name === 'REMOTE_ACTION_ROLE').value, 'auth-idp');
  for (const name of ['EMAIL_CODE_HMAC_KEY_ACTIVE', 'EMAIL_CODE_HMAC_KEY_ACTIVE_REF', 'CM_IDENTITY_DELETION_BUDGETS_JSON']) {
    assert.deepEqual(idp.env.find(env => env.name === name), container.env.find(env => env.name === name));
  }
  for (const name of ['CM_IDENTITY_EMAIL_CODE_POLICY', 'CM_IDENTITY_EMAIL_CODE_POLICY_APPROVAL_REF']) {
    assert.equal(object(objects, 'ConfigMap', 'auth-idp').data[name], config[name]);
  }
  assert.equal(object(prod, 'Deployment', 'auth-idp').spec.template.spec.containers[0].command[1], 'apps/auth-idp/dist/index.js');
  assert.match(runtime.data['launch.mjs'], /key\.toString\('base64url'\)/);
  assert.match(runtime.data['stage.mjs'], /'wx', 0o600/);
  assert(!objects.some(object => object.kind === 'Secret' && ['email-code-hmac', 'sentropic-identity-budgets'].includes(object.metadata.name)));
  assert.deepEqual(container.env.find(env => env.name === 'CM_A4_NAMESPACE').valueFrom, { fieldRef: { fieldPath: 'metadata.namespace' } });
  assert.deepEqual(idp.env.find(env => env.name === 'CM_A4_NAMESPACE'), container.env.find(env => env.name === 'CM_A4_NAMESPACE'));
  console.log(`PASS: rendered ${tier} custody, real policy reference, private HMAC composition and budget wiring`);
}
checkA4(preprod, 'preprod-a4'); checkA4(prodA4, 'prod-a4');
for (const name of ['api', 'auth-idp']) {
  const wired = objects => object(objects, 'Deployment', name).spec.template.spec;
  const a4 = objects => wired(objects).volumes?.filter(volume => ['cm-cutover', 'cm-runtime'].includes(volume.name));
  assert.deepEqual(a4(prodA4), a4(preprod), `${name} A4 volumes are tier-independent`);
}
assert.equal(object(prod, 'ConfigMap', 'api').data.CM_IDENTITY_CUTOVER_CHECKPOINT_FILE, undefined);
assert.equal(object(prod, 'Deployment', 'api').spec.template.spec.volumes, undefined);
for (const objects of [prod, prodA4]) {
  assert.equal(object(objects, 'ConfigMap', 'api').data.OAUTH_SERVICE_ISSUER_URL, 'https://auth.sent-tech.ca');
  assert.equal(object(objects, 'ConfigMap', 'api').data.OAUTH_SERVICE_RESOURCE_URI, 'https://sentropic.sent-tech.ca');
}
console.log('PASS: prod unchanged outside prod-a4 except the declared S2S issuer and resource');
await verifyRenderedSequence(preprod, 'preprod'); await verifyRenderedSequence(prodA4, 'prod');
