import assert from 'node:assert/strict';
import { component } from './bundle-checks.mjs';

// Evaluate additive policies across BOTH rendered namespaces, including accidental
// extra policies. This models the label/namespace/port subset used by these bundles.
const labelsMatch = (selector, labels) => Object.entries(selector.matchLabels ?? {})
  .every(([key, value]) => labels[key] === value) &&
  (selector.matchExpressions ?? []).every(({ key, operator }) => {
    assert.equal(operator, 'Exists', 'network qualification supports only the declared Exists expressions');
    return Object.hasOwn(labels, key);
  });
function peerMatches(peer, ownerNamespace, candidate) {
  if (peer.ipBlock) return true; // Conservatively treat new CIDR grants as reachable.
  const namespace = peer.namespaceSelector
    ? labelsMatch(peer.namespaceSelector, { 'kubernetes.io/metadata.name': candidate.namespace })
    : candidate.namespace === ownerNamespace;
  return namespace && (!peer.podSelector || labelsMatch(peer.podSelector, candidate.labels));
}
function directionAllows(objects, direction, local, remote, port, protocol) {
  const policies = objects.filter(o => o.kind === 'NetworkPolicy' && o.metadata.namespace === local.namespace &&
    labelsMatch(o.spec.podSelector, local.labels) &&
    (o.spec.policyTypes ?? ['Ingress']).includes(direction));
  if (policies.length === 0) return true;
  return policies.some(policy => (policy.spec[direction.toLowerCase()] ?? []).some(rule => {
    const peers = rule[direction === 'Ingress' ? 'from' : 'to'];
    return (!peers || peers.some(peer => peerMatches(peer, local.namespace, remote))) &&
      (!rule.ports || rule.ports.some(p => p.port === port && (p.protocol ?? 'TCP') === protocol));
  }));
}
export function checkConnectivity(objects) {
  const pod = (namespace, name) => ({ namespace, labels: component(name) });
  const reachable = (from, to, port, protocol = 'TCP') =>
    directionAllows(objects, 'Egress', from, to, port, protocol) && directionAllows(objects, 'Ingress', to, from, port, protocol);
  for (const namespace of ['sentropic', 'sentropic-preprod']) {
    const content = pod(namespace, 'artifact-content');
    const other = namespace === 'sentropic' ? 'sentropic-preprod' : 'sentropic';
    const traefik = { namespace: 'traefik', labels: { 'app.kubernetes.io/name': 'traefik' } };
    assert(reachable(content, pod(namespace, 'postgres'), 5432), 'own PostgreSQL must remain reachable');
    assert(reachable(pod(namespace, 'pgbackup'), pod(namespace, 'postgres'), 5432), 'restore ingress must survive');
    assert(reachable(traefik, content, 8791), 'platform Traefik must reach content');
    assert(!reachable({ ...traefik, namespace: other }, content, 8791), 'forged Traefik in app namespace denied');
    for (const name of ['api', 'ui', 'artifact-content', 'postgres']) {
      assert(!reachable(pod(other, name), content, 8791), 'cross-environment content ingress denied');
      assert(!reachable(content, pod(other, name), 5432), 'cross-environment content egress denied');
    }
    // Live edge (A-LIVE W9): immo's content host (radar-api reader pods) of the SAME environment
    // reaches content on its live listener; k8s and immo own the egress side in radar-immobilier*.
    const immoNs = namespace === 'sentropic' ? 'radar-immobilier' : 'radar-immobilier-preprod';
    const immoPod = (ns, name) => ({ namespace: ns, labels: { 'app.kubernetes.io/name': 'radar-immobilier', 'app.kubernetes.io/component': name } });
    const liveIngress = (from, port, protocol = 'TCP') => directionAllows(objects, 'Ingress', content, from, port, protocol);
    assert(liveIngress(immoPod(immoNs, 'api'), 8791), 'same-environment immo content host must reach the live edge');
    assert(!liveIngress(immoPod(immoNs, 'api'), 8791, 'UDP'), 'live edge is TCP only');
    for (const port of [5173, 8787, 3000]) assert(!liveIngress(immoPod(immoNs, 'api'), port), 'live edge opens only the content port');
    for (const name of ['ui', 'mcp', 'postgres', 'content-deny']) {
      assert(!liveIngress(immoPod(immoNs, name), 8791), 'other immo pods stay denied');
    }
    for (const ns of [namespace === 'sentropic' ? 'radar-immobilier-preprod' : 'radar-immobilier', 'radar-immobilier-refresh-test', namespace, other]) {
      assert(!liveIngress(immoPod(ns, 'api'), 8791), 'cross-environment live edge denied');
    }
    assert(!reachable(content, pod(namespace, 'api'), 8787), 'content cannot call privileged API');
    const builder = { namespace: 'sentropic-artifact-builders', labels: { 'sentropic.dev/artifact-binding': 'qualified-binding' } };
    assert(reachable(content, builder, 5173), 'content must reach a labeled builder on its live port');
    assert(!reachable(content, { ...builder, labels: {} }, 5173), 'unlabeled builder pods remain denied');
    assert(!reachable(content, { ...builder, namespace: other }, 5173), 'binding labels in another namespace remain denied');
    assert(!reachable(content, builder, 8787), 'other builder ports remain denied');
    assert(!reachable(content, builder, 5173, 'UDP'), 'builder live egress is TCP only');
    assert(!reachable(content, { namespace: 'external', labels: {} }, 443), 'object egress awaits tenant receipt');
    const dns = { namespace: 'kube-system', labels: { 'k8s-app': 'kube-dns' } };
    for (const protocol of ['TCP', 'UDP']) assert(reachable(content, dns, 53, protocol));
    // Live controller (A-LIVE W2): Sentropic owns the API side of API -> npm relay :4873 and
    // API -> Kubernetes API; k8s owns the relay ingress. The app namespaces carry an ingress-only
    // default-deny, so any API Egress policy isolates the API and must keep every path below.
    const api = pod(namespace, 'api');
    const apiEgress = (to, port, protocol = 'TCP') => directionAllows(objects, 'Egress', api, to, port, protocol);
    const relay = { namespace: 'npm-relay', labels: { 'app.kubernetes.io/name': 'npm-relay' } };
    assert(apiEgress(relay, 4873), 'controller must reach the npm relay');
    for (const port of [443, 6443]) assert(apiEgress({ namespace: 'external', labels: {} }, port), 'controller must reach the Kubernetes API and HTTPS providers');
    for (const protocol of ['TCP', 'UDP']) assert(apiEgress(dns, 53, protocol), 'API must keep DNS');
    assert(reachable(api, pod(namespace, 'postgres'), 5432), 'API must keep its PostgreSQL');
    assert(reachable(api, pod(namespace, 'auth-idp'), 8787), 'API must keep the IdP revocation path');
    // SG4b handoff: the builder calls the same-environment immo host (immo.sent-tech.ca or
    // preprod.immo.sent-tech.ca) on TCP 443 through the platform Traefik LoadBalancer. In-cluster,
    // kube-proxy short-circuits the LB address to the Traefik pods' websecure port 8443, so both hops count.
    assert(apiEgress({ namespace: 'external', labels: {} }, 443), 'SG4b handoff must reach the immo ingress LB on 443');
    assert(reachable(api, traefik, 8443), 'SG4b handoff must reach the in-cluster immo ingress (Traefik websecure 8443)');
  }
}
// The operator-owned default-deny is not rendered here; no rendered policy may widen it to a whole
// namespace or to unnamed peers.
export function checkNoOpenPolicy(objects) {
  for (const { metadata, spec } of objects.filter(o => o.kind === 'NetworkPolicy')) {
    const selector = spec.podSelector ?? {};
    assert(Object.keys(selector.matchLabels ?? {}).length + (selector.matchExpressions ?? []).length > 0,
      `${metadata.name}: namespace-wide pod selector`);
    for (const [direction, peers] of [['ingress', 'from'], ['egress', 'to']]) {
      for (const rule of spec[direction] ?? []) assert((rule[peers] ?? []).length > 0, `${metadata.name}: ${direction} rule without peers`);
    }
  }
}
