/**
 * search_catalog meta-tool — additive cross-kind catalog discovery (BR-42b Lot 7)
 *
 * Adds a sibling `search_catalog` meta-tool alongside `search_skills`.
 *
 * Design invariants (SPEC_EVOL_CATALOG §3.5):
 *   - `search_skills` is kept UNCHANGED: same name, same output shape
 *     (`SkillSearchHit[]`), same sentinel `__skills__`, skill-only, still FIRST
 *     in the resolved tool array.
 *   - `search_catalog` is the ADDITIVE sibling: cross-kind discovery over ALL
 *     5 entry kinds (skill, tool, agent, workflow, canvas). Each hit carries its
 *     `kind` so the caller can distinguish them.
 *   - The tool name `SEARCH_CATALOG_TOOL_NAME = 'search_catalog'` is stable;
 *     the chat-core dispatcher keys on this literal + sentinel `__catalog__`.
 *   - Renaming `search_skills` is explicitly rejected (breaks the dispatcher
 *     contract).
 *
 * Output shape:
 *   `{ hits: CatalogHit[] }` where each `CatalogHit` is:
 *     `{ kind, name, description, category?, version?, score, matchedFields }`
 *   Kept flat (no full payload) to keep LLM prompt growth bounded.
 *
 * Dispatch:
 *   Dispatched in `foundation-executor.ts` immediately after the `search_skills`
 *   branch (a new hardcoded branch), BEFORE the catalog execution seam.
 *   Uses `compositeCatalogRegistry.search()` from Lot 1.
 */

import type { SkillTool } from '../../../../packages/skills/src/index.js';
import type { ResolvedTool } from '../../../../packages/skills/src/registry/authz.js';

// ---------------------------------------------------------------------------
// Tool name + sentinel constants
// ---------------------------------------------------------------------------

/**
 * Canonical name of the cross-kind catalog meta-tool.
 * Stable contract: the foundation-executor dispatcher keys on this string.
 */
export const SEARCH_CATALOG_TOOL_NAME = 'search_catalog';

/**
 * Synthetic "skill name" used on the `ResolvedTool` descriptor so that the
 * dispatcher can route execution back into the catalog module rather than into
 * any real skill. Uses double-underscore prefix/suffix to avoid collision with
 * real skill names (all kebab-case per `SkillMetadata.name`).
 */
export const SEARCH_CATALOG_SKILL_NAME = '__catalog__';

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 5;

/**
 * JSON Schema for `search_catalog` input. Mirrors the structure of
 * `search_skills` input for consistency. Emitted to the LLM so it can craft
 * well-formed calls.
 */
const SEARCH_CATALOG_INPUT_SCHEMA = {
  type: 'object',
  required: ['query'],
  additionalProperties: false,
  properties: {
    query: {
      type: 'string',
      description:
        'Free-text query matched against capability name, description, and category across all 5 entry kinds (skill, tool, agent, workflow, canvas).',
    },
    limit: {
      type: 'integer',
      minimum: 1,
      maximum: MAX_LIMIT,
      description: `Maximum number of hits to return (default ${DEFAULT_LIMIT}, max ${MAX_LIMIT}).`,
    },
    filter: {
      type: 'object',
      additionalProperties: false,
      properties: {
        kind: {
          type: 'string',
          enum: ['skill', 'tool', 'agent', 'workflow', 'canvas'],
          description:
            'Optional: restrict results to a single entry kind.',
        },
        category: {
          type: 'string',
          description: 'Optional: restrict results to a specific category.',
        },
      },
    },
  },
} as const;

// ---------------------------------------------------------------------------
// Output schema
// ---------------------------------------------------------------------------

/**
 * JSON Schema for the `search_catalog` output: an array of `CatalogHit`-shaped
 * objects, each carrying the entry `kind` + the flat metadata projection used
 * for discovery. Kept flat (no full payload) to bound LLM prompt growth.
 */
const SEARCH_CATALOG_OUTPUT_SCHEMA = {
  type: 'object',
  required: ['hits'],
  additionalProperties: false,
  properties: {
    hits: {
      type: 'array',
      items: {
        type: 'object',
        required: ['kind', 'name', 'description', 'score', 'matchedFields'],
        additionalProperties: false,
        properties: {
          kind: {
            type: 'string',
            enum: ['skill', 'tool', 'agent', 'workflow', 'canvas'],
            description: 'The entry kind discriminant.',
          },
          name: { type: 'string', description: 'Provider-safe public identifier.' },
          description: { type: 'string', description: 'Human-readable description.' },
          category: { type: 'string', description: 'Taxonomy category (when available).' },
          version: { type: 'string', description: 'Version string (when available).' },
          score: { type: 'number', description: 'Relevance score (descending order).' },
          matchedFields: {
            type: 'array',
            items: { enum: ['name', 'description', 'category'] },
            description: 'Fields that contributed to the score.',
          },
        },
      },
    },
  },
} as const;

// ---------------------------------------------------------------------------
// Tool descriptor — `SkillTool` shape (for the resolved-tool conversion)
// ---------------------------------------------------------------------------

/**
 * `SkillTool` descriptor for the `search_catalog` meta-tool.
 * This shape is consumed by `resolvedToolToOpenAIChatTool()` in `catalog.ts`
 * to produce the `ChatCompletionTool` entry in the per-turn tool array.
 */
export const SEARCH_CATALOG_TOOL: SkillTool = {
  name: SEARCH_CATALOG_TOOL_NAME,
  description:
    'Discover capabilities across all catalog kinds (skill, tool, agent, workflow, canvas). Returns the top-K entries ranked by relevance. Use this when you need to find capabilities beyond skills — e.g. available workflow templates, agent configurations, or canvas templates.',
  inputSchema: SEARCH_CATALOG_INPUT_SCHEMA as unknown as Record<string, unknown>,
  outputSchema: SEARCH_CATALOG_OUTPUT_SCHEMA as unknown as Record<string, unknown>,
  sideEffect: false,
  requiresApproval: false,
};

// ---------------------------------------------------------------------------
// ResolvedTool descriptor — injected into resolveFoundationChatTools()
// ---------------------------------------------------------------------------

/**
 * Pre-built `ResolvedTool` descriptor used by `catalog.ts` to inject
 * `search_catalog` into every `resolveFoundationChatTools()` response,
 * immediately after `search_skills` (position index 1).
 *
 * The `skillName` sentinel `__catalog__` lets the foundation-executor
 * identify this meta-tool without a string comparison on the tool name.
 */
export const SEARCH_CATALOG_RESOLVED_TOOL: ResolvedTool = {
  name: SEARCH_CATALOG_TOOL.name,
  description: SEARCH_CATALOG_TOOL.description,
  inputSchema: SEARCH_CATALOG_TOOL.inputSchema as Record<string, unknown>,
  outputSchema: SEARCH_CATALOG_TOOL.outputSchema as Record<string, unknown>,
  skillName: SEARCH_CATALOG_SKILL_NAME,
  sideEffect: false,
  requiresApproval: false,
};

// ---------------------------------------------------------------------------
// Input / output types (consumed by the dispatcher in foundation-executor.ts)
// ---------------------------------------------------------------------------

/**
 * Parsed input for `search_catalog`. The dispatcher validates the args shape
 * before calling `executeSearchCatalog`.
 */
export interface SearchCatalogInput {
  readonly query: string;
  readonly limit?: number;
  readonly filter?: {
    readonly kind?: string;
    readonly category?: string;
  };
}

/**
 * A single flat hit returned by `search_catalog`.
 *
 * Only the shared metadata fields are surfaced — no full per-kind payload —
 * to keep the LLM prompt bounded. The caller can use the returned `name` + `kind`
 * to fetch the full entry via a follow-up catalog operation if needed.
 */
export interface CatalogHit {
  readonly kind: string;
  readonly name: string;
  readonly description: string;
  readonly category?: string;
  readonly version?: string;
  readonly score: number;
  readonly matchedFields: string[];
}

/**
 * Result shape returned by `executeSearchCatalog`.
 * Mirrors `search_skills` result convention: `{ status, hits }`.
 */
export interface SearchCatalogResult {
  readonly status: 'completed';
  readonly hits: CatalogHit[];
}
