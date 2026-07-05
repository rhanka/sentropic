/**
 * resource-plane.test.ts — BR-70 / ARCH-21a Lot 1.
 *
 * Covers the ref form, the provider-base typed `unsupported`, the dispatcher
 * (lazy root ls + scope server-verification + routing), and the
 * CatalogResourceProvider (per-(kind,sourceId) projection that does NOT dedupe
 * across kinds, list pagination, read etag/provenance/byte-budget, stat, grep
 * delegation, edit-denied, authz deny-as-missing).
 */
import { describe, it, expect } from 'vitest';

import { formatRef, parseRef, refIdentityEquals } from '../../src/services/resource-plane/ref';
import { ResourceError, type ResourcePrincipal } from '../../src/services/resource-plane/contract';
import { ResourceProviderBase } from '../../src/services/resource-plane/provider-base';
import { ResourceDispatcher } from '../../src/services/resource-plane/dispatcher';
import { CatalogResourceProvider } from '../../src/services/resource-plane/providers/catalog-provider';
import { CompositeCatalogRegistry } from '../../src/services/catalog/composite-registry';
import type { CatalogEntry, CatalogEntryKind } from '../../src/services/catalog/types';
import type { CatalogSource } from '../../src/services/catalog/source';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const SCOPE = { tenantId: 't1', workspaceId: 'w1' };

function principal(ctx: Record<string, unknown> = {}): ResourcePrincipal {
  return {
    scope: SCOPE,
    context: { workspaceType: 'general', roles: [], permissions: [], permissionMode: 'open', allowedTools: [], ...ctx },
  };
}

function makeEntry(
  kind: CatalogEntryKind,
  sourceId: string,
  name: string,
  metaExtra: Record<string, unknown> = {}
): CatalogEntry {
  const metadata = { name, description: `description of ${name}`, version: '1.0.0', category: 'test', ...metaExtra };
  switch (kind) {
    case 'canvas':
      return { kind, sourceId, metadata, template: { id: name, title: name, mimeType: 'text/markdown' } } as CatalogEntry;
    case 'tool':
      return { kind, sourceId, metadata, tool: { name, description: '', inputSchema: {} } } as CatalogEntry;
    case 'skill':
      return { kind, sourceId, metadata, skill: { metadata, tools: [{ name, description: '', inputSchema: {} }] } } as CatalogEntry;
    case 'agent':
      return { kind, sourceId, metadata, template: { name } } as CatalogEntry;
    case 'workflow':
      return { kind, sourceId, metadata, workflow: { name } } as CatalogEntry;
  }
}

function fakeSource(id: string, entries: CatalogEntry[]): CatalogSource {
  return { id, kind: 'static', snapshot: () => entries };
}

function registryWith(...entries: CatalogEntry[]): CompositeCatalogRegistry {
  const reg = new CompositeCatalogRegistry();
  reg.addSource(fakeSource('foundation', entries));
  return reg;
}

function catalogProvider(reg: CompositeCatalogRegistry): CatalogResourceProvider {
  return new CatalogResourceProvider(reg);
}

const colRef = (provider: CatalogResourceProvider, mount: string) => provider.collectionRef(mount, SCOPE)!;

// ---------------------------------------------------------------------------
// ref
// ---------------------------------------------------------------------------

describe('ResourceRef', () => {
  it('round-trips through res:// uri (id with special chars preserved)', () => {
    const ref = { provider: 'mcp:srv', scope: SCOPE, type: 'resource', id: 'file:///a/b c.txt' };
    const parsed = parseRef(formatRef(ref), SCOPE);
    expect(parsed.provider).toBe('mcp:srv');
    expect(parsed.type).toBe('resource');
    expect(parsed.id).toBe('file:///a/b c.txt');
  });

  it('compares identity on provider/type/id, ignoring scope/etag', () => {
    const a = { provider: 'catalog', scope: SCOPE, type: 'tool', id: 'x', etag: '1' };
    const b = { provider: 'catalog', scope: { tenantId: 'other' }, type: 'tool', id: 'x', etag: '2' };
    expect(refIdentityEquals(a, b)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// provider base
// ---------------------------------------------------------------------------

class BareProvider extends ResourceProviderBase {
  readonly provider = 'bare';
  readonly mounts = ['bare'];
}

describe('ResourceProviderBase', () => {
  it('defaults every verb to a typed unsupported rejection', async () => {
    const p = new BareProvider();
    const ref = { provider: 'bare', scope: SCOPE, type: 'x', id: 'y' };
    await expect(p.list(ref, {}, principal())).rejects.toMatchObject({ code: 'unsupported' });
    await expect(p.invoke(ref, { args: {} }, principal())).rejects.toBeInstanceOf(ResourceError);
    expect(await p.resolvePath(['bare'], principal())).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// dispatcher
// ---------------------------------------------------------------------------

describe('ResourceDispatcher', () => {
  it('lists root mounts from cache without fanning out', () => {
    const provider = catalogProvider(registryWith(makeEntry('tool', 'foundation', 'a')));
    const d = new ResourceDispatcher().registerProvider(provider);
    const root = d.listRoot(principal());
    expect(root.entries.map((e) => e.name).sort()).toEqual(['agents', 'canvas', 'skills', 'tools', 'workflows']);
    expect(root.entries.every((e) => e.nodeType === 'dir')).toBe(true);
  });

  it('routes by ref.provider and rejects unknown providers', async () => {
    const d = new ResourceDispatcher().registerProvider(catalogProvider(registryWith()));
    await expect(
      d.read({ provider: 'ghost', scope: SCOPE, type: 'x', id: 'y' }, {}, principal())
    ).rejects.toMatchObject({ code: 'provider_unavailable' });
  });

  it('server-verifies scope: principal scope replaces caller-supplied ref.scope', async () => {
    const provider = catalogProvider(registryWith(makeEntry('tool', 'foundation', 'a')));
    const d = new ResourceDispatcher().registerProvider(provider);
    const evilRef = { provider: 'catalog', scope: { tenantId: 'EVIL' }, type: 'tool', id: 'tool:foundation:a' };
    const res = await d.read(evilRef, {}, principal());
    expect(res.ref.scope).toEqual(SCOPE);
  });

  it('resolves path aliases to canonical refs', async () => {
    const provider = catalogProvider(registryWith(makeEntry('skill', 'foundation', 'planner')));
    const d = new ResourceDispatcher().registerProvider(provider);
    const dir = await d.resolvePath('/skills', principal());
    expect(dir).toMatchObject({ provider: 'catalog', type: 'skill', id: '' });
    const leaf = await d.resolvePath('/skills/planner', principal());
    expect(leaf?.id).toBe('skill:foundation:planner');
  });
});

// ---------------------------------------------------------------------------
// catalog provider
// ---------------------------------------------------------------------------

describe('CatalogResourceProvider', () => {
  it('does NOT dedupe a same-named entry across kinds', async () => {
    const provider = catalogProvider(
      registryWith(makeEntry('tool', 'foundation', 'shared'), makeEntry('canvas', 'foundation', 'shared'))
    );
    const tools = await provider.list(colRef(provider, 'tools'), {}, principal());
    const canvases = await provider.list(colRef(provider, 'canvas'), {}, principal());
    expect(tools.entries.map((e) => e.name)).toContain('shared');
    expect(canvases.entries.map((e) => e.name)).toContain('shared');
    expect(tools.entries[0].ref.id).toBe('tool:foundation:shared');
    expect(canvases.entries[0].ref.id).toBe('canvas:foundation:shared');
  });

  it('paginates with stable page tokens', async () => {
    const provider = catalogProvider(
      registryWith(makeEntry('tool', 'foundation', 'a'), makeEntry('tool', 'foundation', 'b'))
    );
    const p1 = await provider.list(colRef(provider, 'tools'), { limit: 1 }, principal());
    expect(p1.entries).toHaveLength(1);
    expect(p1.entries[0].name).toBe('a');
    expect(p1.nextPageToken).toBeDefined();
    const p2 = await provider.list(colRef(provider, 'tools'), { limit: 1, pageToken: p1.nextPageToken }, principal());
    expect(p2.entries[0].name).toBe('b');
    expect(p2.nextPageToken).toBeUndefined();
  });

  it('reads a resource with etag + provenance + json projection', async () => {
    const provider = catalogProvider(registryWith(makeEntry('canvas', 'foundation', 'doc')));
    const ref = { provider: 'catalog', scope: SCOPE, type: 'canvas', id: 'canvas:foundation:doc' };
    const res = await provider.read(ref, {}, principal());
    expect(res.contentType).toBe('application/json');
    expect(res.etag).toMatch(/^[0-9a-f]{16}$/);
    expect(res.provenance).toEqual({ provider: 'catalog', trust: 'first-party', origin: 'foundation' });
    expect(JSON.parse(res.content)).toMatchObject({ kind: 'canvas', name: 'doc' });
    expect(res.truncated).toBe(false);
  });

  it('truncates an over-budget read with a summary', async () => {
    const provider = catalogProvider(registryWith(makeEntry('canvas', 'foundation', 'doc')));
    const ref = { provider: 'catalog', scope: SCOPE, type: 'canvas', id: 'canvas:foundation:doc' };
    const res = await provider.read(ref, { maxBytes: 8 }, principal());
    expect(res.truncated).toBe(true);
    expect(res.summary).toContain('doc');
    expect(Buffer.byteLength(res.content, 'utf8')).toBeLessThanOrEqual(8);
  });

  it('stats both a collection dir and a resource', async () => {
    const provider = catalogProvider(registryWith(makeEntry('tool', 'foundation', 'a')));
    const dir = await provider.stat(colRef(provider, 'tools'), principal());
    expect(dir.nodeType).toBe('dir');
    const res = await provider.stat({ provider: 'catalog', scope: SCOPE, type: 'tool', id: 'tool:foundation:a' }, principal());
    expect(res.nodeType).toBe('resource');
    expect(res.etag).toBeDefined();
  });

  it('delegates grep to the registry search', async () => {
    const provider = catalogProvider(
      registryWith(makeEntry('tool', 'foundation', 'planner'), makeEntry('tool', 'foundation', 'writer'))
    );
    const res = await provider.grep(colRef(provider, 'tools'), { query: 'planner' }, principal());
    expect(res.hits.map((h) => h.path)).toContain('/tools/planner');
  });

  it('denies edit on read-only catalog resources', async () => {
    const provider = catalogProvider(registryWith(makeEntry('tool', 'foundation', 'a')));
    await expect(
      provider.edit({ provider: 'catalog', scope: SCOPE, type: 'tool', id: 'tool:foundation:a' }, { content: 'x' }, principal())
    ).rejects.toMatchObject({ code: 'denied' });
  });

  it('hides unavailable entries (deny-as-missing on list AND read)', async () => {
    const provider = catalogProvider(
      registryWith(makeEntry('tool', 'foundation', 'locked', { contextFilter: { workspaceTypes: ['special'] } }))
    );
    // principal workspaceType 'general' does not match → not listed
    const list = await provider.list(colRef(provider, 'tools'), {}, principal());
    expect(list.entries).toHaveLength(0);
    // read surfaces not_found, never denied (no existence oracle)
    await expect(
      provider.read({ provider: 'catalog', scope: SCOPE, type: 'tool', id: 'tool:foundation:locked' }, {}, principal())
    ).rejects.toMatchObject({ code: 'not_found' });
    // a principal in the matching workspace type CAN read it
    const ok = await provider.read(
      { provider: 'catalog', scope: SCOPE, type: 'tool', id: 'tool:foundation:locked' },
      {},
      principal({ workspaceType: 'special' })
    );
    expect(JSON.parse(ok.content)).toMatchObject({ name: 'locked' });
  });

  it('keeps invoke unsupported in this slice', async () => {
    const provider = catalogProvider(registryWith(makeEntry('tool', 'foundation', 'a')));
    await expect(
      provider.invoke({ provider: 'catalog', scope: SCOPE, type: 'tool', id: 'tool:foundation:a' }, { args: {} }, principal())
    ).rejects.toMatchObject({ code: 'unsupported' });
  });
});
