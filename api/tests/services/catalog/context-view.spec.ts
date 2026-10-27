import { describe, expect, it } from 'vitest';
import { CompositeCatalogRegistry } from '../../../src/services/catalog/composite-registry';
import { createCatalogContextResolver } from '../../../src/services/catalog/request-context';
import type { CatalogEntry } from '../../../src/services/catalog/types';

const tool = (name: string): CatalogEntry => ({ kind: 'tool', sourceId: 'private',
  metadata: { name, description: `private ${name}` },
  tool: { name, description: name, inputSchema: {}, sideEffect: false } });
const resolve = createCatalogContextResolver(async input => ({ tenantId: `tenant-${input.userId}`,
  membershipRef: 'membership', consentRef: 'consent', policyVersion: 'v1', readOnly: false,
  allowedTools: [input.userId === 'alice' ? 'alice_tool' : 'bob_tool'] }));

describe('request-local catalog views', () => {
  it('should filter names, sources and ranking before serialization for interleaved users', async () => {
    const registry = new CompositeCatalogRegistry().addSource({ id: 'private', kind: 'static',
      requiresContext: true, snapshot: () => [tool('alice_tool'), tool('bob_tool')] });
    const alice = await resolve({ kind: 'http', userId: 'alice', sessionId: 'a', workspaceId: 'wa' });
    const bob = await resolve({ kind: 'http', userId: 'bob', sessionId: 'b', workspaceId: 'wb' });
    expect(registry.list()).toEqual([]);
    expect(registry.getSources()).toEqual([]);
    expect(registry.search('private', { topK: 1 }, alice).map(hit => hit.entry.metadata.name)).toEqual(['alice_tool']);
    expect(registry.list(bob).map(entry => entry.metadata.name)).toEqual(['bob_tool']);
    expect(registry.get('bob_tool', alice)).toBeNull();
    expect(registry.getSources(alice).map(source => source.id)).toEqual(['private']);
    expect(registry.list({ ...alice })).toEqual([]);
    expect(registry.list(alice).map(entry => entry.metadata.name)).toEqual(['alice_tool']);
  });

  it('should omit denied sources and read-only mutations without changing a shared snapshot', async () => {
    const entry = tool('alice_tool');
    const mutation = { ...entry, tool: { ...entry.tool, sideEffect: true } };
    const registry = new CompositeCatalogRegistry().addSource({ id: 'private', kind: 'static',
      requiresContext: true, snapshot: () => [mutation] });
    const alice = await resolve({ kind: 'http', userId: 'alice', sessionId: 'a', workspaceId: 'wa', readOnly: true });
    expect(registry.list(alice)).toEqual([]);
    expect(registry.getSources(alice)).toEqual([]);
    expect(mutation.tool.sideEffect).toBe(true);
  });
});
