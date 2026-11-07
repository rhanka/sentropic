import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { checkActivationImage, checkWorkload, closed, component, object } from './bundle-checks.mjs';
import { checkConnectivity, checkNoOpenPolicy } from './network.selftest.mjs';
import { checkReservedHosts } from './routing.selftest.mjs';
const { parseAllDocuments } = createRequire('/tmp/content-tools/package.json')('yaml');
const load = file => parseAllDocuments(readFileSync(file, 'utf8')).map(doc => {
  assert.deepEqual(doc.errors, []); return doc.toJS();
}).filter(Boolean);
let passed = 0;
const check = (name, fn) => { fn(); passed++; console.log(`PASS: ${name}`); };
// Remove these preservation expectations at the A4 prod cutover.
const prodPins = {
  api: 'ghcr.io/rhanka/sentropic-api@sha256:4bfa71ce7e231a9ed752e4aaceb23129a3399540af4720e32e76782c3f798c05',
  'auth-idp': 'ghcr.io/rhanka/sentropic-api@sha256:4b78a02fc743ae85ce9f5819d5ebc6b49e02fca7b3161a87ea06afa401a3dc34',
  'artifact-content': 'ghcr.io/rhanka/sentropic-api@sha256:4bfa71ce7e231a9ed752e4aaceb23129a3399540af4720e32e76782c3f798c05',
  ui: 'ghcr.io/rhanka/sentropic-ui@sha256:1f33dd0cde7733d2061f02ab1a5a14eb1a6276ce99001c697f5c697e2c0c9d4e',
};
const checkProdPins = objects => {
  for (const [name, expected] of Object.entries(prodPins)) {
    const containers = object(objects, 'Deployment', name).spec.template.spec.containers;
    assert.equal(containers.length, 1);
    assert.equal(containers[0].name, name);
    assert.doesNotMatch(containers[0].image, /:main(?:@|$)/);
    assert.equal(containers[0].image, expected, `${name} must retain its live production digest without a mutable tag`);
  }
};
const prod = load('/rendered/prod.yaml');
const allContainers = value => {
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, child]) =>
    ['containers', 'initContainers', 'ephemeralContainers'].includes(key) ? child : allContainers(child));
};
const checkImmutableImages = objects => {
  const containers = allContainers(objects);
  assert(containers.length > 0, 'prod must contain workloads');
  for (const c of containers) assert.match(c.image, /@sha256:[a-f0-9]{64}$/, `${c.name} must use an immutable image`);
};
check('prod: the entire rendered overlay uses immutable images', () => checkImmutableImages(prod));
for (const [index, c] of allContainers(prod).entries()) for (const image of ['repo:main', 'repo:latest', 'repo:abcdef', 'repo']) {
  check(`prod: reject mutable ${c.name} image ${image}`, () => {
    const changed = structuredClone(prod);
    allContainers(changed)[index].image = image;
    assert.throws(() => checkImmutableImages(changed), /must use an immutable image/);
  });
}
check('prod: export uses the preserved API image and postgres keeps its live digest', () => {
  assert.equal(object(prod, 'CronJob', 'sentropic-idp-identity-export').spec.jobTemplate.spec.template.spec
    .initContainers.find(c => c.name === 'export-replica').image, prodPins.api);
  assert.equal(object(prod, 'StatefulSet', 'postgres').spec.template.spec.containers[0].image,
    'postgres@sha256:266d3c257594e195b309ae9d1805e54c788f1d7b375f56bf6c367aac6c917e7b');
});
check('prod: API, IdP and UI retain their live GHCR digests without mutable tags', () => checkProdPins(prod));
for (const name of Object.keys(prodPins)) for (const tag of ['main', 'latest', 'abcdef', 'prod-20261106']) {
  check(`prod: reject ${name}:${tag}`, () => {
    const changed = structuredClone(prod);
    object(changed, 'Deployment', name).spec.template.spec.containers[0].image = `${prodPins[name].split('@')[0]}:${tag}`;
    assert.throws(() => checkProdPins(changed));
  });
}
for (const tier of ['prod', 'preprod']) check(`${tier}: public workloads need no registry pull secret`, () => {
  assert.doesNotMatch(readFileSync(`/rendered/${tier}.yaml`, 'utf8'), /imagePullSecrets|sentropic-registry/);
  if (tier === 'preprod') assert.equal(object(load(`/rendered/${tier}.yaml`), 'StatefulSet', 'postgres').spec.template.spec.containers[0].image, 'postgres:17-alpine');
});
function checkRoutes(objects, tier) {
  const domain = `${tier === 'preprod' ? 'preprod.' : ''}sentropic.sent-tech.ca`;
  for (const name of ['api', 'artifact-content']) {
    assert.equal(object(objects, 'ConfigMap', name).data.APP_ARTIFACT_CONTENT_BASE_DOMAIN, domain);
  }
  const hosts = [`*.${domain}`];
  const ingress = object(objects, 'Ingress', 'artifact-content');
  assert.equal(ingress.spec.ingressClassName, 'traefik');
  assert.deepEqual(ingress.metadata.annotations, {
    'cert-manager.io/cluster-issuer': 'letsencrypt-prod',
    'cert-manager.io/private-key-rotation-policy': 'Always',
    'traefik.ingress.kubernetes.io/router.entrypoints': 'websecure',
    'traefik.ingress.kubernetes.io/router.tls': 'true',
    // Exact app/preprod/IdP routes must outrank the content wildcard.
    'traefik.ingress.kubernetes.io/router.priority': '1',
  });
  assert.deepEqual(ingress.spec.tls, [{ hosts, secretName: 'artifact-content-tls' }]);
  assert.deepEqual(ingress.spec.rules, hosts.map(host => ({ host, http: { paths: [{ path: '/', pathType: 'Prefix',
    backend: { service: { name: 'artifact-content', port: { name: 'http' } } } }] } })));
  assert(!objects.some(o => o.kind === 'Certificate'), 'CD overlays must delegate certificate writes to ingress-shim');
  assert.equal(object(objects, 'Ingress', 'sentropic').spec.rules[0].host, domain);
  assert.equal(object(objects, 'Ingress', 'sentropic').spec.rules[0].http.paths[0].backend.service.name, 'ui');
}
function checkNetwork(objects) {
  const network = object(objects, 'NetworkPolicy', 'artifact-content').spec;
  assert.deepEqual(network, {
    podSelector: { matchLabels: component('artifact-content') }, policyTypes: ['Ingress', 'Egress'],
    ingress: [{ from: [{ namespaceSelector: { matchLabels: { 'kubernetes.io/metadata.name': 'traefik' } },
      podSelector: { matchLabels: { 'app.kubernetes.io/name': 'traefik' } } }], ports: [{ protocol: 'TCP', port: 8791 }] }],
    egress: [
      { to: [{ namespaceSelector: { matchLabels: { 'kubernetes.io/metadata.name': 'sentropic-artifact-builders' } },
        podSelector: { matchExpressions: [{ key: 'sentropic.dev/artifact-binding', operator: 'Exists' }] } }],
        ports: [{ protocol: 'TCP', port: 5173 }] },
      { to: [{ namespaceSelector: { matchLabels: { 'kubernetes.io/metadata.name': 'kube-system' } },
        podSelector: { matchLabels: { 'k8s-app': 'kube-dns' } } }], ports: [{ protocol: 'UDP', port: 53 }, { protocol: 'TCP', port: 53 }] },
      { to: [{ podSelector: { matchLabels: component('postgres') } }], ports: [{ protocol: 'TCP', port: 5432 }] },
    ],
  });
  const pg = object(objects, 'NetworkPolicy', 'allow-artifact-content-to-postgres').spec;
  assert.deepEqual(pg, { podSelector: { matchLabels: component('postgres') }, policyTypes: ['Ingress'],
    ingress: [{ from: [{ podSelector: { matchLabels: component('artifact-content') } }], ports: [{ protocol: 'TCP', port: 5432 }] }] });
}
for (const tier of ['prod', 'preprod']) {
  const objects = load(`/rendered/${tier}.yaml`);
  check(`${tier}: real host parser denies reserved wildcard labels`, () => checkReservedHosts(objects));
  const preservedImages = tier === 'prod' ? prodPins : undefined;
  const qualify = (values, images = preservedImages) => { checkWorkload(values, tier, images); checkRoutes(values, tier); checkNetwork(values); };
  check(`${tier}: closed workload, TLS routes, scoped network and restore access`, () => qualify(objects));
  check(`${tier}: one digest replacement covers API, IdP and content`, () => {
    const pinned = load(`/rendered/${tier}-pinned.yaml`);
    qualify(pinned, null);
    assert.equal(object(pinned, 'Deployment', 'artifact-content').spec.template.spec.containers[0].image,
      `ghcr.io/rhanka/sentropic-api@sha256:${'a'.repeat(64)}`);
  });
  for (const workload of ['api', 'artifact-content']) for (const flag of closed) {
    const enable = values => {
      object(values, 'Deployment', workload).spec.template.spec.containers[0].env.find(e => e.name === flag).value = '1';
      return values;
    };
    check(`${tier}: reject ${workload} ${flag}=1 on a tag`, () => {
      const tagged = enable(structuredClone(objects));
      object(tagged, 'Deployment', workload).spec.template.spec.containers[0].image = 'ghcr.io/rhanka/sentropic-api:unqualified';
      assert.throws(() => checkActivationImage(tagged), /opening requires digest-pinned/);
    });
    check(`${tier}: digest prerequisite accepts ${workload} ${flag}=1`, () => {
      const pinned = enable(load(`/rendered/${tier}-pinned.yaml`));
      checkActivationImage(pinned);
      for (const image of ['other@sha256:abc', `other@sha256:${'a'.repeat(64)}:tag`]) {
        object(pinned, 'Deployment', 'artifact-content').spec.template.spec.containers[0].image = image;
        assert.throws(() => checkActivationImage(pinned), /opening requires digest-pinned/);
      }
    });
  }
  const deny = (name, mutation) => check(`${tier}: reject ${name}`, () => {
    const copy = structuredClone(objects); mutation(copy); assert.throws(() => qualify(copy));
  });
  deny('reader enabled by main deployment', o => { object(o, 'Deployment', 'api').spec.template.spec.containers[0].env.find(e => e.name === 'APP_ARTIFACT_READER_ENABLED').value = '1'; });
  deny('content flag inherited from a secret', o => { object(o, 'Deployment', 'artifact-content').spec.template.spec.containers[0].env = []; });
  deny('broad app credentials', o => { object(o, 'Deployment', 'artifact-content').spec.template.spec.containers[0].envFrom[1].secretRef.name = 'sentropic-api'; });
  deny('cross-environment PG access', o => {
    object(o, 'NetworkPolicy', 'artifact-content').spec.egress.find(rule => rule.ports.some(p => p.port === 5432)).to[0].namespaceSelector = {};
  });
  deny('builder egress without namespace isolation', o => { delete object(o, 'NetworkPolicy', 'artifact-content').spec.egress[0].to[0].namespaceSelector; });
  deny('builder egress without binding isolation', o => { delete object(o, 'NetworkPolicy', 'artifact-content').spec.egress[0].to[0].podSelector; });
  deny('builder egress on another port', o => { object(o, 'NetworkPolicy', 'artifact-content').spec.egress[0].ports[0].port = 8787; });
  deny('unrestricted object-store egress', o => { object(o, 'NetworkPolicy', 'artifact-content').spec.egress.push({}); });
  deny('missing content wildcard TLS', o => { object(o, 'Ingress', 'artifact-content').spec.tls[0].hosts.pop(); });
  deny('second pinned wildcard host', o => {
    const d = object(o, 'ConfigMap', 'artifact-content').data.APP_ARTIFACT_CONTENT_BASE_DOMAIN;
    object(o, 'Ingress', 'artifact-content').spec.tls[0].hosts.push(`*.pinned.${d}`);
  });
  deny('explicit certificate requiring CD write permissions', o => { o.push({ kind: 'Certificate', metadata: { name: 'unexpected', namespace: o[0].metadata.namespace } }); });
  deny('wildcard outranks exact app routes', o => { object(o, 'Ingress', 'artifact-content').metadata.annotations['traefik.ingress.kubernetes.io/router.priority'] = '999'; });
  deny('independent content image', o => { object(o, 'Deployment', 'artifact-content').spec.template.spec.containers[0].image = 'other:latest'; });
  deny('world-readable signing key', o => { object(o, 'Deployment', 'artifact-content').spec.template.spec.volumes[0].secret.defaultMode = 292; });
  deny('missing signing-key group access', o => { delete object(o, 'Deployment', 'artifact-content').spec.template.spec.securityContext.fsGroup; });
}
const combined = [...load('/rendered/prod.yaml'), ...load('/rendered/preprod.yaml')];
check('both environments: effective additive network reachability and denial matrix', () => checkConnectivity(combined));
check('reject an extra policy opening content across namespaces', () => {
  const copy = structuredClone(combined);
  copy.push({ kind: 'NetworkPolicy', metadata: { name: 'accidental-open', namespace: 'sentropic' },
    spec: { podSelector: { matchLabels: component('artifact-content') }, policyTypes: ['Ingress'], ingress: [{}] } });
  assert.throws(() => checkConnectivity(copy));
});
check('both environments: no rendered policy widens the default-deny', () => checkNoOpenPolicy(combined));
check('reject an allow-all rule beside the default-deny', () => {
  const copy = structuredClone(combined);
  copy.find(o => o.kind === 'NetworkPolicy' && o.metadata.name === 'allow-ui-to-api').spec.ingress
    .push({ ports: [{ protocol: 'TCP', port: 8787 }] });
  assert.throws(() => checkNoOpenPolicy(copy), /without peers/);
});
const relayRule = { to: [{ namespaceSelector: { matchLabels: { 'kubernetes.io/metadata.name': 'npm-relay' } },
  podSelector: { matchLabels: { 'app.kubernetes.io/name': 'npm-relay' } } }], ports: [{ protocol: 'TCP', port: 4873 }] };
const httpsRule = { to: [{ ipBlock: { cidr: '0.0.0.0/0' } }], ports: [{ protocol: 'TCP', port: 443 }, { protocol: 'TCP', port: 6443 }] };
for (const [name, egress, error] of [
  ['relay and Kubernetes API only, isolating the API', [relayRule, httpsRule], /DNS|PostgreSQL/],
  ['an API allowlist without the relay', [httpsRule, { to: [{ podSelector: { matchLabels: component('postgres') } }] },
    { to: [{ podSelector: { matchLabels: component('auth-idp') } }] },
    { to: [{ namespaceSelector: {}, podSelector: { matchLabels: { 'k8s-app': 'kube-dns' } } }] }], /npm relay/],
]) check(`reject an API egress policy with ${name}`, () => {
  const copy = structuredClone(combined);
  copy.push({ kind: 'NetworkPolicy', metadata: { name: 'api-egress', namespace: 'sentropic-preprod' },
    spec: { podSelector: { matchLabels: component('api') }, policyTypes: ['Egress'], egress } });
  assert.throws(() => checkConnectivity(copy), error);
});
console.log(`${passed} PASS, 0 failures`);
