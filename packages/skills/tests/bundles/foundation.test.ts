import { describe, expect, it } from 'vitest';

import { InMemorySkillRegistry } from '../../src/registry/registry.js';
import { createSkillsToolRegistry } from '../../src/registry/adapter.js';
import {
  FOUNDATION_SKILLS,
  registerFoundationSkills,
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

  describe('FOUNDATION_SKILLS / registerFoundationSkills', () => {
    it('exposes exactly the workspace skill in Wave A', () => {
      expect(FOUNDATION_SKILLS).toHaveLength(1);
      expect(FOUNDATION_SKILLS[0]).toBe(workspaceSkill);
    });

    it('registers every foundation skill into a SkillRegistry', () => {
      const reg = new InMemorySkillRegistry();
      const names = registerFoundationSkills(reg);

      expect(names).toEqual(['workspace']);
      expect(reg.list().map((m) => m.name)).toEqual(['workspace']);
      expect(reg.get('workspace')).toBe(workspaceSkill);
    });

    it('throws on duplicate registration (no idempotency)', () => {
      const reg = new InMemorySkillRegistry();
      registerFoundationSkills(reg);
      expect(() => registerFoundationSkills(reg)).toThrow(/already registered/);
    });

    it('exposes foundation tools through SkillsToolRegistry adapter', () => {
      const reg = new InMemorySkillRegistry();
      registerFoundationSkills(reg);
      const adapter = createSkillsToolRegistry(reg);

      const tools = withoutMeta(adapter.resolveTools(buildAuthz()));
      expect(tools.map((t) => t.name).sort()).toEqual([
        'initiative_search',
        'workspace_list',
      ]);
      for (const tool of tools) {
        expect(tool.skillName).toBe('workspace');
      }
    });
  });
});
