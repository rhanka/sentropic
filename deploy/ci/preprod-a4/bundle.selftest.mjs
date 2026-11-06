import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { verifyRenderedSequence } from './topology.selftest.mjs';
const { parseAllDocuments } = createRequire(process.env.A4_YAML_PACKAGE ?? '/workspace/package.json')('yaml');
const load = tier => parseAllDocuments(readFileSync(`/rendered/${tier}.yaml`, 'utf8')).map(doc => doc.toJSON());
const recovery = load('preprod'), preprod = load('preprod-a4'), prod = load('prod');
const object = (objects, kind, name) => objects.find(object => object.kind === kind && object.metadata.name === name);
for (const objects of [recovery, preprod]) {
  for (const resource of objects) assert.equal(resource.metadata.namespace, 'sentropic-preprod', `${resource.kind}/${resource.metadata.name}`);
}
for (const name of ['api', 'auth-idp', 'artifact-content', 'ui']) {
  const pod = object(recovery, 'Deployment', name).spec.template.spec;
  const tag = name === 'ui'
    ? 'sentropic-ui@sha256:a9d7c1aa415e7c445ceb47f6eca47789c1edc4ca3b84ab465cd1386b4e31f28d'
    : 'sentropic-api@sha256:0a401baad9904c555f756f998538fddf0b4b86013878269ad34494a03d2807bb';
  assert.equal(pod.containers[0].image, `ghcr.io/rhanka/${tag}`);
  assert(!pod.volumes?.some(volume => ['cm-cutover', 'cm-runtime'].includes(volume.name)));
  assert(!pod.containers[0].command?.some(arg => arg.includes('/run/cm-runtime/')));
  assert(!pod.containers[0].env?.some(env => env.valueFrom?.secretKeyRef?.name === 'sentropic-identity-budgets'));
  console.log(`PASS: deploy-preprod would deploy ${name} on ${tag} with recovery runtime`);
}
assert(!object(recovery, 'ConfigMap', 'sentropic-a4-runtime'));
assert.equal(object(recovery, 'ConfigMap', 'api').data.CM_IDENTITY_CUTOVER_CHECKPOINT_FILE, undefined);
for (const name of ['api', 'auth-idp', 'artifact-content', 'ui']) {
  assert.equal(object(prod, 'Deployment', name).spec.template.spec.containers[0].image,
    `ghcr.io/rhanka/sentropic-${name === 'ui' ? 'ui' : 'api'}:main`);
}
const api = object(preprod, 'Deployment', 'api').spec.template.spec;
const config = object(preprod, 'ConfigMap', 'api').data;
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
const runtime = object(preprod, 'ConfigMap', 'sentropic-a4-runtime');
const idp = object(preprod, 'Deployment', 'auth-idp').spec.template.spec.containers[0];
assert.deepEqual(idp.command, ['node', '/run/cm-runtime/launch.mjs', '--idp']);
assert.equal(idp.workingDir, '/workspace');
assert.equal(idp.env.find(env => env.name === 'JWT_SECRET').valueFrom.secretKeyRef.name, 'auth-idp-session-signing');
assert.equal(idp.env.find(env => env.name === 'REMOTE_ACTION_ROLE').value, 'auth-idp');
for (const name of ['EMAIL_CODE_HMAC_KEY_ACTIVE', 'EMAIL_CODE_HMAC_KEY_ACTIVE_REF', 'CM_IDENTITY_DELETION_BUDGETS_JSON']) {
  assert.deepEqual(idp.env.find(env => env.name === name), container.env.find(env => env.name === name));
}
for (const name of ['CM_IDENTITY_EMAIL_CODE_POLICY', 'CM_IDENTITY_EMAIL_CODE_POLICY_APPROVAL_REF']) {
  assert.equal(object(preprod, 'ConfigMap', 'auth-idp').data[name], config[name]);
}
assert.equal(object(prod, 'Deployment', 'auth-idp').spec.template.spec.containers[0].command[1], 'apps/auth-idp/dist/index.js');
assert.match(runtime.data['launch.mjs'], /key\.toString\('base64url'\)/);
assert.match(runtime.data['stage.mjs'], /'wx', 0o600/);
assert(!preprod.some(object => object.kind === 'Secret' && ['email-code-hmac', 'sentropic-identity-budgets'].includes(object.metadata.name)));
assert.equal(object(prod, 'ConfigMap', 'api').data.CM_IDENTITY_CUTOVER_CHECKPOINT_FILE, undefined);
assert.equal(object(prod, 'Deployment', 'api').spec.template.spec.volumes, undefined);
console.log('PASS: rendered preprod custody, real policy reference, private HMAC composition and budget wiring; prod unchanged');
await verifyRenderedSequence(preprod);
