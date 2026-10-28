import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { createCatalogTransportRouter } from '../../src/routes/namespaces/catalog';
import { createCatalogDiscovery } from '../../src/routes/namespaces/catalog-product-ports';
import { CompositeCatalogRegistry } from '../../src/services/catalog/composite-registry';
import { createCatalogContextResolver } from '../../src/services/catalog/request-context';
import type { ToolEntry } from '../../src/services/catalog/types';

describe('mounted HTTP catalog request authority', () => {
  it('should isolate concurrent users on all discovery paths and refuse missing authority', async () => {
    const entry = (name: string): ToolEntry => ({ kind: 'tool', sourceId: 'private',
      metadata: { name, description: `private ${name}` },
      tool: { name, description: name, inputSchema: {}, sideEffect: false } });
    const registry = new CompositeCatalogRegistry().addSource({ id: 'private', kind: 'static',
      requiresContext: true, snapshot: () => [entry('alice_tool'), entry('bob_tool')] });
    let revoked = false;
    const resolve = createCatalogContextResolver(async input => {
      if (revoked) throw new Error('revoked');
      return { tenantId: `tenant-${input.userId}`, membershipRef: 'member', consentRef: 'first-party',
        policyVersion: 'v1', readOnly: false, allowedTools: [`${input.userId}_tool`] };
    });
    const app = new Hono().route('/api/v1', createCatalogTransportRouter({
      catalog: createCatalogDiscovery(registry),
      authenticate: async (c, next) => c.req.header('authorization') ? next() : c.json({ error: 'unauthorized' }, 401),
      resolveContext: c => resolve({ kind: 'http', userId: c.req.header('authorization')!,
        sessionId: 'server-session', workspaceId: 'server-workspace' }),
    }));
    const get = (path: string, user: string) => app.request(`/api/v1/catalog/${path}`, {
      headers: { authorization: user },
    });
    const [alice, bob] = await Promise.all([get('search?query=private&limit=1&subjectId=bob', 'alice'),
      get('entries?userId=alice', 'bob')]);
    expect(JSON.stringify(await alice.json())).toContain('alice_tool');
    expect(JSON.stringify(await bob.json())).not.toContain('alice_tool');
    expect((await get('entries/bob_tool', 'alice')).status).toBe(404);
    expect(await (await get('sources', 'alice')).json()).toEqual({ items: [{ id: 'private', kind: 'static' }] });
    for (const path of ['entries', 'entries/alice_tool', 'search?query=private', 'sources']) {
      expect((await app.request(`/api/v1/catalog/${path}`)).status).toBe(401);
    }
    revoked = true;
    for (const path of ['entries', 'entries/alice_tool', 'search?query=private', 'sources']) {
      const response = await get(path, 'alice');
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: 'catalog_access_denied' });
    }
  });
});
