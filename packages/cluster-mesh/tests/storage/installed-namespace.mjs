import assert from 'node:assert/strict';
import { createClusterMeshModules, createClusterMeshRuntime, createClusterMeshPlugin } from '@sentropic/cluster-mesh';
import { createCanonicalCommentsNamespaceModule } from '@sentropic/cluster-mesh/compose/comments';
import { commandIdempotencyKey } from '@sentropic/comments';

export const qualifyInstalledNamespace = async (host) => {
  const { module, scope, grant, capacity, root, bound } = host; let mismatch = false;
  const ports = { store: module.store, capabilities: { check: async () => host.authority.allowed }, resolver: { resolve: async () => 'exact' }, decisions: { resolve: async () => null } };
  const modules = createClusterMeshModules();
  assert.equal((await modules.probe()).comments.availability, 'available');
  const namespace = await createCanonicalCommentsNamespaceModule(modules, { enabled: true, generationId: 'installed-generation', module, ports, router: { capacity }, resolveGrant: async (invocation) => {
    const issued = { ...grant, token: `http:${invocation.invocationId}`, lifetime: { kind: 'invocation', invocationId: invocation.invocationId } };
    await root.bindNew(issued); return issued;
  } });
  const runtime = createClusterMeshRuntime({ generationId: 'installed-generation', config: { capacity: { poolSize: 1 } }, receipts: { append: async () => {} }, registration: { authorize: async () => ({ ok: false, reason: 'missing_registration' }) },
    context: { verify: async (input) => ({ invocationId: input.invocationId, correlationId: input.correlationId, generationId: 'installed-generation', principal: { principalId: grant.principalId, kind: 'human', verifierId: 'installed-host' }, workspace: { bindingId: 'installed-binding', workspaceId: mismatch ? 'foreign' : scope.workspaceId, revision: '1' }, scopes: ['/comments'], policyRevision: '1', issuedAt: '2026-10-17T00:00:00.000Z' }) } });
  const app = createClusterMeshPlugin({ runtime, namespaces: [namespace] });
  const post = (path, body) => app.request(`/comments${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const { kind: _kind, hash: _hash, link: _link, scope: _scope, provenance, ...fields } = host.annotation('http');
  const request = { scope, content: { ...fields, provenance: { attribution: provenance.attribution } }, expected: { kind: 'creation', aggregateVersion: 0 }, idempotencyKey: commandIdempotencyKey('installed-http'), decisionRef: '' };
  const response = await post('/annotations', request); assert.equal(response.status, 200); const record = await response.json();
  assert.deepEqual(record.provenance.registration, { principal: grant.principalId, registeredAt: 1717000000123 });
  assert.deepEqual(await (await post('/annotations', request)).json(), record);
  mismatch = true; assert.equal((await app.request('/comments/annotations/http')).status, 403); mismatch = false;
  assert.equal((await post('/annotations', { ...request, scope: { ...scope, tenantId: 'forged' } })).status, 403);
  const before = (await bound.journalRead(0, 100)).events.length;
  assert.equal((await post('/records', { kind: 'lifecycle-event', action: 'tombstone' })).status, 404);
  const lifecycle = { scope, objectKind: 'annotation', objectId: 'http', action: 'purge-outcome', archiveKind: null, reason: null, decisionRef: '', idempotencyKey: 'forged-outcome', expected: { kind: 'creation', aggregateVersion: 0 } };
  assert.equal((await post('/annotations/http/lifecycle', lifecycle)).status, 400);
  assert.equal((await bound.journalRead(0, 100)).events.length, before);
  await bound.configureLifecycle('required');
  await module.withContext(grant, async () => {
    const result = await module.services.lifecycle({ ...lifecycle, action: 'tombstone', idempotencyKey: commandIdempotencyKey('installed-delete') });
    assert.equal(typeof result.intentId, 'string');
    assert.equal((await module.services.completePurge(result.intentId)).state, 'complete');
    await assert.rejects(module.store.getAnnotationHead(scope, 'http'), (error) => error.code === 'denied');
  });
  const retained = await host.retainedBytes();
  assert.ok(!retained.some((bytes) => bytes.includes('installed content')));
  return { installedDiscovery: 'pass', fullRuntimeMount: 'pass', serverRegistration: 'pass', originalReplay: 'pass', forgedScopeAndLifecycle: 'pass', physicalErasure: 'pass' };
};
