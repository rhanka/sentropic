import { describe, expect, it } from 'vitest';

import { InMemorySkillRegistry } from '../../src/registry/registry.js';
import { createSkillsToolRegistry, SkillsToolRegistry } from '../../src/registry/adapter.js';
import type { AuthzContext, ToolRegistry } from '../../src/registry/authz.js';
import type { Skill } from '../../src/types/skill.js';

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

    const tools = adapter.resolveTools(buildAuthz());
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
    expect(adapter.resolveTools(buildAuthz())).toEqual([]);

    reg.register(buildSkill('web', ['web_search']));
    const tools = adapter.resolveTools(buildAuthz());
    expect(tools.map((t) => t.name)).toEqual(['web_search']);
  });

  it('forwards options.skillName to the resolver', () => {
    const reg = new InMemorySkillRegistry();
    reg.register(buildSkill('web', ['web_search']));
    reg.register(buildSkill('docs', ['document_generate']));
    const adapter = createSkillsToolRegistry(reg);

    const tools = adapter.resolveTools(buildAuthz(), { skillName: 'docs' });
    expect(tools.map((t) => t.name)).toEqual(['document_generate']);
  });

  it('honors permissionMode allowlist transparently', () => {
    const reg = new InMemorySkillRegistry();
    reg.register(buildSkill('web', ['web_search', 'web_extract']));
    const adapter = createSkillsToolRegistry(reg);

    const tools = adapter.resolveTools(
      buildAuthz({
        permissionMode: 'allowlist',
        allowedTools: ['web_search'],
      }),
    );
    expect(tools.map((t) => t.name)).toEqual(['web_search']);
  });

  it('preserves sideEffect flag on ResolvedTool', () => {
    const reg = new InMemorySkillRegistry();
    reg.register(buildSkill('orgs', ['read_org', 'write_org']));
    const adapter = createSkillsToolRegistry(reg);

    const tools = adapter.resolveTools(buildAuthz());
    const writeTool = tools.find((t) => t.name === 'write_org');
    const readTool = tools.find((t) => t.name === 'read_org');
    expect(writeTool!.sideEffect).toBe(true);
    expect(readTool!.sideEffect).toBe(false);
  });
});
