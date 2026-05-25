import { describe, expect, it } from 'vitest';

import { InMemorySkillRegistry } from '../../src/registry/registry.js';
import { createSkillsToolRegistry, SkillsToolRegistry } from '../../src/registry/adapter.js';
import type { AuthzContext, ResolvedTool, ToolRegistry } from '../../src/registry/authz.js';
import type { Skill } from '../../src/types/skill.js';
import { SEARCH_SKILLS_TOOL_NAME } from '../../src/registry/search-skills-tool.js';

/**
 * Helper: filter out the auto-registered `search_skills` meta-tool so legacy
 * assertions focus on user-registered skills. Coverage of the meta-tool
 * itself lives in dedicated tests below.
 */
const withoutMeta = (tools: ReadonlyArray<ResolvedTool>): ResolvedTool[] =>
  tools.filter((t) => t.name !== SEARCH_SKILLS_TOOL_NAME);

const buildSkill = (name: string, toolNames: ReadonlyArray<string>): Skill => ({
  metadata: {
    name,
    description: `${name} description`,
    version: '1.0.0',
    category: 'test',
    toolNames,
  },
  tools: toolNames.map((toolName) => ({
    name: toolName,
    description: `${toolName} tool`,
    inputSchema: { type: 'object' },
    outputSchema: { type: 'object' },
    sideEffect: toolName.startsWith('write_'),
  })),
  body: '',
});

const buildAuthz = (overrides: Partial<AuthzContext> = {}): AuthzContext => ({
  tenant: { tenantId: 't-1', workspaceType: 'ai-ideas' },
  roles: ['editor'],
  permissions: [],
  permissionMode: 'open',
  allowedTools: [],
  ...overrides,
});

describe('SkillsToolRegistry adapter', () => {
  it('implements the ToolRegistry interface structurally', () => {
    const reg = new InMemorySkillRegistry();
    const adapter: ToolRegistry = createSkillsToolRegistry(reg);
    expect(typeof adapter.resolveTools).toBe('function');
  });

  it('resolves the union of tools from every visible skill', () => {
    const reg = new InMemorySkillRegistry();
    reg.register(buildSkill('web', ['web_search', 'web_extract']));
    reg.register(buildSkill('docs', ['document_generate']));
    const adapter = createSkillsToolRegistry(reg);

    const tools = withoutMeta(adapter.resolveTools(buildAuthz()));
    expect(tools.map((t) => t.name).sort()).toEqual([
      'document_generate',
      'web_extract',
      'web_search',
    ]);
    // ResolvedTool carries skillName back-pointer for chat-core dispatch.
    expect(tools.find((t) => t.name === 'document_generate')!.skillName).toBe('docs');
    expect(tools.find((t) => t.name === 'web_search')!.outputSchema).toBeDefined();
  });

  it('reflects post-construction registrations (no internal cache)', () => {
    const reg = new InMemorySkillRegistry();
    const adapter = new SkillsToolRegistry(reg);
    expect(withoutMeta(adapter.resolveTools(buildAuthz()))).toEqual([]);

    reg.register(buildSkill('web', ['web_search']));
    const tools = withoutMeta(adapter.resolveTools(buildAuthz()));
    expect(tools.map((t) => t.name)).toEqual(['web_search']);
  });

  it('forwards options.skillName to the resolver', () => {
    const reg = new InMemorySkillRegistry();
    reg.register(buildSkill('web', ['web_search']));
    reg.register(buildSkill('docs', ['document_generate']));
    const adapter = createSkillsToolRegistry(reg);

    const tools = adapter.resolveTools(buildAuthz(), { skillName: 'docs' });
    // search_skills is intentionally omitted when scoping to a single skill.
    expect(tools.map((t) => t.name)).toEqual(['document_generate']);
  });

  it('honors permissionMode allowlist transparently', () => {
    const reg = new InMemorySkillRegistry();
    reg.register(buildSkill('web', ['web_search', 'web_extract']));
    const adapter = createSkillsToolRegistry(reg);

    const tools = withoutMeta(
      adapter.resolveTools(
        buildAuthz({
          permissionMode: 'allowlist',
          allowedTools: ['web_search'],
        }),
      ),
    );
    expect(tools.map((t) => t.name)).toEqual(['web_search']);
  });

  it('preserves sideEffect flag on ResolvedTool', () => {
    const reg = new InMemorySkillRegistry();
    reg.register(buildSkill('orgs', ['read_org', 'write_org']));
    const adapter = createSkillsToolRegistry(reg);

    const tools = withoutMeta(adapter.resolveTools(buildAuthz()));
    const writeTool = tools.find((t) => t.name === 'write_org');
    const readTool = tools.find((t) => t.name === 'read_org');
    expect(writeTool!.sideEffect).toBe(true);
    expect(readTool!.sideEffect).toBe(false);
  });
});

describe('SkillsToolRegistry — search_skills auto-registration', () => {
  it('includes search_skills in resolveTools even when no skill is registered', () => {
    const reg = new InMemorySkillRegistry();
    const adapter = createSkillsToolRegistry(reg);

    const tools = adapter.resolveTools(buildAuthz());
    const meta = tools.find((t) => t.name === SEARCH_SKILLS_TOOL_NAME);
    expect(meta).toBeDefined();
    expect(meta!.skillName).toBe('__skills__');
    expect(meta!.sideEffect).toBe(false);
    expect(meta!.requiresApproval).toBe(false);
    expect(meta!.inputSchema).toBeDefined();
    expect(meta!.outputSchema).toBeDefined();
  });

  it('omits search_skills when resolveTools is scoped to a single skill', () => {
    const reg = new InMemorySkillRegistry();
    reg.register(buildSkill('docs', ['document_generate']));
    const adapter = createSkillsToolRegistry(reg);

    const tools = adapter.resolveTools(buildAuthz(), { skillName: 'docs' });
    expect(tools.find((t) => t.name === SEARCH_SKILLS_TOOL_NAME)).toBeUndefined();
  });

  it('executeSearchSkills returns ranked hits filtered by authz visibility', () => {
    const reg = new InMemorySkillRegistry();
    reg.register(buildSkill('web', ['web_search', 'web_extract']));
    // Admin-only skill: must be filtered out for editor caller even though
    // the query matches it.
    reg.register({
      metadata: {
        name: 'admin-purge',
        description: 'admin web purge tool',
        version: '1.0.0',
        category: 'admin',
        contextFilter: { roles: ['admin'] },
        toolNames: ['admin_purge'],
      },
      tools: [
        {
          name: 'admin_purge',
          description: 'purge things',
          inputSchema: { type: 'object' },
        },
      ],
      body: '',
    });
    const adapter = createSkillsToolRegistry(reg);

    const hits = adapter.executeSearchSkills(buildAuthz({ roles: ['editor'] }), {
      query: 'web',
    });
    const names = hits.map((h) => h.metadata.name);
    expect(names).toContain('web');
    expect(names).not.toContain('admin-purge');
  });
});
