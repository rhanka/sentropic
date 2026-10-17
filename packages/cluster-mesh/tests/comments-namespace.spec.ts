import { describe, expect, it } from 'vitest';
import * as comments from '../src/comments/index.js';
import { createClusterMeshModules } from '../src/modules/registry.js';
import { createClusterMeshPlugin } from '../src/hono/plugin.js';
import { createClusterMeshRuntime } from '../src/runtime/generation.js';
import { createCanonicalCommentsNamespaceModule, createCommentsNamespaceModule } from '../src/compose/comments.js';
import { pgEnabled } from './storage/pg-driver.js';
import { commentsHost } from './storage/comments-host.js';
describe('comments namespace startup isolation', () => {
  it('does not acquire the module or call its router when disabled', async () => {
    const module = await createCommentsNamespaceModule({ load: () => { throw new Error('disabled load'); } } as never, { enabled: false, createRouter: () => { throw new Error('disabled router'); } });
    expect(module.enabled).toBe(false); expect(module.namespace).toBe('/comments');
  });
});
describe.skipIf(!pgEnabled)('canonical comments namespace invocation fence', () => {
  it('mounts through the full runtime and refuses forged body scope or mismatched verified identity', async () => {
    const h = await commentsHost(); let mismatch = false;
    try {
      const modules = { ...createClusterMeshModules(), load: async () => comments };
      const ports = { store: h.module.store, capabilities: { check: async () => true }, resolver: { resolve: async () => 'exact' as const }, decisions: { resolve: async () => null } };
      const namespace = await createCanonicalCommentsNamespaceModule(modules, { enabled: true, generationId: 'generation', module: h.module, ports, router: { capacity: h.capacity }, resolveGrant: async (invocation) => {
        const grant = { ...h.grant, token: `namespace:${invocation.invocationId}`, lifetime: { kind: 'invocation' as const, invocationId: invocation.invocationId } };
        await h.root.bindNew(grant); return grant;
      } });
      const runtime = createClusterMeshRuntime({ generationId: 'generation', config: { capacity: { poolSize: 1 } }, receipts: { append: async () => {} }, registration: { authorize: async () => ({ ok: false as const, reason: 'missing_registration' as const }) }, context: { verify: async (input) => ({ invocationId: input.invocationId, correlationId: input.correlationId, generationId: 'generation',
        principal: { principalId: h.grant.principalId, kind: 'human' as const, verifierId: 'host' }, workspace: { bindingId: 'binding', workspaceId: mismatch ? 'foreign' : h.scope.workspaceId, revision: '1' }, scopes: ['/comments'], policyRevision: '1', issuedAt: '2026-10-17T00:00:00.000Z' }) } });
      const app = createClusterMeshPlugin({ runtime, namespaces: [namespace] });
      expect((await app.request('/comments/annotations/missing')).status).toBe(404);
      mismatch = true; expect((await app.request('/comments/annotations/missing')).status).toBe(403); mismatch = false;
      const { kind: _kind, hash: _hash, link: _link, scope: _scope, provenance, ...content } = h.annotation('a');
      const request = { scope: { ...h.scope, tenantId: 'forged-tenant' }, content: { ...content, provenance: { attribution: provenance.attribution } }, expected: { kind: 'creation', aggregateVersion: 0 }, decisionRef: '', idempotencyKey: 'forged-scope' };
      expect((await app.request('/comments/annotations', { method: 'POST', body: JSON.stringify(request) })).status).toBe(403);
      expect((await h.bound.journalRead(0, 100)).events).toHaveLength(0);
    } finally { await h.fixture.close(); }
  });
});
