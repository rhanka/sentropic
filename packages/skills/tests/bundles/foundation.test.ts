import { describe, expect, it } from 'vitest';

import { InMemorySkillRegistry } from '../../src/registry/registry.js';
import { createSkillsToolRegistry } from '../../src/registry/adapter.js';
import {
  FOUNDATION_SKILLS,
  registerFoundationSkills,
  webSkill,
  workspaceSkill,
} from '../../src/bundles/foundation/index.js';
import type { AuthzContext, ResolvedTool } from '../../src/registry/authz.js';
import { SEARCH_SKILLS_TOOL_NAME } from '../../src/registry/search-skills-tool.js';

const withoutMeta = (tools: ReadonlyArray<ResolvedTool>): ResolvedTool[] =>
  tools.filter((t) => t.name !== SEARCH_SKILLS_TOOL_NAME);

const buildAuthz = (overrides: Partial<AuthzContext> = {}): AuthzContext => ({
  tenant: { tenantId: 't-1', workspaceType: 'ai-ideas' },
  roles: ['editor'],
  permissions: [],
  permissionMode: 'open',
  allowedTools: [],
  ...overrides,
});

describe('foundation bundle — Wave A', () => {
  describe('workspace skill', () => {
    it('parses SKILL.md into a valid Skill at module load', () => {
      expect(workspaceSkill.metadata.name).toBe('workspace');
      expect(workspaceSkill.metadata.version).toBe('0.1.0');
      expect(workspaceSkill.metadata.category).toBe('workflow');
    });

    it('declares exactly the two Wave A tool names', () => {
      expect(workspaceSkill.metadata.toolNames).toEqual([
        'workspace_list',
        'initiative_search',
      ]);
      expect(workspaceSkill.tools.map((t) => t.name)).toEqual([
        'workspace_list',
        'initiative_search',
      ]);
    });

    it('exposes a non-empty Markdown body parsed from SKILL.md', () => {
      expect(workspaceSkill.body.length).toBeGreaterThan(0);
      expect(workspaceSkill.body).toContain('Workspace skill');
    });

    it('ships handlers for every declared tool', () => {
      expect(workspaceSkill.handlers).toBeDefined();
      const handlers = workspaceSkill.handlers ?? {};
      expect(Object.keys(handlers).sort()).toEqual(
        ['initiative_search', 'workspace_list'].sort(),
      );
    });

    it('handlers throw a "not bound" error when invoked (Wave A guard)', () => {
      const handlers = workspaceSkill.handlers ?? {};
      expect(() =>
        handlers.workspace_list?.({
          toolName: 'workspace_list',
          input: {},
        }),
      ).toThrow(/not bound/);
      expect(() =>
        handlers.initiative_search?.({
          toolName: 'initiative_search',
          input: { query: 'x' },
        }),
      ).toThrow(/not bound/);
    });
  });

  describe('web skill', () => {
    it('parses SKILL.md metadata, tools, body, and handlers', () => {
      expect(webSkill.metadata.name).toBe('web');
      expect(webSkill.metadata.version).toBe('0.1.0');
      expect(webSkill.metadata.category).toBe('web');
      expect(webSkill.metadata.contextFilter?.requiresOnline).toBe(true);
      expect(webSkill.metadata.toolNames).toEqual([
        'web_search',
        'web_extract',
      ]);
      expect(webSkill.tools.map((t) => t.name)).toEqual([
        'web_search',
        'web_extract',
      ]);
      expect(webSkill.body.length).toBeGreaterThan(0);
      expect(webSkill.body).toContain('Web skill');
      expect(webSkill.handlers).toBeDefined();
      const handlers = webSkill.handlers ?? {};
      expect(Object.keys(handlers).sort()).toEqual(
        ['web_extract', 'web_search'].sort(),
      );
    });

    it('handlers throw a "not bound" error when invoked (Wave A guard)', () => {
      const handlers = webSkill.handlers ?? {};
      expect(() =>
        handlers.web_search?.({
          toolName: 'web_search',
          input: { query: 'latest AI regulation' },
        }),
      ).toThrow(/not bound/);
      expect(() =>
        handlers.web_extract?.({
          toolName: 'web_extract',
          input: { urls: ['https://example.com'] },
        }),
      ).toThrow(/not bound/);
    });
  });

  describe('FOUNDATION_SKILLS / registerFoundationSkills', () => {
    it('exposes exactly the foundation Wave A skills', () => {
      expect(FOUNDATION_SKILLS).toHaveLength(2);
      expect(FOUNDATION_SKILLS[0]).toBe(workspaceSkill);
      expect(FOUNDATION_SKILLS[1]).toBe(webSkill);
    });

    it('registers every foundation skill and supports metadata filtering', () => {
      const reg = new InMemorySkillRegistry();
      const names = registerFoundationSkills(reg);

      expect(names).toEqual(['workspace', 'web']);
      expect(reg.list().map((m) => m.name)).toEqual(['workspace', 'web']);
      expect(reg.get('workspace')).toBe(workspaceSkill);
      expect(reg.get('web')).toBe(webSkill);
      expect(reg.list({ category: 'web' }).map((m) => m.name)).toEqual(['web']);
    });

    it('throws on duplicate registration (no idempotency)', () => {
      const reg = new InMemorySkillRegistry();
      registerFoundationSkills(reg);
      expect(() => registerFoundationSkills(reg)).toThrow(/already registered/);
    });

    it('exposes foundation tools through SkillsToolRegistry adapter and supports scoped resolution', () => {
      const reg = new InMemorySkillRegistry();
      registerFoundationSkills(reg);
      const adapter = createSkillsToolRegistry(reg);

      const tools = withoutMeta(adapter.resolveTools(buildAuthz()));
      expect(tools.map((t) => t.name).sort()).toEqual([
        'initiative_search',
        'web_extract',
        'web_search',
        'workspace_list',
      ]);
      expect(tools.find((t) => t.name === 'workspace_list')?.skillName).toBe(
        'workspace',
      );
      expect(tools.find((t) => t.name === 'initiative_search')?.skillName).toBe(
        'workspace',
      );
      expect(tools.find((t) => t.name === 'web_search')?.skillName).toBe('web');
      expect(tools.find((t) => t.name === 'web_extract')?.skillName).toBe('web');

      const scopedTools = adapter.resolveTools(buildAuthz(), { skillName: 'web' });
      expect(scopedTools.map((t) => t.name).sort()).toEqual([
        'web_extract',
        'web_search',
      ]);
      for (const tool of scopedTools) {
        expect(tool.skillName).toBe('web');
      }
    });
  });
});
