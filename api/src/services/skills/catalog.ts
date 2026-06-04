/**
 * App-local catalog façade (BR-42b Lot 7 — search_catalog meta-tool added)
 *
 * Foundation skills + agent templates + workflow seeds + canvas templates +
 * MCP tools (opt-in) now flow through the CompositeCatalogRegistry:
 *
 *   StaticCatalogSource ('foundation')       ← Lot 1 (skill entries)
 *   StandaloneToolSource ('standalone')      ← Lot 2 (tool entries, empty by default)
 *   AgentTemplateSource ('agent-templates')  ← Lot 3 (agent entries, code-level seeds)
 *   WorkflowSeedSource ('workflow-seeds')    ← Lot 4 (workflow entries, flow seeds)
 *   CanvasTemplateSource ('canvas-templates')← Lot 6 (canvas entries, static starters)
 *   McpCatalogSource ('mcp:<name>') [OPT-IN] ← Lot 5 (tool entries from MCP server)
 *     → CompositeCatalogRegistry
 *       → SkillsToolRegistry adapter (unchanged)
 *         → resolveFoundationChatTools() [sync, search_skills first, search_catalog second]
 *           → chat-service.ts:2749 (unchanged)
 *
 *   CatalogExecutionSeam                  ← Lot 2
 *     → foundation-executor.ts falls through to here for non-hardcoded names
 *       → StandaloneToolSource.getHandler() → handler invocation
 *       → McpCatalogSource.getHandler()    → MCP call dispatch [if wired]
 *
 * Lot 7 adds `search_catalog` as an ADDITIVE sibling to `search_skills`
 * (SPEC_EVOL_CATALOG §3.5):
 *   - `search_skills` stays FIRST, skill-only, byte-identical (no rename).
 *   - `search_catalog` is injected at position 1 (immediately after
 *     `search_skills`) in `resolveFoundationChatTools()`.
 *   - `search_catalog` spans ALL 5 entry kinds in `compositeCatalogRegistry`.
 *   - `executeFoundationSearchCatalog` is the new dispatch function.
 *   - The 29-entry resolved tool array oracle (characterization §7) is updated.
 *
 * `packages/skills/src/**` remains READ-ONLY — no source changes.
 * `packages/chat-core/src/ports.ts` AgentRuntime is UNTOUCHED.
 * `packages/flow/src/**` is consumed READ-ONLY — no source changes.
 */

import type OpenAI from 'openai';
import {
  InMemorySkillRegistry,
  SkillsToolRegistry,
  type AuthzContext,
  type ResolvedTool,
  type SearchSkillsInput,
  type SkillSearchHit,
} from '../../../../packages/skills/src/index.js';
import { CompositeCatalogRegistry, type CatalogSearchOptions } from '../catalog/composite-registry.js';
import { CatalogExecutionSeam } from '../catalog/execution-seam.js';
import {
  SEARCH_CATALOG_RESOLVED_TOOL,
  type SearchCatalogInput,
  type CatalogHit,
  type SearchCatalogResult,
} from '../catalog/search-catalog-tool.js';
import { agentTemplateSource } from '../catalog/sources/agent-template-source.js';
import { canvasTemplateSource } from '../catalog/sources/canvas-template-source.js';
import type { McpCatalogSource } from '../catalog/sources/mcp-source.js';
import { foundationCatalogSource } from '../catalog/sources/static-source.js';
import { standaloneToolSource } from '../catalog/sources/standalone-tool-source.js';
import { workflowSeedSource } from '../catalog/sources/workflow-seed-source.js';

// ---------------------------------------------------------------------------
// Build the composite registry with all registered sources
// ---------------------------------------------------------------------------

/**
 * The composite catalog registry that fans across all registered sources.
 * - Lot 1: static foundation source (`skill`-kind entries, 16 skills).
 * - Lot 2: standalone tool source (`tool`-kind entries, empty by default).
 * - Lot 3: agent template source (`agent`-kind entries, code-level seeds).
 * - Lot 4: workflow seed source (`workflow`-kind entries, flow seeds).
 * - Lot 6: canvas template source (`canvas`-kind entries, static starters).
 *
 * 0-regression note: `agent`-, `workflow`-, and `canvas`-kind entries are for
 * discovery only. The `SkillsToolRegistry` loop below filters to
 * `kind === 'skill'`, so none of these entries ever reach the OpenAI tool set.
 */
export const compositeCatalogRegistry = new CompositeCatalogRegistry();
compositeCatalogRegistry.addSource(foundationCatalogSource);
// Lot 2: wire standalone-tool source (empty; Lot 5 MCP will populate it).
compositeCatalogRegistry.addSource(standaloneToolSource);
// Lot 3: wire agent template source (code-level seeds; DB rows are NOT here).
compositeCatalogRegistry.addSource(agentTemplateSource);
// Lot 4: wire workflow seed source (code-level seeds from @sentropic/flow; DB rows are NOT here).
compositeCatalogRegistry.addSource(workflowSeedSource);
// Lot 6: wire canvas template source (static starters; D-CANVAS — kind/template only, no runtime).
// Vocabulary: kind='canvas' aligns with CommentTargetKind 'canvas' (packages/comments/src/types.ts:13).
compositeCatalogRegistry.addSource(canvasTemplateSource);

// ---------------------------------------------------------------------------
// Catalog execution seam (Lot 2 / Lot 5) — dispatches non-hardcoded tool calls
// ---------------------------------------------------------------------------

/**
 * The singleton catalog execution seam.
 *
 * `foundation-executor.ts` consults this seam for any tool name that its
 * hardcoded `if` branches do NOT match, before returning `{ handled: false }`.
 *
 * The seam looks up the composite registry, finds `tool`-kind entries, and
 * invokes the handler registered in the corresponding source.
 *
 * D-TOOL-RECONCILE: `skill`-kind entries are NOT dispatched through this seam.
 * Skill tools remain in foundation-executor's hardcoded branches.
 *
 * MCP sources (Lot 5 — default-off): additional handler sources are added via
 * `registerMcpSource()` which calls `seam.addHandlerSource(source)`. The seam
 * holds a mutable list of handler sources so new MCP sources become visible
 * immediately without rebuilding the seam instance.
 */
export const catalogExecutionSeam = new CatalogExecutionSeam(
  compositeCatalogRegistry,
  [standaloneToolSource],
);

/**
 * Register an MCP catalog source into the composite registry and the execution
 * seam. This is the OPT-IN entry point for MCP tools (Lot 5).
 *
 * Default-off: no MCP source is registered at startup. Calling this function
 * is the only way to introduce MCP tools into the catalog. Call `source.refresh()`
 * separately (out-of-band) to populate the snapshot from the MCP server.
 *
 * 0-regression: until `registerMcpSource` is called, the composite registry
 * and the execution seam behave byte-identically to the pre-Lot-5 baseline.
 * The characterization oracle (41 tests) and the 28-tool order are unaffected.
 */
export function registerMcpSource(source: McpCatalogSource): void {
  // Wire into composite registry for list/get/search discovery.
  compositeCatalogRegistry.addSource(source);
  // Wire into execution seam for `call` dispatch.
  catalogExecutionSeam.addHandlerSource(source);
}

// ---------------------------------------------------------------------------
// Populate InMemorySkillRegistry from the composite snapshot
// ---------------------------------------------------------------------------
//
// We deliberately keep `InMemorySkillRegistry` + `SkillsToolRegistry` in place
// to avoid ANY change to the adapter or the search_skills execution path.
// The refactor only changes WHERE the registry is populated from: instead of
// calling `registerFoundationSkills(registry)` directly, we iterate the
// composite snapshot and register each skill-kind entry's payload.
//
// This ensures:
//   1. Insertion order is preserved (composite list() returns entries in source
//      registration order, which mirrors FOUNDATION_SKILLS array order).
//   2. The SkillsToolRegistry.resolveTools() path is unchanged.
//   3. The search_skills contract is unchanged.

const foundationSkillRegistry = new InMemorySkillRegistry();

for (const entry of compositeCatalogRegistry.list()) {
  if (entry.kind === 'skill') {
    foundationSkillRegistry.register(entry.skill);
  }
}

// ---------------------------------------------------------------------------
// Module exports — byte-identical surface to Lot 0
// ---------------------------------------------------------------------------

export const foundationSkillsToolRegistry = new SkillsToolRegistry(
  foundationSkillRegistry,
);

export interface ResolveFoundationChatToolsInput {
  readonly userId: string;
  readonly workspaceId: string;
  readonly workspaceType?: string | null;
  readonly currentUserRole?: string | null;
  readonly allowedTools: Iterable<string>;
}

export function buildFoundationSkillsAuthz(
  input: ResolveFoundationChatToolsInput,
): AuthzContext {
  return {
    tenant: {
      tenantId: input.workspaceId,
      workspaceId: input.workspaceId,
      userId: input.userId,
      workspaceType: input.workspaceType ?? undefined,
    },
    roles: input.currentUserRole ? [input.currentUserRole] : [],
    permissions: [],
    permissionMode: 'allowlist',
    allowedTools: Array.from(new Set(input.allowedTools)),
  };
}

export function resolvedToolToOpenAIChatTool(
  tool: ResolvedTool,
): OpenAI.Chat.Completions.ChatCompletionTool {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    },
  };
}

export function resolveFoundationChatTools(
  input: ResolveFoundationChatToolsInput,
): OpenAI.Chat.Completions.ChatCompletionTool[] {
  const authz = buildFoundationSkillsAuthz(input);
  const tools = foundationSkillsToolRegistry
    .resolveTools(authz)
    .map((tool) => resolvedToolToOpenAIChatTool(tool));

  // Lot 7 (SPEC_EVOL_CATALOG §3.5): inject `search_catalog` as the ADDITIVE
  // sibling at position 1 (immediately after `search_skills`).
  // `search_skills` is always first (injected by SkillsToolRegistry adapter
  // at tools[0]). `search_catalog` is a cross-kind meta-tool spanning ALL 5
  // catalog entry kinds; it does NOT replace or rename `search_skills`.
  const searchCatalogTool = resolvedToolToOpenAIChatTool(SEARCH_CATALOG_RESOLVED_TOOL);
  const [searchSkillsEntry, ...rest] = tools;
  if (searchSkillsEntry === undefined) {
    // Defensive: should never happen (adapter always prepends search_skills),
    // but if it does, just prepend search_catalog first.
    return [searchCatalogTool];
  }
  return [searchSkillsEntry, searchCatalogTool, ...rest];
}

export function executeFoundationSearchSkills(input: {
  readonly authz: ResolveFoundationChatToolsInput;
  readonly payload: SearchSkillsInput;
}): ReadonlyArray<SkillSearchHit> {
  return foundationSkillsToolRegistry.executeSearchSkills(
    buildFoundationSkillsAuthz(input.authz),
    input.payload,
  );
}

/**
 * Execute the `search_catalog` meta-tool.
 *
 * Queries the `compositeCatalogRegistry` across ALL 5 entry kinds using the
 * token-frequency ranker from Lot 1 (`CompositeCatalogRegistry.search()`).
 * Returns a flat array of `CatalogHit` objects — one per matching entry —
 * each carrying its `kind`, metadata projection, score, and matched fields.
 *
 * Called by `foundation-executor.ts` when `toolCall.name === 'search_catalog'`.
 * Uses the Lot 1 `CatalogSearchOptions` shape (kindHint + categoryHint).
 */
export function executeFoundationSearchCatalog(
  payload: SearchCatalogInput,
): SearchCatalogResult {
  const query = typeof payload.query === 'string' ? payload.query : '';
  if (query.trim().length === 0) {
    return { status: 'completed', hits: [] };
  }

  const limit = payload.limit;
  const kindHint = payload.filter?.kind;
  const categoryHint = payload.filter?.category;

  const searchOptions: CatalogSearchOptions = {
    ...(limit !== undefined ? { topK: limit } : {}),
    ...(kindHint !== undefined ? { kindHint } : {}),
    ...(categoryHint !== undefined ? { categoryHint } : {}),
  };

  const rawHits = compositeCatalogRegistry.search(query, searchOptions);

  const hits: CatalogHit[] = rawHits.map((h) => ({
    kind: h.entry.kind,
    name: h.entry.metadata.name,
    description: h.entry.metadata.description,
    ...(h.entry.metadata.category !== undefined ? { category: h.entry.metadata.category } : {}),
    ...(h.entry.metadata.version !== undefined ? { version: h.entry.metadata.version } : {}),
    score: h.score,
    matchedFields: h.matchedFields,
  }));

  return { status: 'completed', hits };
}
