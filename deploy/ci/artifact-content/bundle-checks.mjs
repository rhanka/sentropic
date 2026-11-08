import assert from 'node:assert/strict';

export const component = value => ({ 'app.kubernetes.io/name': 'sentropic', 'app.kubernetes.io/component': value });
export const object = (objects, kind, name) => {
  const found = objects.filter(o => o.kind === kind && o.metadata.name === name);
  assert.equal(found.length, 1, `${kind}/${name} must occur once`);
  return found[0];
};
export const closed = ['APP_ARTIFACT_HOST_ENABLED', 'APP_ARTIFACT_CONTENT_ENABLED', 'APP_ARTIFACT_READER_ENABLED'];
// GB4 preprod (owner GO 2026-11-07): supervisor relay and builder composition exist in preprod only; prod declares none.
// The relay key is the public half of the api's ARTIFACT_SUPERVISOR_SIGNING_KEY_JSON (kid sentropic-preprod-supervisor-1).
const internal = 'http://artifact-content.sentropic-preprod.svc.cluster.local:8791';
export const preprodRelay = { APP_ARTIFACT_SUPERVISOR_RELAY_ENABLED: '1',
  APP_ARTIFACT_SUPERVISOR_PUBLIC_KEYS: 'MCowBQYDK2VwAyEA9PIIB+0LkY47bMnczyWol6Swl8UeFepUjNjg+lxZFbY=',
  APP_ARTIFACT_LIVE_BUILDER_NAMESPACE: 'sentropic-artifact-builders' };
export const preprodBuilder = {
  ARTIFACT_BUILDER_ENABLED: '1', ARTIFACT_BUILDER_NAMESPACE: 'sentropic-artifact-builders',
  ARTIFACT_BUILDER_SERVICE_DOMAIN: 'sentropic-artifact-builders.svc.cluster.local', ARTIFACT_BUILDER_NODE: 'd2-4-preprod',
  ARTIFACT_SUPERVISOR_RELAY_URL: internal, ARTIFACT_LIVE_EDGE_INTERNAL_URL: internal,
  ARTIFACT_BUILDER_REMOTE_HOST_URL: 'https://preprod.immo.sent-tech.ca/api/v1/artifacts',
  ARTIFACT_BUILDER_HOST_BINDINGS_JSON: '[{"clientId":"immo-preprod-host","hostId":"immo-preprod","storageScopeId":"radar-immobilier-preprod"}]',
  GITHUB_APP_PUBLIC_BASE_URL: 'https://preprod.sentropic.sent-tech.ca',
  GITHUB_APP_TARGETS_JSON: '[{"locator":"rhanka/radar-immobilier","storageScopeId":"radar-immobilier-preprod","repoId":"radar-immobilier"}]',
  GITHUB_APP_BROKER_BINDINGS_JSON: '[{"clientId":"immo-preprod-host","storageScopeId":"radar-immobilier-preprod","repoId":"radar-immobilier"}]',
};
export const pick = (data, pattern) => Object.fromEntries(Object.entries(data ?? {}).filter(([key]) => pattern.test(key)));
export function checkActivationImage(objects) {
  const containers = ['api', 'artifact-content'].flatMap(name => object(objects, 'Deployment', name).spec.template.spec.containers);
  if (containers.some(c => c.env?.some(e => closed.includes(e.name) && e.value === '1'))) {
    for (const c of containers) assert.match(c.image, /@sha256:[0-9a-f]{64}$/, 'artifact opening requires digest-pinned API/content images');
  }
}
export function checkWorkload(objects, tier, preservedImages) {
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
  assert.equal(account.imagePullSecrets, undefined, 'public GHCR images need no pull secret');
  assert(!objects.some(o => /RoleBinding$/.test(o.kind) && o.subjects?.some(s => s.name === 'artifact-content')));
  assert.deepEqual(content.command, ['node', 'apps/artifact-content/dist/index.js']);
  assert.equal(content.workingDir, '/workspace');
  assert.deepEqual(pod.securityContext, { runAsNonRoot: true, runAsUser: 1000, runAsGroup: 1000, fsGroup: 1000, seccompProfile: { type: 'RuntimeDefault' } });
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
  // Live edge (W9): prod stays inert with placeholders; preprod arms it (GB4), still inert while content serving is closed.
  const live = tier === 'prod' ? ['0', 'pages.immo.sent-tech.ca=immo-prod-live-1', 'sentropic-prod-live-1']
    : ['1', 'pages.preprod.immo.sent-tech.ca=immo-preprod-live-1', 'sentropic-preprod-live-1'];
  assert.deepEqual([cm.data.APP_ARTIFACT_LIVE_ENABLED, cm.data.APP_ARTIFACT_LIVE_PAGES_DOMAINS, cm.data.APP_ARTIFACT_LIVE_CONTROLLER_KEY_IDS],
    live, 'live edge flag, pages domain and kids per tier');
  assert.deepEqual(pick(cm.data, /^APP_ARTIFACT_(SUPERVISOR_|LIVE_BUILDER_NAMESPACE$)/), tier === 'prod' ? {} : preprodRelay,
    'supervisor relay per tier');
  const apiData = object(objects, 'ConfigMap', 'api').data;
  assert.deepEqual(pick(apiData, /^(ARTIFACT_|GITHUB_APP_)/), tier === 'prod' ? {} : preprodBuilder,
    'builder composition and GitHub App broker configuration per tier');
  // The api creates worker pods where the relay and the live edge forward: one namespace on both sides.
  assert.equal(cm.data.APP_ARTIFACT_LIVE_BUILDER_NAMESPACE, apiData.ARTIFACT_BUILDER_NAMESPACE, 'one worker namespace for api and content');
  assert.deepEqual(content.envFrom, [{ configMapRef: { name: 'artifact-content' } }, { secretRef: { name: 'artifact-content-runtime', optional: true } }]);
  assert.deepEqual(pod.volumes, [{ name: 'signing-key', secret: { secretName: 'artifact-content-signing', optional: true, defaultMode: 288, items: [{ key: 'key', path: 'key' }] } }]);
  assert.deepEqual(content.volumeMounts, [{ name: 'signing-key', mountPath: '/var/run/artifact-content', readOnly: true }]);
  const service = object(objects, 'Service', 'artifact-content').spec;
  assert.equal(service.type, 'ClusterIP');
  assert.deepEqual(service.selector, component('artifact-content'));
  assert.deepEqual(service.ports, [{ name: 'http', port: 8791, targetPort: 'http' }]);
  const image = object(objects, 'Deployment', 'api').spec.template.spec.containers[0].image;
  if (preservedImages) {
    for (const name of ['api', 'auth-idp', 'artifact-content']) {
      assert.equal(object(objects, 'Deployment', name).spec.template.spec.containers[0].image, preservedImages[name]);
    }
  } else {
    assert.equal(content.image, image);
    assert.equal(object(objects, 'Deployment', 'auth-idp').spec.template.spec.containers[0].image, image);
  }
  // Restore/backup retains its existing own-namespace ingress; content adds no restore authority.
  const restore = object(objects, 'NetworkPolicy', 'allow-pgbackup-to-postgres').spec;
  assert.deepEqual(restore.ingress[0].from, [{ podSelector: { matchLabels: component('pgbackup') } }]);
  assert.deepEqual(restore.ingress[0].ports, [{ protocol: 'TCP', port: 5432 }]);
}
