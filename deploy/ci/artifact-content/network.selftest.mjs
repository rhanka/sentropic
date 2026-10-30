import assert from 'node:assert/strict';
import { component } from './bundle-checks.mjs';

// Evaluate additive policies across BOTH rendered namespaces, including accidental
// extra policies. This models the label/namespace/port subset used by these bundles.
const labelsMatch = (selector, labels) => Object.entries(selector.matchLabels ?? {})
  .every(([key, value]) => labels[key] === value);
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
    assert(!reachable(content, pod(namespace, 'api'), 8787), 'content cannot call privileged API');
    assert(!reachable(content, { namespace: 'external', labels: {} }, 443), 'object egress awaits tenant receipt');
    const dns = { namespace: 'kube-system', labels: { 'k8s-app': 'kube-dns' } };
    for (const protocol of ['TCP', 'UDP']) assert(reachable(content, dns, 53, protocol));
  }
}
