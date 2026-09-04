/**
 * CompositeCatalogRegistry — unit tests (BR-42b Lot 1)
 *
 * Verifies:
 *   - list() fan-out across multiple sources.
 *   - list() preserves source registration order and within-source entry order.
 *   - get() finds entries from any source (foundation-precedence on collision).
 *   - search() ranks across all sources.
 *   - Collision policy: first-registered source wins on duplicate name.
 *   - Empty registry behaviour.
 */

import { describe, expect, it, vi } from 'vitest';

import { CompositeCatalogRegistry } from '../../../src/services/catalog/composite-registry';
import type { CatalogEntry, SkillEntry } from '../../../src/services/catalog/types';
import type { CatalogSource } from '../../../src/services/catalog/source';
import type { Skill } from '../../../../packages/skills/src/index';

// ---------------------------------------------------------------------------
// Test helpers — build minimal fake sources
// ---------------------------------------------------------------------------

/**
 * Create a minimal static CatalogSource backed by a fixed array of entries.
 */
function makeTestSource(id: string, entries: CatalogEntry[]): CatalogSource {
  return {
    id,
    kind: 'static' as const,
    snapshot: () => entries,
  };
}

/**
 * Create a minimal SkillEntry for testing. Only populates the fields that
 * CompositeCatalogRegistry inspects (metadata.name, metadata.description,
 * metadata.category).
 */
function makeSkillEntry(
  name: string,
  description: string,
  category: string,
  sourceId: string,
): SkillEntry {
  const skill: Skill = {
    metadata: {
      name,
      description,
      version: '0.0.1',
      category,
      toolNames: [`${name}_tool`],
    },
    tools: [
      {
        name: `${name}_tool`,
        description: `${name} tool`,
        inputSchema: { type: 'object', properties: {} },
      },
    ],
    body: '',
  };
  return {
    kind: 'skill' as const,
    sourceId,
    metadata: {
      name,
      description,
      version: '0.0.1',
      category,
    },
    skill,
  };
}

// ---------------------------------------------------------------------------
// § 1  Empty registry
// ---------------------------------------------------------------------------

describe('CompositeCatalogRegistry — empty', () => {
  it('list() returns [] when no sources are registered', () => {
    const reg = new CompositeCatalogRegistry();
    expect(reg.list()).toEqual([]);
  });

  it('get() returns null when no sources are registered', () => {
    const reg = new CompositeCatalogRegistry();
    expect(reg.get('anything')).toBeNull();
  });

  it('search() returns [] when no sources are registered', () => {
    const reg = new CompositeCatalogRegistry();
    expect(reg.search('workspace')).toEqual([]);
  });

  it('getSources() returns [] when no sources are registered', () => {
    const reg = new CompositeCatalogRegistry();
    expect(reg.getSources()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// § 2  Single source — basic fan-out
// ---------------------------------------------------------------------------

describe('CompositeCatalogRegistry — single source', () => {
  const entryA = makeSkillEntry('alpha', 'Alpha skill for workspace', 'object', 's1');
  const entryB = makeSkillEntry('beta', 'Beta skill for documents', 'document', 's1');
  const source1 = makeTestSource('s1', [entryA, entryB]);

  const reg = new CompositeCatalogRegistry();
  reg.addSource(source1);

  it('list() returns all entries from the source', () => {
    const list = reg.list();
    expect(list).toHaveLength(2);
    expect(list[0]).toBe(entryA);
    expect(list[1]).toBe(entryB);
  });

  it('get() finds an entry by name', () => {
    expect(reg.get('alpha')).toBe(entryA);
    expect(reg.get('beta')).toBe(entryB);
  });

  it('get() returns null for an unknown name', () => {
    expect(reg.get('missing')).toBeNull();
  });

  it('search() returns hits in descending score order', () => {
    const hits = reg.search('workspace alpha', { topK: 5 });
    expect(hits.length).toBeGreaterThan(0);
    for (let i = 1; i < hits.length; i++) {
      expect(hits[i - 1]!.score).toBeGreaterThanOrEqual(hits[i]!.score);
    }
  });

  it('search() returns [] for empty query', () => {
    expect(reg.search('')).toEqual([]);
  });

  it('search() returns [] for whitespace-only query', () => {
    expect(reg.search('   ')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// § 3  Multiple sources — order preservation
// ---------------------------------------------------------------------------

describe('CompositeCatalogRegistry — multiple sources, order preservation', () => {
  const entryX = makeSkillEntry('x-skill', 'X skill', 'analysis', 'src-x');
  const entryY = makeSkillEntry('y-skill', 'Y skill', 'analysis', 'src-x');
  const entryZ = makeSkillEntry('z-skill', 'Z skill', 'web', 'src-z');
  const entryW = makeSkillEntry('w-skill', 'W skill', 'web', 'src-z');

  const srcX = makeTestSource('src-x', [entryX, entryY]);
  const srcZ = makeTestSource('src-z', [entryZ, entryW]);

  const reg = new CompositeCatalogRegistry();
  reg.addSource(srcX);
  reg.addSource(srcZ);

  it('list() returns source-1 entries before source-2 entries', () => {
    const list = reg.list();
    expect(list).toHaveLength(4);
    // Source registration order: srcX first, then srcZ.
    expect(list[0]).toBe(entryX);
    expect(list[1]).toBe(entryY);
    expect(list[2]).toBe(entryZ);
    expect(list[3]).toBe(entryW);
  });

  it('list() preserves within-source entry order', () => {
    const list = reg.list();
    const names = list.map((e) => e.metadata.name);
    expect(names).toEqual(['x-skill', 'y-skill', 'z-skill', 'w-skill']);
  });

  it('get() finds entries from both sources', () => {
    expect(reg.get('x-skill')).toBe(entryX);
    expect(reg.get('z-skill')).toBe(entryZ);
  });

  it('search() fans across both sources', () => {
    const hits = reg.search('skill', { topK: 10 });
    const names = hits.map((h) => h.entry.metadata.name);
    // All four entries mention "skill" in their name
    expect(names).toContain('x-skill');
    expect(names).toContain('y-skill');
    expect(names).toContain('z-skill');
    expect(names).toContain('w-skill');
  });
});

// ---------------------------------------------------------------------------
// § 4  Collision policy — first-registered source wins
// ---------------------------------------------------------------------------

describe('CompositeCatalogRegistry — collision policy (foundation-precedence)', () => {
  const primary = makeSkillEntry('shared-name', 'Primary version', 'object', 'primary');
  const secondary = makeSkillEntry('shared-name', 'Secondary version', 'document', 'secondary');
  const unique = makeSkillEntry('unique-name', 'Unique skill', 'web', 'secondary');

  const srcPrimary = makeTestSource('primary', [primary]);
  const srcSecondary = makeTestSource('secondary', [secondary, unique]);

  const reg = new CompositeCatalogRegistry();
  reg.addSource(srcPrimary);
  reg.addSource(srcSecondary);

  it('list() deduplicates by name — primary entry kept, secondary entry with same name dropped', () => {
    const list = reg.list();
    // Should have 2 entries: primary's 'shared-name' + secondary's 'unique-name'
    expect(list).toHaveLength(2);
    const names = list.map((e) => e.metadata.name);
    expect(names).toContain('shared-name');
    expect(names).toContain('unique-name');
  });

  it('list() keeps the primary entry for the colliding name', () => {
    const list = reg.list();
    const sharedEntry = list.find((e) => e.metadata.name === 'shared-name');
    expect(sharedEntry?.metadata.description).toBe('Primary version');
    expect(sharedEntry?.sourceId).toBe('primary');
  });

  it('get() returns the primary entry for the colliding name', () => {
    const entry = reg.get('shared-name');
    expect(entry?.metadata.description).toBe('Primary version');
    expect(entry?.sourceId).toBe('primary');
  });

  it('get() finds the unique secondary entry', () => {
    const entry = reg.get('unique-name');
    expect(entry).toBe(unique);
  });

  it('search() returns the primary entry (not the secondary) for the colliding name', () => {
    const hits = reg.search('primary version', { topK: 5 });
    const sharedHit = hits.find((h) => h.entry.metadata.name === 'shared-name');
    expect(sharedHit?.entry.sourceId).toBe('primary');
  });
});

// ---------------------------------------------------------------------------
// § 5  addSource() chaining + getSources()
// ---------------------------------------------------------------------------

describe('CompositeCatalogRegistry — addSource() and getSources()', () => {
  it('addSource() returns the registry for chaining', () => {
    const reg = new CompositeCatalogRegistry();
    const src1 = makeTestSource('a', []);
    const src2 = makeTestSource('b', []);
    const result = reg.addSource(src1).addSource(src2);
    expect(result).toBe(reg);
  });

  it('getSources() returns registered sources in registration order', () => {
    const reg = new CompositeCatalogRegistry();
    const src1 = makeTestSource('first', []);
    const src2 = makeTestSource('second', []);
    reg.addSource(src1).addSource(src2);
    const sources = reg.getSources();
    expect(sources).toHaveLength(2);
    expect(sources[0]?.id).toBe('first');
    expect(sources[1]?.id).toBe('second');
  });

  it('exposes source metadata without refreshing providers during discovery', () => {
    const refresh = vi.fn(async () => undefined);
    const source = { ...makeTestSource('remote', []), kind: 'mcp' as const, refresh };
    const reg = new CompositeCatalogRegistry().addSource(source);
    expect(reg.getSources().map(({ id, kind }) => ({ id, kind }))).toEqual([
      { id: 'remote', kind: 'mcp' },
    ]);
    reg.list();
    reg.search('anything');
    expect(refresh).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// § 6  search() options — topK, kindHint, categoryHint
// ---------------------------------------------------------------------------

describe('CompositeCatalogRegistry.search() — options', () => {
  const entries = [
    makeSkillEntry('workspace-alpha', 'Workspace alpha for navigation', 'object', 's'),
    makeSkillEntry('workspace-beta', 'Workspace beta for lists', 'object', 's'),
    makeSkillEntry('workspace-gamma', 'Workspace gamma for updates', 'analysis', 's'),
    makeSkillEntry('documents-alpha', 'Documents alpha for content', 'document', 's'),
  ];
  const src = makeTestSource('s', entries);
  const reg = new CompositeCatalogRegistry();
  reg.addSource(src);

  it('default topK is 5', () => {
    // All 4 entries match "workspace" or "alpha" — should get at most 5
    const hits = reg.search('workspace alpha documents');
    expect(hits.length).toBeLessThanOrEqual(5);
  });

  it('explicit topK is respected', () => {
    const hits = reg.search('workspace', { topK: 2 });
    expect(hits.length).toBeLessThanOrEqual(2);
  });

  it('categoryHint filters by category', () => {
    const hits = reg.search('workspace', { topK: 10, categoryHint: 'analysis' });
    for (const hit of hits) {
      expect(hit.entry.metadata.category).toBe('analysis');
    }
  });

  it('kindHint filters by entry kind', () => {
    const hits = reg.search('workspace', { topK: 10, kindHint: 'skill' });
    for (const hit of hits) {
      expect(hit.entry.kind).toBe('skill');
    }
  });

  it('each hit carries score (number) and matchedFields (array)', () => {
    const hits = reg.search('workspace', { topK: 5 });
    for (const hit of hits) {
      expect(typeof hit.score).toBe('number');
      expect(hit.score).toBeGreaterThan(0);
      expect(Array.isArray(hit.matchedFields)).toBe(true);
      expect(hit.matchedFields.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// § 7  Foundation-via-composite ordering (real source integration)
// ---------------------------------------------------------------------------

describe('CompositeCatalogRegistry — foundation source integration (ordering)', () => {
  it('foundation source entries appear in FOUNDATION_SKILLS order via the composite', async () => {
    // Import the real foundation source and validate list() order
    const { StaticCatalogSource } = await import(
      '../../../src/services/catalog/sources/static-source'
    );
    const { FOUNDATION_SKILLS } = await import('../../../../packages/skills/src/index');

    const src = new StaticCatalogSource('foundation');
    const reg = new CompositeCatalogRegistry();
    reg.addSource(src);

    const list = reg.list();
    const names = list.map((e) => e.metadata.name);
    const expectedNames = FOUNDATION_SKILLS.map((s) => s.metadata.name);

    expect(names).toEqual(expectedNames);
  });
});
