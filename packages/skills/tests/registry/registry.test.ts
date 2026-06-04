import { describe, expect, it } from 'vitest';

import { InMemorySkillRegistry } from '../../src/registry/registry.js';
import type { Skill } from '../../src/types/skill.js';

const buildSkill = (overrides: Partial<Skill['metadata']> & { name: string }): Skill => ({
  metadata: {
    name: overrides.name,
    description: overrides.description ?? `${overrides.name} description`,
    version: overrides.version ?? '1.0.0',
    category: overrides.category ?? 'test',
    contextFilter: overrides.contextFilter,
    sandbox: overrides.sandbox,
    authzRequirements: overrides.authzRequirements,
    toolNames: overrides.toolNames ?? [`${overrides.name}_run`],
  },
  tools: [
    {
      name: overrides.toolNames?.[0] ?? `${overrides.name}_run`,
      description: `${overrides.name} tool`,
      inputSchema: { type: 'object' },
    },
  ],
  body: '',
});

describe('InMemorySkillRegistry.register', () => {
  it('registers a skill and exposes it through get()', () => {
    const reg = new InMemorySkillRegistry();
    const skill = buildSkill({ name: 'web' });
    reg.register(skill);
    expect(reg.get('web')).toBe(skill);
  });

  it('throws when a skill with the same name is registered twice', () => {
    const reg = new InMemorySkillRegistry();
    reg.register(buildSkill({ name: 'web' }));
    expect(() => reg.register(buildSkill({ name: 'web' }))).toThrow(/already registered/);
  });

  it('throws when registering a skill with empty name', () => {
    const reg = new InMemorySkillRegistry();
    const broken = buildSkill({ name: 'tmp' });
    const corrupted = { ...broken, metadata: { ...broken.metadata, name: '' } } as Skill;
    expect(() => reg.register(corrupted)).toThrow(/name is required/);
  });
});

describe('InMemorySkillRegistry.unregister', () => {
  it('removes a registered skill', () => {
    const reg = new InMemorySkillRegistry();
    reg.register(buildSkill({ name: 'web' }));
    reg.unregister('web');
    expect(reg.get('web')).toBeNull();
  });

  it('is a no-op for unknown names', () => {
    const reg = new InMemorySkillRegistry();
    expect(() => reg.unregister('missing')).not.toThrow();
  });
});

describe('InMemorySkillRegistry.list', () => {
  it('returns metadata for every registered skill when no filter is passed', () => {
    const reg = new InMemorySkillRegistry();
    reg.register(buildSkill({ name: 'web', category: 'web' }));
    reg.register(buildSkill({ name: 'documents', category: 'document' }));
    const names = reg.list().map((m) => m.name).sort();
    expect(names).toEqual(['documents', 'web']);
  });

  it('filters by category', () => {
    const reg = new InMemorySkillRegistry();
    reg.register(buildSkill({ name: 'web', category: 'web' }));
    reg.register(buildSkill({ name: 'documents', category: 'document' }));
    const out = reg.list({ category: 'document' });
    expect(out.map((m) => m.name)).toEqual(['documents']);
  });

  it('filters by workspaceType honoring "no contextFilter = wildcard"', () => {
    const reg = new InMemorySkillRegistry();
    reg.register(buildSkill({ name: 'web' })); // no contextFilter -> wildcard
    reg.register(
      buildSkill({
        name: 'documents',
        contextFilter: { workspaceTypes: ['ai-priorities'] },
      }),
    );
    reg.register(
      buildSkill({
        name: 'matrix',
        contextFilter: { workspaceTypes: ['opportunity'] },
      }),
    );
    const out = reg.list({ workspaceType: 'ai-priorities' }).map((m) => m.name).sort();
    expect(out).toEqual(['documents', 'web']);
  });

  it('filters by role with wildcard semantics', () => {
    const reg = new InMemorySkillRegistry();
    reg.register(buildSkill({ name: 'public' })); // wildcard
    reg.register(
      buildSkill({ name: 'admin-only', contextFilter: { roles: ['admin'] } }),
    );
    const editorView = reg.list({ role: 'editor' }).map((m) => m.name).sort();
    expect(editorView).toEqual(['public']);
    const adminView = reg.list({ role: 'admin' }).map((m) => m.name).sort();
    expect(adminView).toEqual(['admin-only', 'public']);
  });
});

describe('InMemorySkillRegistry.search', () => {
  it('returns empty array on empty / whitespace query', () => {
    const reg = new InMemorySkillRegistry();
    reg.register(buildSkill({ name: 'web' }));
    expect(reg.search('')).toEqual([]);
    expect(reg.search('   ')).toEqual([]);
  });

  it('returns hits ordered by score with name weighted highest', () => {
    const reg = new InMemorySkillRegistry();
    reg.register(
      buildSkill({
        name: 'web',
        description: 'Search the public web for pages, then extract text.',
        category: 'web',
      }),
    );
    reg.register(
      buildSkill({
        name: 'documents',
        description: 'Generate exportable office documents.',
        category: 'document',
      }),
    );
    const hits = reg.search('web search');
    expect(hits[0]!.metadata.name).toBe('web');
    expect(hits[0]!.matchedFields).toContain('name');
    expect(hits[0]!.matchedFields).toContain('description');
  });

  it('filters by categoryHint before ranking', () => {
    const reg = new InMemorySkillRegistry();
    reg.register(
      buildSkill({
        name: 'web',
        description: 'Search the web for documents and pages.',
        category: 'web',
      }),
    );
    reg.register(
      buildSkill({
        name: 'documents',
        description: 'Generate documents from a template.',
        category: 'document',
      }),
    );
    const hits = reg.search('documents', { categoryHint: 'document' });
    expect(hits.map((h) => h.metadata.name)).toEqual(['documents']);
  });

  it('honors topK and never returns more than 50 hits', () => {
    const reg = new InMemorySkillRegistry();
    for (let i = 0; i < 60; i += 1) {
      reg.register(
        buildSkill({
          name: `skill-${String(i).padStart(2, '0')}`,
          description: 'shared keyword listing',
        }),
      );
    }
    expect(reg.search('shared', { topK: 3 })).toHaveLength(3);
    expect(reg.search('listing', { topK: 999 })).toHaveLength(50);
  });

  it('omits skills with score 0 (no token overlap)', () => {
    const reg = new InMemorySkillRegistry();
    reg.register(
      buildSkill({
        name: 'web',
        description: 'search the public internet',
        category: 'web',
      }),
    );
    expect(reg.search('matrix')).toEqual([]);
  });
});
