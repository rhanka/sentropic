import { describe, expect, it } from 'vitest';

import { InMemorySkillRegistry } from '../../src/registry/registry.js';
import { createSkillsToolRegistry } from '../../src/registry/adapter.js';
import {
  FOUNDATION_SKILLS,
  executiveSummarySkill,
  foldersSkill,
  initiativesSkill,
  matrixSkill,
  organizationsSkill,
  productsSkill,
  proposalsSkill,
  registerFoundationSkills,
  solutionsSkill,
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

const WAVE_B_SKILLS = [
  {
    skill: organizationsSkill,
    name: 'organizations',
    tools: [
      'organizations_list',
      'organization_get',
      'organization_update',
    ],
    bodyTitle: 'Organizations skill',
  },
  {
    skill: foldersSkill,
    name: 'folders',
    tools: ['folders_list', 'folder_get', 'folder_update'],
    bodyTitle: 'Folders skill',
  },
  {
    skill: initiativesSkill,
    name: 'initiatives',
    tools: ['initiatives_list', 'read_initiative', 'update_initiative'],
    bodyTitle: 'Initiatives skill',
  },
  {
    skill: solutionsSkill,
    name: 'solutions',
    tools: ['solutions_list', 'solution_get'],
    bodyTitle: 'Solutions skill',
  },
  {
    skill: proposalsSkill,
    name: 'proposals',
    tools: ['proposals_list', 'proposal_get'],
    bodyTitle: 'Proposals skill',
  },
  {
    skill: productsSkill,
    name: 'products',
    tools: ['products_list', 'product_get'],
    bodyTitle: 'Products skill',
  },
] as const;

const WAVE_C_SKILLS = [
  {
    skill: executiveSummarySkill,
    name: 'executive_summary',
    tools: ['executive_summary_get', 'executive_summary_update'],
    bodyTitle: 'Executive summary skill',
    updateTool: 'executive_summary_update',
  },
  {
    skill: matrixSkill,
    name: 'matrix',
    tools: ['matrix_get', 'matrix_update'],
    bodyTitle: 'Matrix skill',
    updateTool: 'matrix_update',
  },
] as const;

const FOUNDATION_SKILL_NAMES = [
  'workspace',
  'web',
  'organizations',
  'folders',
  'initiatives',
  'solutions',
  'proposals',
  'products',
  'executive_summary',
  'matrix',
] as const;

const FOUNDATION_TOOL_NAMES = [
  'executive_summary_get',
  'executive_summary_update',
  'folder_get',
  'folder_update',
  'folders_list',
  'initiative_search',
  'initiatives_list',
  'matrix_get',
  'matrix_update',
  'organization_get',
  'organization_update',
  'organizations_list',
  'product_get',
  'products_list',
  'proposal_get',
  'proposals_list',
  'read_initiative',
  'solution_get',
  'solutions_list',
  'update_initiative',
  'web_extract',
  'web_search',
  'workspace_list',
] as const;

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
    it('keeps Wave A skills as the foundation registration prefix', () => {
      expect(FOUNDATION_SKILLS).toHaveLength(FOUNDATION_SKILL_NAMES.length);
      expect(FOUNDATION_SKILLS[0]).toBe(workspaceSkill);
      expect(FOUNDATION_SKILLS[1]).toBe(webSkill);
    });

    it('registers every foundation skill and supports metadata filtering', () => {
      const reg = new InMemorySkillRegistry();
      const names = registerFoundationSkills(reg);

      expect(names).toEqual(FOUNDATION_SKILL_NAMES);
      expect(reg.list().map((m) => m.name)).toEqual(FOUNDATION_SKILL_NAMES);
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
        ...FOUNDATION_TOOL_NAMES,
      ].sort());
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

describe('foundation bundle — Wave B object skills', () => {
  it('parses every object skill metadata, tools, body, and handlers', () => {
    for (const { skill, name, tools, bodyTitle } of WAVE_B_SKILLS) {
      expect(skill.metadata.name).toBe(name);
      expect(skill.metadata.version).toBe('0.1.0');
      expect(skill.metadata.category).toBe('object');
      expect(skill.metadata.contextFilter?.workspaceTypes).toEqual([
        'ai-ideas',
        'opportunity',
      ]);
      expect(skill.metadata.toolNames).toEqual(tools);
      expect(skill.tools.map((t) => t.name)).toEqual(tools);
      expect(skill.body).toContain(bodyTitle);
      expect(Object.keys(skill.handlers ?? {}).sort()).toEqual(
        [...tools].sort(),
      );
    }
  });

  it('handlers throw a "not bound" error when invoked', () => {
    for (const { skill, name, tools } of WAVE_B_SKILLS) {
      for (const toolName of tools) {
        expect(() =>
          skill.handlers?.[toolName]?.({
            toolName,
            input: {},
          }),
        ).toThrow(new RegExp(`${name} skill handler "${toolName}" is not bound`));
      }
    }
  });

  it('keeps Wave A and Wave B foundation skills as a stable registration prefix', () => {
    const reg = new InMemorySkillRegistry();
    const names = registerFoundationSkills(reg);

    expect(names.slice(0, 8)).toEqual([
      'workspace',
      'web',
      'organizations',
      'folders',
      'initiatives',
      'solutions',
      'proposals',
      'products',
    ]);
    expect(FOUNDATION_SKILLS.map((s) => s.metadata.name).slice(0, 8)).toEqual(
      names.slice(0, 8),
    );
    expect(reg.list({ category: 'object' }).map((m) => m.name)).toEqual([
      'organizations',
      'folders',
      'initiatives',
      'solutions',
      'proposals',
      'products',
    ]);
  });

  it('resolves object tools only for allowed workspace types and allowlists', () => {
    const reg = new InMemorySkillRegistry();
    registerFoundationSkills(reg);
    const adapter = createSkillsToolRegistry(reg);

    expect(
      withoutMeta(adapter.resolveTools(buildAuthz({ tenant: { tenantId: 't-1' } })))
        .map((t) => t.name)
        .sort(),
    ).toEqual([
      'initiative_search',
      'web_extract',
      'web_search',
      'workspace_list',
    ]);

    expect(
      withoutMeta(adapter.resolveTools(buildAuthz({ tenant: { tenantId: 't-1', workspaceType: 'code' } })))
        .map((t) => t.name)
        .sort(),
    ).toEqual([
      'initiative_search',
      'web_extract',
      'web_search',
      'workspace_list',
    ]);

    expect(
      adapter
        .resolveTools(
          buildAuthz({
            permissionMode: 'allowlist',
            allowedTools: [
              'organization_get',
              'folder_get',
              'solution_get',
              'proposal_get',
              'product_get',
            ],
          }),
        )
        .map((t) => t.name)
        .sort(),
    ).toEqual([
      'folder_get',
      'organization_get',
      'product_get',
      'proposal_get',
      'solution_get',
      SEARCH_SKILLS_TOOL_NAME,
    ].sort());
  });
});

describe('foundation bundle — Wave C structured skills', () => {
  it('parses every structured skill metadata, tools, body, and handlers', () => {
    for (const { skill, name, tools, bodyTitle, updateTool } of WAVE_C_SKILLS) {
      expect(skill.metadata.name).toBe(name);
      expect(skill.metadata.version).toBe('0.1.0');
      expect(skill.metadata.category).toBe('analysis');
      expect(skill.metadata.contextFilter?.workspaceTypes).toEqual([
        'ai-ideas',
        'opportunity',
      ]);
      expect(skill.metadata.toolNames).toEqual(tools);
      expect(skill.tools.map((t) => t.name)).toEqual(tools);
      expect(skill.body).toContain(bodyTitle);
      expect(Object.keys(skill.handlers ?? {}).sort()).toEqual(
        [...tools].sort(),
      );
      expect(skill.tools.find((tool) => tool.name === updateTool)?.sideEffect).toBe(
        true,
      );
      expect(
        skill.tools.find((tool) => tool.name === updateTool)?.requiresApproval,
      ).toBe(true);
    }
  });

  it('handlers throw a "not bound" error when invoked', () => {
    for (const { skill, name, tools } of WAVE_C_SKILLS) {
      for (const toolName of tools) {
        expect(() =>
          skill.handlers?.[toolName]?.({
            toolName,
            input: {},
          }),
        ).toThrow(new RegExp(`${name} skill handler "${toolName}" is not bound`));
      }
    }
  });

  it('registers Wave A, Wave B, and package-only Wave C foundation skills in stable order', () => {
    const reg = new InMemorySkillRegistry();
    const names = registerFoundationSkills(reg);

    expect(names).toEqual([
      'workspace',
      'web',
      'organizations',
      'folders',
      'initiatives',
      'solutions',
      'proposals',
      'products',
      'executive_summary',
      'matrix',
    ]);
    expect(FOUNDATION_SKILLS.map((s) => s.metadata.name)).toEqual(names);
    expect(reg.list({ category: 'analysis' }).map((m) => m.name)).toEqual([
      'executive_summary',
      'matrix',
    ]);
  });

  it('resolves structured tools only for allowed workspace types and allowlists', () => {
    const reg = new InMemorySkillRegistry();
    registerFoundationSkills(reg);
    const adapter = createSkillsToolRegistry(reg);

    expect(
      withoutMeta(adapter.resolveTools(buildAuthz({ tenant: { tenantId: 't-1' } })))
        .map((t) => t.name)
        .sort(),
    ).toEqual([
      'initiative_search',
      'web_extract',
      'web_search',
      'workspace_list',
    ]);

    expect(
      adapter
        .resolveTools(
          buildAuthz({
            permissionMode: 'allowlist',
            allowedTools: ['executive_summary_get', 'matrix_get'],
          }),
        )
        .map((t) => t.name)
        .sort(),
    ).toEqual(['executive_summary_get', 'matrix_get', SEARCH_SKILLS_TOOL_NAME].sort());
  });
});
