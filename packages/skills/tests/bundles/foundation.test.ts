import { describe, expect, it } from 'vitest';

import { InMemorySkillRegistry } from '../../src/registry/registry.js';
import { createSkillsToolRegistry } from '../../src/registry/adapter.js';
import {
  FOUNDATION_SKILLS,
  commentAssistantSkill,
  documentGenerateSkill,
  documentsSkill,
  executiveSummarySkill,
  foldersSkill,
  gateReviewSkill,
  historyAnalyzeSkill,
  initiativesSkill,
  matrixSkill,
  organizationsSkill,
  planSkill,
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
    workspaceTypes: ['ai-ideas', 'opportunity'],
    updateTool: 'executive_summary_update',
  },
  {
    skill: matrixSkill,
    name: 'matrix',
    tools: ['matrix_get', 'matrix_update'],
    bodyTitle: 'Matrix skill',
    workspaceTypes: ['ai-ideas', 'opportunity'],
    updateTool: 'matrix_update',
  },
  {
    skill: historyAnalyzeSkill,
    name: 'history_analyze',
    tools: ['history_analyze'],
    bodyTitle: 'History analyze skill',
  },
  {
    skill: gateReviewSkill,
    name: 'gate_review',
    tools: ['gate_review'],
    bodyTitle: 'Gate review skill',
    workspaceTypes: ['ai-ideas', 'opportunity'],
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
  'history_analyze',
  'gate_review',
  'documents',
  'comment_assistant',
  'plan',
  'document_generate',
] as const;

const FOUNDATION_TOOL_NAMES = [
  'comment_assistant',
  'document_generate',
  'documents',
  'executive_summary_get',
  'executive_summary_update',
  'folder_get',
  'folder_update',
  'folders_list',
  'initiative_search',
  'initiatives_list',
  'history_analyze',
  'matrix_get',
  'matrix_update',
  'organization_get',
  'organization_update',
  'organizations_list',
  'plan',
  'product_get',
  'products_list',
  'proposal_get',
  'proposals_list',
  'read_initiative',
  'solution_get',
  'solutions_list',
  'update_initiative',
  'gate_review',
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
      'comment_assistant',
      'document_generate',
      'documents',
      'history_analyze',
      'initiative_search',
      'plan',
      'web_extract',
      'web_search',
      'workspace_list',
    ]);

    expect(
      withoutMeta(adapter.resolveTools(buildAuthz({ tenant: { tenantId: 't-1', workspaceType: 'code' } })))
        .map((t) => t.name)
        .sort(),
    ).toEqual([
      'comment_assistant',
      'document_generate',
      'documents',
      'history_analyze',
      'initiative_search',
      'plan',
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
    for (const {
      skill,
      name,
      tools,
      bodyTitle,
      workspaceTypes,
      updateTool,
    } of WAVE_C_SKILLS) {
      expect(skill.metadata.name).toBe(name);
      expect(skill.metadata.version).toBe('0.1.0');
      expect(skill.metadata.category).toBe('analysis');
      if (workspaceTypes) {
        expect(skill.metadata.contextFilter?.workspaceTypes).toEqual(workspaceTypes);
      } else {
        expect(skill.metadata.contextFilter).toBeUndefined();
      }
      expect(skill.metadata.toolNames).toEqual(tools);
      expect(skill.tools.map((t) => t.name)).toEqual(tools);
      expect(skill.body).toContain(bodyTitle);
      expect(Object.keys(skill.handlers ?? {}).sort()).toEqual(
        [...tools].sort(),
      );
      if (updateTool) {
        expect(skill.tools.find((tool) => tool.name === updateTool)?.sideEffect).toBe(
          true,
        );
        expect(
          skill.tools.find((tool) => tool.name === updateTool)?.requiresApproval,
        ).toBe(true);
      } else {
        for (const toolName of tools) {
          const tool = skill.tools.find((candidate) => candidate.name === toolName);
          expect(tool?.sideEffect).not.toBe(true);
          expect(tool?.requiresApproval).not.toBe(true);
        }
      }
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

  it('registers Wave A, Wave B, and package-only Wave C step 1+2 foundation skills as a stable prefix', () => {
    const reg = new InMemorySkillRegistry();
    const names = registerFoundationSkills(reg);

    expect(names.slice(0, 12)).toEqual([
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
      'history_analyze',
      'gate_review',
    ]);
    expect(FOUNDATION_SKILLS.map((s) => s.metadata.name)).toEqual(names);
    expect(reg.list({ category: 'analysis' }).map((m) => m.name)).toEqual([
      'executive_summary',
      'matrix',
      'history_analyze',
      'gate_review',
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
      'comment_assistant',
      'document_generate',
      'documents',
      'history_analyze',
      'initiative_search',
      'plan',
      'web_extract',
      'web_search',
      'workspace_list',
    ]);

    expect(
      adapter
        .resolveTools(
          buildAuthz({
            tenant: { tenantId: 't-1', workspaceType: 'opportunity' },
            permissionMode: 'allowlist',
            allowedTools: [
              'executive_summary_get',
              'matrix_get',
              'history_analyze',
              'gate_review',
            ],
          }),
        )
        .map((t) => t.name)
        .sort(),
    ).toEqual([
      'executive_summary_get',
      'matrix_get',
      'history_analyze',
      'gate_review',
      SEARCH_SKILLS_TOOL_NAME,
    ].sort());
  });
});

describe('foundation bundle — Wave C step 3 content/action skills', () => {
  describe('documents skill', () => {
    it('parses SKILL.md metadata, tools, body, and handlers', () => {
      expect(documentsSkill.metadata.name).toBe('documents');
      expect(documentsSkill.metadata.version).toBe('0.1.0');
      expect(documentsSkill.metadata.category).toBe('content');
      expect(documentsSkill.metadata.contextFilter).toBeUndefined();
      expect(documentsSkill.metadata.toolNames).toEqual(['documents']);
      expect(documentsSkill.tools.map((t) => t.name)).toEqual(['documents']);
      expect(documentsSkill.body).toContain('Documents skill');
      expect(Object.keys(documentsSkill.handlers ?? {})).toEqual(['documents']);
    });

    it('declares the unified documents inputSchema with required action/contextType/contextId', () => {
      const [tool] = documentsSkill.tools;
      expect(tool?.inputSchema?.required).toEqual(['action', 'contextType', 'contextId']);
      const props = (tool?.inputSchema as { properties?: Record<string, { enum?: string[] }> })
        ?.properties;
      expect(props?.action?.enum).toEqual(['list', 'get_summary', 'get_content', 'analyze']);
      expect(props?.contextType?.enum).toEqual([
        'organization',
        'folder',
        'initiative',
        'chat_session',
      ]);
      expect(tool?.sideEffect).toBeUndefined();
      expect(tool?.requiresApproval).toBeUndefined();
    });

    it('handlers throw a "not bound" error when invoked', () => {
      expect(() =>
        documentsSkill.handlers?.documents?.({
          toolName: 'documents',
          input: { action: 'list', contextType: 'folder', contextId: 'f-1' },
        }),
      ).toThrow(/documents skill handler "documents" is not bound/);
    });
  });

  describe('comment_assistant skill', () => {
    it('parses SKILL.md metadata, tools, body, and handlers', () => {
      expect(commentAssistantSkill.metadata.name).toBe('comment_assistant');
      expect(commentAssistantSkill.metadata.version).toBe('0.1.0');
      expect(commentAssistantSkill.metadata.category).toBe('workflow');
      expect(commentAssistantSkill.metadata.contextFilter).toBeUndefined();
      expect(commentAssistantSkill.metadata.toolNames).toEqual(['comment_assistant']);
      expect(commentAssistantSkill.tools.map((t) => t.name)).toEqual(['comment_assistant']);
      expect(commentAssistantSkill.body).toContain('Comment assistant skill');
      expect(Object.keys(commentAssistantSkill.handlers ?? {})).toEqual([
        'comment_assistant',
      ]);
    });

    it('declares the suggest/resolve inputSchema with required mode/contextType/contextId', () => {
      const [tool] = commentAssistantSkill.tools;
      expect(tool?.inputSchema?.required).toEqual(['mode', 'contextType', 'contextId']);
      const props = (tool?.inputSchema as { properties?: Record<string, { enum?: string[] }> })
        ?.properties;
      expect(props?.mode?.enum).toEqual(['suggest', 'resolve']);
      expect(props?.contextType?.enum).toEqual([
        'organization',
        'folder',
        'initiative',
        'matrix',
        'executive_summary',
      ]);
      expect(tool?.sideEffect).toBeUndefined();
      expect(tool?.requiresApproval).toBeUndefined();
    });

    it('handlers throw a "not bound" error when invoked', () => {
      expect(() =>
        commentAssistantSkill.handlers?.comment_assistant?.({
          toolName: 'comment_assistant',
          input: { mode: 'suggest', contextType: 'folder', contextId: 'f-1' },
        }),
      ).toThrow(/comment_assistant skill handler "comment_assistant" is not bound/);
    });
  });

  describe('plan skill', () => {
    it('parses SKILL.md metadata, tools, body, and handlers', () => {
      expect(planSkill.metadata.name).toBe('plan');
      expect(planSkill.metadata.version).toBe('0.1.0');
      expect(planSkill.metadata.category).toBe('workflow');
      expect(planSkill.metadata.contextFilter).toBeUndefined();
      expect(planSkill.metadata.toolNames).toEqual(['plan']);
      expect(planSkill.tools.map((t) => t.name)).toEqual(['plan']);
      expect(planSkill.body).toContain('Plan skill');
      expect(Object.keys(planSkill.handlers ?? {})).toEqual(['plan']);
    });

    it('declares the create/update_plan/update_task inputSchema with required action', () => {
      const [tool] = planSkill.tools;
      expect(tool?.inputSchema?.required).toEqual(['action']);
      const props = (tool?.inputSchema as { properties?: Record<string, { enum?: string[] }> })
        ?.properties;
      expect(props?.action?.enum).toEqual(['create', 'update_plan', 'update_task']);
      expect(props?.status?.enum).toEqual([
        'todo',
        'planned',
        'in_progress',
        'blocked',
        'done',
        'deferred',
        'cancelled',
      ]);
      expect(tool?.sideEffect).toBeUndefined();
      expect(tool?.requiresApproval).toBeUndefined();
    });

    it('handlers throw a "not bound" error when invoked', () => {
      expect(() =>
        planSkill.handlers?.plan?.({
          toolName: 'plan',
          input: { action: 'create', planTitle: 'My checklist' },
        }),
      ).toThrow(/plan skill handler "plan" is not bound/);
    });
  });

  it('appends step 3 skills after Wave A/B/C step 1+2 and exposes them cross-workspace', () => {
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
      'history_analyze',
      'gate_review',
      'documents',
      'comment_assistant',
      'plan',
      'document_generate',
    ]);
    expect(FOUNDATION_SKILLS.map((s) => s.metadata.name)).toEqual(names);
    expect(reg.list({ category: 'content' }).map((m) => m.name)).toEqual(['documents']);
    expect(reg.list({ category: 'workflow' }).map((m) => m.name)).toEqual([
      'workspace',
      'comment_assistant',
      'plan',
    ]);

    const adapter = createSkillsToolRegistry(reg);
    const baseTools = withoutMeta(adapter.resolveTools(buildAuthz({ tenant: { tenantId: 't-1' } })))
      .map((t) => t.name)
      .sort();
    expect(baseTools).toContain('documents');
    expect(baseTools).toContain('comment_assistant');
    expect(baseTools).toContain('plan');
    expect(baseTools).toContain('document_generate');
  });

  describe('document_generate skill (Wave D step 1.A)', () => {
    it('parses SKILL.md metadata, tools, body, and bound handler', () => {
      expect(documentGenerateSkill.metadata.name).toBe('document_generate');
      expect(documentGenerateSkill.metadata.version).toBe('0.1.0');
      expect(documentGenerateSkill.metadata.category).toBe('document');
      expect(documentGenerateSkill.metadata.contextFilter).toBeUndefined();
      expect(documentGenerateSkill.metadata.toolNames).toEqual(['document_generate']);
      expect(documentGenerateSkill.tools.map((t) => t.name)).toEqual(['document_generate']);
      expect(documentGenerateSkill.body).toContain('Document generate skill');
      expect(Object.keys(documentGenerateSkill.handlers ?? {})).toEqual([
        'document_generate',
      ]);
    });

    it('declares the documentGenerateTool schema with required action and dual-mode mutex', () => {
      const [tool] = documentGenerateSkill.tools;
      expect(tool?.inputSchema?.required).toEqual(['action']);
      const props = (tool?.inputSchema as { properties?: Record<string, { enum?: string[] }> })
        ?.properties;
      expect(props?.action?.enum).toEqual(['upskill', 'generate']);
      expect(props?.format?.enum).toEqual(['docx', 'pptx']);
      expect(props?.entityType?.enum).toEqual(['initiative', 'folder']);
      expect(tool?.sideEffect).toBe(true);
      expect(tool?.requiresApproval).toBe(false);
    });

    it('declares the freeform-DOCX sandbox policy in metadata', () => {
      expect(documentGenerateSkill.metadata.sandbox?.surface).toEqual(['files.create']);
      expect(documentGenerateSkill.metadata.sandbox?.timeoutMs).toBe(30000);
      expect(documentGenerateSkill.metadata.sandbox?.memoryMb).toBe(128);
    });
  });
});
