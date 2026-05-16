import type { SkillRegistry, SkillSearchOptions } from './registry.js';
import type { SkillSearchHit } from '../types/skill-search-hit.js';
import type { SkillTool } from '../types/skill-tool.js';
import type { AuthzContext, ResolvedTool } from './authz.js';
import { isSkillVisibleTo } from './resolve.js';

/**
 * Canonical name of the meta-tool. Stable contract: agents and the chat-core
 * dispatcher key on this exact string.
 */
export const SEARCH_SKILLS_TOOL_NAME = 'search_skills';

/**
 * Synthetic "skill name" reported on the `ResolvedTool` descriptor for the
 * meta-tool. The dispatcher recognises this sentinel to route execution back
 * into the `SkillsToolRegistry` itself rather than into a user-registered
 * skill. Prefixed/suffixed with double-underscore to avoid collision with
 * real skill names (which are kebab-case per `SkillMetadata.name`).
 */
export const SEARCH_SKILLS_SKILL_NAME = '__skills__';

/** Hard upper bound on the `limit` accepted by the meta-tool. */
const MAX_LIMIT = 50;

/** Default `limit` when the caller does not provide one. */
const DEFAULT_LIMIT = 5;

/**
 * Input payload accepted by `search_skills`. Validated structurally before
 * being forwarded to `SkillRegistry.search()`.
 */
export interface SearchSkillsInput {
  /** Natural-language query (free text). Required. */
  readonly query: string;
  /**
   * Maximum number of hits to return. Defaults to 5; capped at 50 to keep
   * LLM prompt growth bounded.
   */
  readonly limit?: number;
  /** Optional pre-ranking filter. */
  readonly filter?: SearchSkillsFilter;
}

/**
 * Pre-ranking filter mirroring `SkillListFilter` minus `workspaceType` (which
 * is already enforced by `AuthzContext`). Tags and roles are surfaced here so
 * an agent can narrow discovery without round-tripping through `list()`.
 */
export interface SearchSkillsFilter {
  /**
   * Category match (single value). Forwarded to the registry as
   * `SkillSearchOptions.categoryHint`.
   */
  readonly category?: string;
  /**
   * When provided, only hits whose metadata declares at least one of these
   * roles in `contextFilter.roles` (or no roles at all — wildcard) are kept.
   * Layered on top of authz filtering, never relaxes it.
   */
  readonly roles?: ReadonlyArray<string>;
  /**
   * Reserved for tag-based filtering once `SkillMetadata.tags` lands (BR-19b).
   * Accepted today for forward compatibility; ignored by the v0.1 ranker.
   */
  readonly tags?: ReadonlyArray<string>;
}

/**
 * JSON Schema for the meta-tool input — emitted to the LLM so it can craft
 * well-formed calls. Kept inline (not generated from Zod) to avoid a runtime
 * dep just for this one shape.
 */
const SEARCH_SKILLS_INPUT_SCHEMA = {
  type: 'object',
  required: ['query'],
  additionalProperties: false,
  properties: {
    query: {
      type: 'string',
      description: 'Free-text query matched against skill name, description, category.',
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
        category: { type: 'string' },
        roles: { type: 'array', items: { type: 'string' } },
        tags: { type: 'array', items: { type: 'string' } },
      },
    },
  },
} as const;

/**
 * JSON Schema for the meta-tool output: an array of `SkillSearchHit`-shaped
 * objects. Mirrors `SkillSearchHit` exactly; if that type evolves, this
 * schema must follow.
 */
const SEARCH_SKILLS_OUTPUT_SCHEMA = {
  type: 'object',
  required: ['hits'],
  additionalProperties: false,
  properties: {
    hits: {
      type: 'array',
      items: {
        type: 'object',
        required: ['metadata', 'score', 'matchedFields'],
        additionalProperties: false,
        properties: {
          metadata: { type: 'object' },
          score: { type: 'number' },
          matchedFields: {
            type: 'array',
            items: { enum: ['name', 'description', 'category'] },
          },
        },
      },
    },
  },
} as const;

/**
 * `SkillTool` descriptor for the meta-tool. Stable shape: chat-core renders
 * this directly to the LLM provider's tool schema (OpenAI / Anthropic).
 */
export const SEARCH_SKILLS_TOOL: SkillTool = {
  name: SEARCH_SKILLS_TOOL_NAME,
  description:
    'Discover skills available in the current context. Returns the top-K skills ranked by match against the query, filtered to skills the caller is authorised to use.',
  inputSchema: SEARCH_SKILLS_INPUT_SCHEMA as unknown as Record<string, unknown>,
  outputSchema: SEARCH_SKILLS_OUTPUT_SCHEMA as unknown as Record<string, unknown>,
  sideEffect: false,
  requiresApproval: false,
};

/**
 * Pre-built `ResolvedTool` descriptor used by `SkillsToolRegistry` to inject
 * the meta-tool into every `resolveTools(authz)` response.
 */
export const SEARCH_SKILLS_RESOLVED_TOOL: ResolvedTool = {
  name: SEARCH_SKILLS_TOOL.name,
  description: SEARCH_SKILLS_TOOL.description,
  inputSchema: SEARCH_SKILLS_TOOL.inputSchema as Record<string, unknown>,
  outputSchema: SEARCH_SKILLS_TOOL.outputSchema as Record<string, unknown>,
  skillName: SEARCH_SKILLS_SKILL_NAME,
  sideEffect: false,
  requiresApproval: false,
};

/**
 * Execute the meta-tool against a `SkillRegistry`. The function is pure
 * with respect to the registry contents (read-only) and applies authz
 * filtering AFTER ranking — this is intentional: ranking should reflect the
 * full catalog so two callers with different authz still see the same
 * relative ordering, with denied hits stripped out.
 *
 * Note: an alternative (filter then rank) was rejected because it would
 * couple ranking quality to authz scope; small workspaces could see noisy
 * top-1 hits that are not actually the best match in the broader catalog.
 *
 * @param registry source of truth for catalog content
 * @param authz    caller authorisation context (drives visibility filter)
 * @param input    parsed (and validated upstream) meta-tool input
 */
export function executeSearchSkills(
  registry: SkillRegistry,
  authz: AuthzContext,
  input: SearchSkillsInput,
): SkillSearchHit[] {
  const query = typeof input.query === 'string' ? input.query : '';
  if (query.trim().length === 0) return [];

  const requestedLimit = input.limit ?? DEFAULT_LIMIT;
  const limit = Math.min(Math.max(1, Math.floor(requestedLimit)), MAX_LIMIT);

  // Over-fetch from the registry so authz/role filtering does not silently
  // shrink the result set below `limit` when the top hits are denied.
  // Cap at MAX_LIMIT to keep cost bounded.
  const searchOptions: SkillSearchOptions = {
    topK: MAX_LIMIT,
    categoryHint: input.filter?.category,
  };
  const ranked = registry.search(query, searchOptions);

  const rolesFilter = input.filter?.roles;
  const out: SkillSearchHit[] = [];
  for (const hit of ranked) {
    if (!isSkillVisibleTo(hit.metadata, authz)) continue;
    if (rolesFilter && rolesFilter.length > 0) {
      const declared = hit.metadata.contextFilter?.roles;
      // Wildcard skill (no declared roles) always passes the user filter;
      // otherwise require at least one overlap.
      if (declared && declared.length > 0) {
        const overlap = declared.some((r) => rolesFilter.includes(r));
        if (!overlap) continue;
      }
    }
    out.push(hit);
    if (out.length >= limit) break;
  }
  return out;
}
