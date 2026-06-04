import { describe, expect, it } from 'vitest';

import { InMemorySkillRegistry } from '../../src/registry/registry.js';
import { createSkillsToolRegistry } from '../../src/registry/adapter.js';
import {
  SEARCH_SKILLS_RESOLVED_TOOL,
  SEARCH_SKILLS_TOOL,
  SEARCH_SKILLS_TOOL_NAME,
  executeSearchSkills,
} from '../../src/registry/search-skills-tool.js';
import type { AuthzContext } from '../../src/registry/authz.js';
import type { Skill } from '../../src/types/skill.js';

const buildSkill = (
  name: string,
  description: string,
  category = 'test',
  contextFilter?: Skill['metadata']['contextFilter'],
): Skill => ({
  metadata: {
    name,
    description,
    version: '1.0.0',
    category,
    contextFilter,
    toolNames: [`${name}_run`],
  },
  tools: [
    {
      name: `${name}_run`,
      description: `${name} tool`,
      inputSchema: { type: 'object' },
    },
  ],
  body: '',
});

const buildAuthz = (overrides: Partial<AuthzContext> = {}): AuthzContext => ({
  tenant: { tenantId: 't-1', workspaceType: 'ai-priorities' },
  roles: ['editor'],
  permissions: [],
  permissionMode: 'open',
  allowedTools: [],
  ...overrides,
});

describe('SearchSkillsTool — descriptors', () => {
  it('exposes a stable tool name and matching ResolvedTool', () => {
    expect(SEARCH_SKILLS_TOOL.name).toBe(SEARCH_SKILLS_TOOL_NAME);
    expect(SEARCH_SKILLS_TOOL_NAME).toBe('search_skills');
    expect(SEARCH_SKILLS_RESOLVED_TOOL.name).toBe(SEARCH_SKILLS_TOOL_NAME);
    expect(SEARCH_SKILLS_RESOLVED_TOOL.skillName).toBe('__skills__');
    // sideEffect / requiresApproval explicitly false: the meta-tool is a
    // read-only catalog query and must never trigger an approval gate.
    expect(SEARCH_SKILLS_RESOLVED_TOOL.sideEffect).toBe(false);
    expect(SEARCH_SKILLS_RESOLVED_TOOL.requiresApproval).toBe(false);
  });
});

describe('executeSearchSkills — ranking', () => {
  it('ranks higher-overlap skills before lower-overlap skills', () => {
    const reg = new InMemorySkillRegistry();
    reg.register(buildSkill('web', 'Search the public web for documents and pages.'));
    reg.register(buildSkill('matrix', 'Generate decision matrices for product reviews.'));
    reg.register(buildSkill('documents', 'Generate exportable office documents.'));

    const hits = executeSearchSkills(reg, buildAuthz(), { query: 'web search' });
    expect(hits.length).toBeGreaterThan(0);
    // 'web' matches BOTH "web" (name + description) and "search" (description),
    // so it must dominate any other hit.
    expect(hits[0]!.metadata.name).toBe('web');
  });
});

describe('executeSearchSkills — limit', () => {
  it('respects the limit option', () => {
    const reg = new InMemorySkillRegistry();
    for (let i = 0; i < 10; i += 1) {
      reg.register(
        buildSkill(`s-${String(i).padStart(2, '0')}`, 'shared shared keyword'),
      );
    }
    expect(executeSearchSkills(reg, buildAuthz(), { query: 'shared', limit: 3 })).toHaveLength(3);
  });

  it('clamps limit between 1 and 50 and defaults to 5 when omitted', () => {
    const reg = new InMemorySkillRegistry();
    for (let i = 0; i < 60; i += 1) {
      reg.register(buildSkill(`s-${String(i).padStart(2, '0')}`, 'shared term'));
    }
    expect(executeSearchSkills(reg, buildAuthz(), { query: 'shared' })).toHaveLength(5);
    expect(executeSearchSkills(reg, buildAuthz(), { query: 'shared', limit: 0 })).toHaveLength(1);
    expect(executeSearchSkills(reg, buildAuthz(), { query: 'shared', limit: 999 })).toHaveLength(50);
  });
});

describe('executeSearchSkills — filter', () => {
  it('narrows hits by filter.category', () => {
    const reg = new InMemorySkillRegistry();
    reg.register(buildSkill('web', 'Search the web for documents.', 'web'));
    reg.register(buildSkill('docs', 'Generate documents from templates.', 'document'));

    const hits = executeSearchSkills(reg, buildAuthz(), {
      query: 'documents',
      filter: { category: 'document' },
    });
    expect(hits.map((h) => h.metadata.name)).toEqual(['docs']);
  });

  it('narrows hits by filter.roles against contextFilter.roles', () => {
    const reg = new InMemorySkillRegistry();
    // Wildcard skill (no roles declared) — always passes the role filter.
    reg.register(buildSkill('public-search', 'public search tool'));
    // Editor-scoped skill — passes when filter.roles includes 'editor'.
    reg.register(
      buildSkill('editor-search', 'editor search tool', 'test', { roles: ['editor'] }),
    );
    // Admin-only skill — dropped because no role overlap with filter.
    reg.register(
      buildSkill('admin-search', 'admin search tool', 'test', { roles: ['admin'] }),
    );

    // Caller holds BOTH roles so authz visibility is not the bottleneck;
    // the user-level filter narrows further.
    const hits = executeSearchSkills(
      reg,
      buildAuthz({ roles: ['editor', 'admin'] }),
      { query: 'search', filter: { roles: ['editor'] } },
    );
    const names = hits.map((h) => h.metadata.name).sort();
    expect(names).toEqual(['editor-search', 'public-search']);
  });

  it('drops allowlisted-out skills even when metadata is otherwise visible', () => {
    const reg = new InMemorySkillRegistry();
    reg.register(buildSkill('web', 'shared search capability'));
    reg.register(buildSkill('documents', 'shared document generation capability'));

    const hits = executeSearchSkills(
      reg,
      buildAuthz({
        permissionMode: 'allowlist',
        allowedTools: ['web_run'],
      }),
      { query: 'shared' },
    );

    expect(hits.map((h) => h.metadata.name)).toEqual(['web']);
  });
});

describe('executeSearchSkills — empty catalog & invariants', () => {
  it('returns [] when no skill is registered (does not throw)', () => {
    const reg = new InMemorySkillRegistry();
    expect(executeSearchSkills(reg, buildAuthz(), { query: 'anything' })).toEqual([]);
  });

  it('returns [] on empty or whitespace-only query', () => {
    const reg = new InMemorySkillRegistry();
    reg.register(buildSkill('web', 'Search the web.'));
    expect(executeSearchSkills(reg, buildAuthz(), { query: '' })).toEqual([]);
    expect(executeSearchSkills(reg, buildAuthz(), { query: '   ' })).toEqual([]);
  });

  it('via SkillsToolRegistry.executeSearchSkills — auto-injected meta-tool is callable', () => {
    const reg = new InMemorySkillRegistry();
    reg.register(buildSkill('web', 'Search the web for pages.'));
    const adapter = createSkillsToolRegistry(reg);

    // Resolved list must expose the meta-tool descriptor.
    const tools = adapter.resolveTools(buildAuthz());
    expect(tools.find((t) => t.name === SEARCH_SKILLS_TOOL_NAME)).toBeDefined();

    // Invoking it through the adapter must return real hits.
    const hits = adapter.executeSearchSkills(buildAuthz(), { query: 'web' });
    expect(hits.map((h) => h.metadata.name)).toEqual(['web']);
  });
});
