/**
 * App-local catalog façade (BR-42b Lot 1 — post-refactor)
 *
 * Foundation skills now flow through the CompositeCatalogRegistry seam:
 *
 *   StaticCatalogSource ('foundation')
 *     → CompositeCatalogRegistry
 *       → SkillsToolRegistry adapter (unchanged)
 *         → resolveFoundationChatTools() [sync, search_skills first]
 *           → chat-service.ts:2749 (unchanged)
 *
 * The wire contract is BYTE-IDENTICAL to the pre-Lot-1 baseline:
 *   - `resolveFoundationChatTools` returns the same synchronous OpenAI tool
 *     array with `search_skills` first and the 28 foundation tools in the
 *     same insertion order.
 *   - `executeFoundationSearchSkills` delegates identically to the adapter.
 *   - `foundationSkillsToolRegistry` is still a `SkillsToolRegistry` instance.
 *
 * The only difference from Lot 0 is that the `InMemorySkillRegistry` is now
 * populated by reading from the `CompositeCatalogRegistry`'s snapshot rather
 * than directly from `FOUNDATION_SKILLS`. This is transparent to all callers.
 *
 * `packages/skills/src/**` remains READ-ONLY — no source changes.
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
import { foundationCatalogSource } from '../catalog/sources/static-source.js';

// ---------------------------------------------------------------------------
// Build the composite registry with the foundation source
// ---------------------------------------------------------------------------

/**
 * The composite catalog registry that fans across all registered sources.
 * In Lot 1, only the static foundation source is registered.
 * Later lots will add MCP, agent-template, workflow-seed, and canvas sources.
 */
export const compositeCatalogRegistry = new CompositeCatalogRegistry();
compositeCatalogRegistry.addSource(foundationCatalogSource);

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
