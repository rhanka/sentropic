import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { checkWorkload, component, object } from './bundle-checks.mjs';
import { checkConnectivity } from './network.selftest.mjs';
const { parseAllDocuments } = createRequire('/tmp/content-tools/package.json')('yaml');
const load = file => parseAllDocuments(readFileSync(file, 'utf8')).map(doc => {
  assert.deepEqual(doc.errors, []); return doc.toJS();
}).filter(Boolean);
let passed = 0;
const check = (name, fn) => { fn(); passed++; console.log(`PASS: ${name}`); };
function checkRoutes(objects, tier) {
  const domain = `${tier === 'preprod' ? 'preprod.' : ''}sentropic.sent-tech.ca`;
  for (const name of ['api', 'artifact-content']) {
    assert.equal(object(objects, 'ConfigMap', name).data.APP_ARTIFACT_CONTENT_BASE_DOMAIN, domain);
  }
  const hosts = [`*.${domain}`, `*.pinned.${domain}`];
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
  const qualify = values => { checkWorkload(values, tier); checkRoutes(values, tier); checkNetwork(values); };
  check(`${tier}: closed workload, TLS routes, scoped network and restore access`, () => qualify(objects));
  check(`${tier}: one digest replacement covers API, IdP and content`, () => {
    const pinned = load(`/rendered/${tier}-pinned.yaml`);
    qualify(pinned);
    assert.equal(object(pinned, 'Deployment', 'artifact-content').spec.template.spec.containers[0].image,
      `rg.fr-par.scw.cloud/nc-reg/sentropic-api@sha256:${'a'.repeat(64)}`);
  });
  const deny = (name, mutation) => check(`${tier}: reject ${name}`, () => {
    const copy = structuredClone(objects); mutation(copy); assert.throws(() => qualify(copy));
  });
  deny('reader enabled by main deployment', o => { object(o, 'Deployment', 'api').spec.template.spec.containers[0].env.find(e => e.name === 'APP_ARTIFACT_READER_ENABLED').value = '1'; });
  deny('content flag inherited from a secret', o => { object(o, 'Deployment', 'artifact-content').spec.template.spec.containers[0].env = []; });
  deny('broad app credentials', o => { object(o, 'Deployment', 'artifact-content').spec.template.spec.containers[0].envFrom[1].secretRef.name = 'sentropic-api'; });
  deny('cross-environment PG access', o => { object(o, 'NetworkPolicy', 'artifact-content').spec.egress[1].to[0].namespaceSelector = {}; });
  deny('unrestricted object-store egress', o => { object(o, 'NetworkPolicy', 'artifact-content').spec.egress.push({}); });
  deny('missing pinned wildcard TLS', o => { object(o, 'Ingress', 'artifact-content').spec.tls[0].hosts.pop(); });
  deny('explicit certificate requiring CD write permissions', o => { o.push({ kind: 'Certificate', metadata: { name: 'unexpected', namespace: o[0].metadata.namespace } }); });
  deny('wildcard outranks exact app routes', o => { object(o, 'Ingress', 'artifact-content').metadata.annotations['traefik.ingress.kubernetes.io/router.priority'] = '999'; });
  deny('independent content image', o => { object(o, 'Deployment', 'artifact-content').spec.template.spec.containers[0].image = 'other:latest'; });
}
const combined = [...load('/rendered/prod.yaml'), ...load('/rendered/preprod.yaml')];
check('both environments: effective additive network reachability and denial matrix', () => checkConnectivity(combined));
check('reject an extra policy opening content across namespaces', () => {
  const copy = structuredClone(combined);
  copy.push({ kind: 'NetworkPolicy', metadata: { name: 'accidental-open', namespace: 'sentropic' },
    spec: { podSelector: { matchLabels: component('artifact-content') }, policyTypes: ['Ingress'], ingress: [{}] } });
  assert.throws(() => checkConnectivity(copy));
});
console.log(`${passed} PASS, 0 failures`);
