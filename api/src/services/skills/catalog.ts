/**
 * App-local catalog façade (BR-42b Lot 5 — MCP source wiring added, default-off)
 *
 * Foundation skills + agent templates + workflow seeds + MCP tools (opt-in) now
 * flow through the CompositeCatalogRegistry:
 *
 *   StaticCatalogSource ('foundation')       ← Lot 1 (skill entries)
 *   StandaloneToolSource ('standalone')      ← Lot 2 (tool entries, empty by default)
 *   AgentTemplateSource ('agent-templates')  ← Lot 3 (agent entries, code-level seeds)
 *   WorkflowSeedSource ('workflow-seeds')    ← Lot 4 (workflow entries, flow seeds)
 *   McpCatalogSource ('mcp:<name>') [OPT-IN] ← Lot 5 (tool entries from MCP server)
 *     → CompositeCatalogRegistry
 *       → SkillsToolRegistry adapter (unchanged)
 *         → resolveFoundationChatTools() [sync, search_skills first]
 *           → chat-service.ts:2749 (unchanged)
 *
 *   CatalogExecutionSeam                  ← Lot 2
 *     → foundation-executor.ts falls through to here for non-hardcoded names
 *       → StandaloneToolSource.getHandler() → handler invocation
 *       → McpCatalogSource.getHandler()    → MCP call dispatch [if wired]
 *
 * The wire contract is BYTE-IDENTICAL to the pre-Lot-5 baseline when no MCP
 * server is configured (DEFAULT-OFF):
 *   - `resolveFoundationChatTools` returns the same synchronous OpenAI tool
 *     array with `search_skills` first and the 28 foundation tools in the
 *     same insertion order. Agent and workflow entries are NOT projected into
 *     the tool set. MCP tool entries are NOT present unless a server is wired.
 *   - `executeFoundationSearchSkills` delegates identically to the adapter.
 *   - `foundationSkillsToolRegistry` is still a `SkillsToolRegistry` instance.
 *   - Agent and workflow entries are visible via
 *     `compositeCatalogRegistry.list/get/search` for discovery, but the
 *     SkillsToolRegistry loop filters to `skill`-kind only.
 *
 * To wire an MCP server: call `registerMcpSource(source)` BEFORE the first
 * call to `resolveFoundationChatTools` (or any time before the next turn),
 * then call `source.refresh()` to populate the snapshot out-of-band.
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
import { CompositeCatalogRegistry } from '../catalog/composite-registry.js';
import { CatalogExecutionSeam } from '../catalog/execution-seam.js';
import { agentTemplateSource } from '../catalog/sources/agent-template-source.js';
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
 * Later lots will add canvas and MCP sources.
 *
 * 0-regression note: `agent`- and `workflow`-kind entries are for discovery
 * only. The `SkillsToolRegistry` loop below filters to `kind === 'skill'`,
 * so agent and workflow entries never reach the OpenAI tool set.
 */
export const compositeCatalogRegistry = new CompositeCatalogRegistry();
compositeCatalogRegistry.addSource(foundationCatalogSource);
// Lot 2: wire standalone-tool source (empty; Lot 5 MCP will populate it).
compositeCatalogRegistry.addSource(standaloneToolSource);
// Lot 3: wire agent template source (code-level seeds; DB rows are NOT here).
compositeCatalogRegistry.addSource(agentTemplateSource);
// Lot 4: wire workflow seed source (code-level seeds from @sentropic/flow; DB rows are NOT here).
compositeCatalogRegistry.addSource(workflowSeedSource);

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
  return foundationSkillsToolRegistry
    .resolveTools(authz)
    .map((tool) => resolvedToolToOpenAIChatTool(tool));
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
