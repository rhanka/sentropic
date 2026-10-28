import assert from 'node:assert/strict';

export const component = value => ({ 'app.kubernetes.io/name': 'sentropic', 'app.kubernetes.io/component': value });
export const object = (objects, kind, name) => {
  const found = objects.filter(o => o.kind === kind && o.metadata.name === name);
  assert.equal(found.length, 1, `${kind}/${name} must occur once`);
  return found[0];
};
export const closed = ['APP_ARTIFACT_HOST_ENABLED', 'APP_ARTIFACT_CONTENT_ENABLED', 'APP_ARTIFACT_READER_ENABLED'];
export function checkActivationImage(objects) {
  const containers = ['api', 'artifact-content'].flatMap(name => object(objects, 'Deployment', name).spec.template.spec.containers);
  if (containers.some(c => c.env?.some(e => closed.includes(e.name) && e.value === '1'))) {
    for (const c of containers) assert.match(c.image, /@sha256:[0-9a-f]{64}$/, 'artifact opening requires digest-pinned API/content images');
  }
}
export function checkWorkload(objects, tier) {
  checkActivationImage(objects);
  const ns = tier === 'prod' ? 'sentropic' : 'sentropic-preprod';
  for (const o of objects) assert.equal(o.metadata.namespace, ns, `${o.kind}/${o.metadata.name} namespace`);
  const pod = object(objects, 'Deployment', 'artifact-content').spec.template.spec;
  const content = pod.containers[0];
  assert.equal(pod.containers.length, 1);
  assert.equal(pod.initContainers, undefined);
  assert.equal(pod.enableServiceLinks, false);
  assert.equal(pod.automountServiceAccountToken, false);
  assert.equal(pod.serviceAccountName, 'artifact-content');
  const account = object(objects, 'ServiceAccount', 'artifact-content');
  assert.equal(account.automountServiceAccountToken, false);
  assert.deepEqual(account.imagePullSecrets, [{ name: 'sentropic-registry' }]);
  assert(!objects.some(o => /RoleBinding$/.test(o.kind) && o.subjects?.some(s => s.name === 'artifact-content')));
  assert.deepEqual(content.command, ['node', 'apps/artifact-content/dist/index.js']);
  assert.equal(content.workingDir, '/workspace');
  assert.deepEqual(pod.securityContext, { runAsNonRoot: true, runAsUser: 1000, runAsGroup: 1000, seccompProfile: { type: 'RuntimeDefault' } });
  assert.deepEqual(content.securityContext, { allowPrivilegeEscalation: false, readOnlyRootFilesystem: true, capabilities: { drop: ['ALL'] } });
  assert(content.resources.requests.cpu && content.resources.requests.memory && content.resources.limits.cpu && content.resources.limits.memory);
  for (const probe of ['startupProbe', 'readinessProbe', 'livenessProbe']) {
    assert.equal(content[probe].httpGet.path, '/healthz');
    assert.equal(content[probe].httpGet.port, 'http');
  }
  assert.deepEqual(content.ports, [{ name: 'http', containerPort: 8791 }]);
  const cm = object(objects, 'ConfigMap', 'artifact-content');
  assert.equal(cm.data.ARTIFACT_CONTENT_PORT, '8791');
  assert.equal(cm.data.APP_ARTIFACT_CONTENT_SIGNING_KEY_FILE, '/var/run/artifact-content/key');
  for (const name of closed) {
    assert.equal(cm.data[name], '0');
    for (const c of [content, object(objects, 'Deployment', 'api').spec.template.spec.containers[0]]) {
      assert.deepEqual(c.env.find(e => e.name === name), { name, value: '0' }, `explicit ${name} overrides envFrom secrets`);
    }
  }
  assert.deepEqual(content.envFrom, [{ configMapRef: { name: 'artifact-content' } }, { secretRef: { name: 'artifact-content-runtime', optional: true } }]);
  assert.deepEqual(pod.volumes, [{ name: 'signing-key', secret: { secretName: 'artifact-content-signing', optional: true, defaultMode: 292, items: [{ key: 'key', path: 'key' }] } }]);
  assert.deepEqual(content.volumeMounts, [{ name: 'signing-key', mountPath: '/var/run/artifact-content', readOnly: true }]);
  const service = object(objects, 'Service', 'artifact-content').spec;
  assert.equal(service.type, 'ClusterIP');
  assert.deepEqual(service.selector, component('artifact-content'));
  assert.deepEqual(service.ports, [{ name: 'http', port: 8791, targetPort: 'http' }]);
  const image = object(objects, 'Deployment', 'api').spec.template.spec.containers[0].image;
  assert.equal(content.image, image);
  assert.equal(object(objects, 'Deployment', 'auth-idp').spec.template.spec.containers[0].image, image);
  // Restore/backup retains its existing own-namespace ingress; content adds no restore authority.
  const restore = object(objects, 'NetworkPolicy', 'allow-pgbackup-to-postgres').spec;
  assert.deepEqual(restore.ingress[0].from, [{ podSelector: { matchLabels: component('pgbackup') } }]);
  assert.deepEqual(restore.ingress[0].ports, [{ protocol: 'TCP', port: 5432 }]);
}
