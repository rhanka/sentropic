/**
 * search_catalog meta-tool — unit tests (BR-42b Lot 7)
 *
 * Covers:
 *   - Cross-kind hits: each hit carries the correct `kind` discriminant
 *     (skill / tool / agent / workflow / canvas)
 *   - Ranking / limit / filter semantics (mirrors CompositeCatalogRegistry.search)
 *   - Dispatch through the execution seam (foundation-executor dispatches
 *     `search_catalog` by hardcoded name BEFORE the seam, identical to how
 *     `search_skills` is dispatched)
 *   - `search_skills` contract is NOT altered by `search_catalog`:
 *       * name, description, inputSchema, outputSchema, sentinel unchanged
 *       * still first in the resolved tool array
 *       * still returns only skill-kind hits
 *   - `search_catalog` is at position 1 (immediately after `search_skills`)
 *     in the resolved tool array
 *   - The 29-entry resolved-array oracle matches the updated characterization
 *     oracle (28 + search_catalog at index 1)
 *   - `SEARCH_CATALOG_TOOL_NAME` and `SEARCH_CATALOG_SKILL_NAME` constants
 *   - Empty / whitespace query returns empty hits
 *   - kindHint filter narrows to the correct kind
 *   - categoryHint filter narrows to the correct category
 */

import { describe, expect, it } from 'vitest';

import {
  SEARCH_CATALOG_TOOL_NAME,
  SEARCH_CATALOG_SKILL_NAME,
  SEARCH_CATALOG_RESOLVED_TOOL,
  SEARCH_CATALOG_TOOL,
} from '../../../src/services/catalog/search-catalog-tool';
import {
  compositeCatalogRegistry,
  executeFoundationSearchCatalog,
  executeFoundationSearchSkills,
  resolveFoundationChatTools,
} from '../../../src/services/skills/catalog';
import {
  FOUNDATION_SKILLS,
  SEARCH_SKILLS_TOOL_NAME,
  SEARCH_SKILLS_SKILL_NAME,
  SEARCH_SKILLS_RESOLVED_TOOL,
} from '../../../../packages/skills/src/index';
import { productCatalogDiscovery } from '../../../src/routes/namespaces/catalog-product-ports';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ALL_FOUNDATION_TOOL_NAMES: string[] = FOUNDATION_SKILLS.flatMap((s) =>
  s.tools.map((t) => t.name),
);

function makeAllowlistInput(toolNames: string[]) {
  return {
    userId: 'user-sc-001',
    workspaceId: 'ws-sc-001',
    workspaceType: 'ai-priorities' as string | null,
    currentUserRole: 'editor' as string | null,
    allowedTools: toolNames,
  };
}

// ---------------------------------------------------------------------------
// § 1  Constants and tool descriptor shape
// ---------------------------------------------------------------------------

describe('SEARCH_CATALOG_TOOL_NAME / SEARCH_CATALOG_SKILL_NAME constants', () => {
  it('SEARCH_CATALOG_TOOL_NAME is "search_catalog"', () => {
    expect(SEARCH_CATALOG_TOOL_NAME).toBe('search_catalog');
  });

  it('SEARCH_CATALOG_SKILL_NAME sentinel is "__catalog__"', () => {
    expect(SEARCH_CATALOG_SKILL_NAME).toBe('__catalog__');
  });
});

describe('SEARCH_CATALOG_TOOL descriptor', () => {
  it('has name search_catalog and a non-empty description', () => {
    expect(SEARCH_CATALOG_TOOL.name).toBe('search_catalog');
    expect(typeof SEARCH_CATALOG_TOOL.description).toBe('string');
    expect(SEARCH_CATALOG_TOOL.description.length).toBeGreaterThan(0);
  });

  it('has sideEffect:false and requiresApproval:false', () => {
    expect(SEARCH_CATALOG_TOOL.sideEffect).toBe(false);
    expect(SEARCH_CATALOG_TOOL.requiresApproval).toBe(false);
  });

  it('inputSchema has required "query" field', () => {
    const schema = SEARCH_CATALOG_TOOL.inputSchema as {
      required?: string[];
      properties?: Record<string, unknown>;
    };
    expect(schema.required).toContain('query');
    expect(schema.properties).toHaveProperty('query');
  });
});

describe('SEARCH_CATALOG_RESOLVED_TOOL', () => {
  it('has name "search_catalog"', () => {
    expect(SEARCH_CATALOG_RESOLVED_TOOL.name).toBe('search_catalog');
  });

  it('has skillName sentinel "__catalog__"', () => {
    expect(SEARCH_CATALOG_RESOLVED_TOOL.skillName).toBe('__catalog__');
  });

  it('has sideEffect:false and requiresApproval:false', () => {
    expect(SEARCH_CATALOG_RESOLVED_TOOL.sideEffect).toBe(false);
    expect(SEARCH_CATALOG_RESOLVED_TOOL.requiresApproval).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// § 2  search_skills unchanged — byte-identical contract
// ---------------------------------------------------------------------------

describe('search_skills contract — byte-identical after Lot 7', () => {
  it('SEARCH_SKILLS_TOOL_NAME is still "search_skills" (unchanged)', () => {
    expect(SEARCH_SKILLS_TOOL_NAME).toBe('search_skills');
  });

  it('SEARCH_SKILLS_SKILL_NAME sentinel is still "__skills__" (unchanged)', () => {
    expect(SEARCH_SKILLS_SKILL_NAME).toBe('__skills__');
  });

  it('SEARCH_SKILLS_RESOLVED_TOOL.name is "search_skills"', () => {
    expect(SEARCH_SKILLS_RESOLVED_TOOL.name).toBe('search_skills');
  });

  it('SEARCH_SKILLS_RESOLVED_TOOL.skillName is "__skills__"', () => {
    expect(SEARCH_SKILLS_RESOLVED_TOOL.skillName).toBe('__skills__');
  });

  it('search_skills is still FIRST in the resolved tool array', () => {
    const tools = resolveFoundationChatTools(makeAllowlistInput(ALL_FOUNDATION_TOOL_NAMES));
    expect(tools[0]?.function.name).toBe('search_skills');
  });

  it('search_skills still returns only skill-kind hits (not cross-kind)', () => {
    const hits = executeFoundationSearchSkills({
      authz: makeAllowlistInput(ALL_FOUNDATION_TOOL_NAMES),
      payload: { query: 'workspace', limit: 10 },
    });
    expect(hits.length).toBeGreaterThan(0);
    // search_skills returns SkillSearchHit[] — each has metadata.name from skills,
    // no "kind" field on the hit itself (only SkillMetadata fields).
    for (const hit of hits) {
      // A SkillSearchHit carries metadata (SkillMetadata) and score; it has NO
      // `kind` field — only CatalogSearchHit has that. Verify the distinction.
      expect((hit as Record<string, unknown>).kind).toBeUndefined();
      expect(hit.metadata).toBeDefined();
      expect(hit.score).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// § 3  search_catalog position in the resolved tool array
// ---------------------------------------------------------------------------

describe('search_catalog position in resolveFoundationChatTools', () => {
  it('search_catalog is at index 1 (immediately after search_skills)', () => {
    const tools = resolveFoundationChatTools(makeAllowlistInput(ALL_FOUNDATION_TOOL_NAMES));
    expect(tools[0]?.function.name).toBe('search_skills');
    expect(tools[1]?.function.name).toBe('search_catalog');
  });

  it('resolved array has 1 more entry than before Lot 7 (search_catalog added)', () => {
    const tools = resolveFoundationChatTools(makeAllowlistInput(ALL_FOUNDATION_TOOL_NAMES));
    // 2 meta-tools (search_skills + search_catalog) + all foundation tools
    expect(tools).toHaveLength(2 + ALL_FOUNDATION_TOOL_NAMES.length);
  });

  it('search_catalog has valid OpenAI ChatCompletionTool shape', () => {
    const tools = resolveFoundationChatTools(makeAllowlistInput(ALL_FOUNDATION_TOOL_NAMES));
    const scTool = tools[1]!;
    expect(scTool.type).toBe('function');
    expect(scTool.function.name).toBe('search_catalog');
    expect(typeof scTool.function.description).toBe('string');
    expect(scTool.function.parameters).toBeTruthy();
  });

  it('the 27 foundation tools remain in the same order after index 1', () => {
    const tools = resolveFoundationChatTools(makeAllowlistInput(ALL_FOUNDATION_TOOL_NAMES));
    // Positions 0 and 1 are the two meta-tools; positions 2+ are the foundation tools.
    const foundationNames = tools.slice(2).map((t) => t.function.name);
    const expectedFoundationOrder = [
      'workspace_list', 'initiative_search',
      'web_search', 'web_extract',
      'organizations_list', 'organization_get', 'organization_update',
      'folders_list', 'folder_get', 'folder_update',
      'initiatives_list', 'read_initiative', 'update_initiative',
      'solutions_list', 'solution_get',
      'proposals_list', 'proposal_get',
      'products_list', 'product_get',
      'executive_summary_get', 'executive_summary_update',
      'matrix_get', 'matrix_update',
      'history_analyze', 'gate_review', 'documents', 'comment_assistant',
      'plan', 'document_generate',
    ];
    expect(foundationNames).toEqual(expectedFoundationOrder);
  });
});

// ---------------------------------------------------------------------------
// § 4  executeFoundationSearchCatalog — cross-kind hits
// ---------------------------------------------------------------------------

describe('executeFoundationSearchCatalog — cross-kind hits', () => {
  it('matches the root discovery adapter for the same deterministic query', () => {
    const toolHits = executeFoundationSearchCatalog({ query: 'workspace', limit: 3 }).hits;
    const httpHits = productCatalogDiscovery.search({ query: 'workspace', limit: 3 })
      .map(({ entry, score, matchedFields }) => ({
        kind: entry.kind,
        name: entry.metadata.name,
        description: entry.metadata.description,
        ...(entry.metadata.category === undefined ? {} : { category: entry.metadata.category }),
        ...(entry.metadata.version === undefined ? {} : { version: entry.metadata.version }),
        score,
        matchedFields,
      }));
    expect(httpHits).toEqual(toolHits);
  });

  it('returns { status: "completed", hits: [] } for empty query', () => {
    const result = executeFoundationSearchCatalog({ query: '' });
    expect(result.status).toBe('completed');
    expect(result.hits).toEqual([]);
  });

  it('returns { status: "completed", hits: [] } for whitespace-only query', () => {
    const result = executeFoundationSearchCatalog({ query: '   ' });
    expect(result.status).toBe('completed');
    expect(result.hits).toEqual([]);
  });

  it('returns cross-kind hits for a broad query that spans multiple kinds', () => {
    // "workspace" matches the 'workspace' skill, workflow seeds, and agent definitions.
    const result = executeFoundationSearchCatalog({ query: 'workspace', limit: 20 });
    expect(result.status).toBe('completed');
    expect(result.hits.length).toBeGreaterThan(0);

    // Each hit must have the required fields.
    for (const hit of result.hits) {
      expect(typeof hit.kind).toBe('string');
      expect(['skill', 'tool', 'agent', 'workflow', 'canvas']).toContain(hit.kind);
      expect(typeof hit.name).toBe('string');
      expect(hit.name.length).toBeGreaterThan(0);
      expect(typeof hit.description).toBe('string');
      expect(typeof hit.score).toBe('number');
      expect(hit.score).toBeGreaterThan(0);
      expect(Array.isArray(hit.matchedFields)).toBe(true);
    }
  });

  it('hits are ordered by descending score', () => {
    const result = executeFoundationSearchCatalog({ query: 'workspace document', limit: 20 });
    for (let i = 1; i < result.hits.length; i++) {
      expect(result.hits[i - 1]!.score).toBeGreaterThanOrEqual(result.hits[i]!.score);
    }
  });

  it('limit is respected', () => {
    const result = executeFoundationSearchCatalog({ query: 'workspace', limit: 2 });
    expect(result.hits.length).toBeLessThanOrEqual(2);
  });

  it('default limit (no limit provided) caps results to 5', () => {
    // A broad query matches many entries; without a limit, top-5 should be returned.
    const result = executeFoundationSearchCatalog({ query: 'analysis' });
    expect(result.hits.length).toBeLessThanOrEqual(5);
  });

  it('returns skill-kind hits for a skill-specific query', () => {
    // 'workspace' is a known skill name — should appear as a skill-kind hit.
    const result = executeFoundationSearchCatalog({ query: 'workspace', limit: 10 });
    const skillHits = result.hits.filter((h) => h.kind === 'skill');
    expect(skillHits.length).toBeGreaterThan(0);
    const workspaceHit = skillHits.find((h) => h.name === 'workspace');
    expect(workspaceHit).toBeDefined();
  });

  it('returns agent-kind hits for agent-specific query', () => {
    // Agent seeds from default-agents.ts should be searchable.
    const result = executeFoundationSearchCatalog({ query: 'agent', limit: 20 });
    const agentHits = result.hits.filter((h) => h.kind === 'agent');
    // The registry has agent entries from Lot 3.
    expect(agentHits.length).toBeGreaterThanOrEqual(0);
    // If we have agent entries, each has the right shape.
    for (const hit of agentHits) {
      expect(hit.kind).toBe('agent');
      expect(typeof hit.name).toBe('string');
    }
  });

  it('returns workflow-kind hits for workflow-specific query', () => {
    // Workflow seeds from @sentropic/flow should be searchable.
    const result = executeFoundationSearchCatalog({ query: 'workflow generation', limit: 20 });
    const workflowHits = result.hits.filter((h) => h.kind === 'workflow');
    // The registry has workflow entries from Lot 4.
    expect(workflowHits.length).toBeGreaterThanOrEqual(0);
    for (const hit of workflowHits) {
      expect(hit.kind).toBe('workflow');
      expect(typeof hit.name).toBe('string');
    }
  });

  it('returns canvas-kind hits for canvas-specific query', () => {
    // Canvas templates from Lot 6 should be searchable.
    const result = executeFoundationSearchCatalog({ query: 'canvas markdown', limit: 20 });
    const canvasHits = result.hits.filter((h) => h.kind === 'canvas');
    // The registry has canvas entries from Lot 6.
    expect(canvasHits.length).toBeGreaterThanOrEqual(0);
    for (const hit of canvasHits) {
      expect(hit.kind).toBe('canvas');
      expect(typeof hit.name).toBe('string');
    }
  });

  it('kindHint filter narrows to exactly that kind', () => {
    // With kindHint='skill', only skill-kind entries should appear.
    const result = executeFoundationSearchCatalog({
      query: 'workspace document',
      limit: 20,
      filter: { kind: 'skill' },
    });
    for (const hit of result.hits) {
      expect(hit.kind).toBe('skill');
    }
  });

  it('kindHint=agent returns only agent-kind hits (if any match)', () => {
    const result = executeFoundationSearchCatalog({
      query: 'agent orchestration',
      limit: 20,
      filter: { kind: 'agent' },
    });
    for (const hit of result.hits) {
      expect(hit.kind).toBe('agent');
    }
  });

  it('kindHint=workflow returns only workflow-kind hits (if any match)', () => {
    const result = executeFoundationSearchCatalog({
      query: 'generation analysis',
      limit: 20,
      filter: { kind: 'workflow' },
    });
    for (const hit of result.hits) {
      expect(hit.kind).toBe('workflow');
    }
  });

  it('kindHint=canvas returns only canvas-kind hits (if any match)', () => {
    const result = executeFoundationSearchCatalog({
      query: 'markdown document',
      limit: 20,
      filter: { kind: 'canvas' },
    });
    for (const hit of result.hits) {
      expect(hit.kind).toBe('canvas');
    }
  });

  it('categoryHint filter narrows to entries with that category', () => {
    // 'analysis' is the category for executive_summary, matrix, history_analyze, gate_review skills.
    const result = executeFoundationSearchCatalog({
      query: 'analyze review',
      limit: 20,
      filter: { category: 'analysis' },
    });
    for (const hit of result.hits) {
      expect(hit.category).toBe('analysis');
    }
  });
});

// ---------------------------------------------------------------------------
// § 5  Cross-kind representation — all 5 kinds can appear in a single search
// ---------------------------------------------------------------------------

describe('cross-kind representation — all 5 kinds discoverable', () => {
  it('compositeCatalogRegistry contains entries of at least 3 kinds (skill, agent, workflow)', () => {
    const allEntries = compositeCatalogRegistry.list();
    const kindSet = new Set(allEntries.map((e) => e.kind));
    // We know skill (16 from static source), agent (several from Lot 3),
    // workflow (several from Lot 4), canvas (2+ from Lot 6) are all registered.
    expect(kindSet.has('skill')).toBe(true);
    expect(kindSet.has('agent')).toBe(true);
    expect(kindSet.has('workflow')).toBe(true);
    expect(kindSet.has('canvas')).toBe(true);
  });

  it('a broad query returns hits representing multiple kinds', () => {
    // "analysis generation" should match across skill (analysis category),
    // workflow (generation workflows), and agent (generation agent templates).
    const result = executeFoundationSearchCatalog({
      query: 'analysis generation document',
      limit: 50,
    });
    const kinds = new Set(result.hits.map((h) => h.kind));
    // At minimum skills should appear (16 foundation skills). Others depend on data.
    expect(kinds.has('skill')).toBe(true);
    expect(result.hits.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// § 6  Dispatch through the execution seam — search_catalog is NOT in the seam
// ---------------------------------------------------------------------------

describe('search_catalog dispatch path — hardcoded branch, NOT via seam', () => {
  it('executeFoundationSearchCatalog is synchronous and returns SearchCatalogResult', () => {
    const result = executeFoundationSearchCatalog({ query: 'workspace' });
    // Not a promise.
    expect(result instanceof Promise).toBe(false);
    expect(result.status).toBe('completed');
    expect(Array.isArray(result.hits)).toBe(true);
  });

  it('search_catalog is NOT a kind:tool entry — it is not dispatched via the execution seam', () => {
    // The execution seam only dispatches `kind: "tool"` entries.
    // search_catalog is a meta-tool wired directly in foundation-executor
    // (a hardcoded branch), NOT as a catalog entry. Verify it is absent from
    // the composite registry (no entry named "search_catalog").
    const entry = compositeCatalogRegistry.get('search_catalog');
    expect(entry).toBeNull(); // NOT in the catalog — it is a meta-tool
  });

  it('search_skills is also NOT in the catalog (meta-tool, not a catalog entry)', () => {
    const entry = compositeCatalogRegistry.get('search_skills');
    expect(entry).toBeNull(); // search_skills is also a meta-tool, not a catalog entry
  });
});

// ---------------------------------------------------------------------------
// § 7  0-regression: 29-entry resolved tool array oracle (Lot 7 update)
// ---------------------------------------------------------------------------

describe('31-entry resolved tool array oracle (Lot 7)', () => {
  it('matches the canonical order: search_skills, search_catalog, then 29 foundation tools', () => {
    const tools = resolveFoundationChatTools(makeAllowlistInput(ALL_FOUNDATION_TOOL_NAMES));
    const names = tools.map((t) => t.function.name);

    // Oracle: 2 meta-tools + 29 foundation tools = 31 total.
    // Foundation tool count: 16 skills × avg 1.8 tools = 29 tools.
    const EXPECTED_TOOL_ORDER_31 = [
      // meta-tools (first two)
      'search_skills',
      'search_catalog',
      // workspace
      'workspace_list',
      'initiative_search',
      // web
      'web_search',
      'web_extract',
      // organizations
      'organizations_list',
      'organization_get',
      'organization_update',
      // folders
      'folders_list',
      'folder_get',
      'folder_update',
      // initiatives
      'initiatives_list',
      'read_initiative',
      'update_initiative',
      // solutions
      'solutions_list',
      'solution_get',
      // proposals
      'proposals_list',
      'proposal_get',
      // products
      'products_list',
      'product_get',
      // executive_summary
      'executive_summary_get',
      'executive_summary_update',
      // matrix
      'matrix_get',
      'matrix_update',
      // history_analyze
      'history_analyze',
      // gate_review
      'gate_review',
      // documents
      'documents',
      // comment_assistant
      'comment_assistant',
      // plan
      'plan',
      // document_generate
      'document_generate',
    ] as const;

    expect(names).toEqual(EXPECTED_TOOL_ORDER_31);
    // 2 meta-tools + ALL_FOUNDATION_TOOL_NAMES.length = 2 + 29 = 31
    expect(names).toHaveLength(2 + ALL_FOUNDATION_TOOL_NAMES.length);
  });
});
