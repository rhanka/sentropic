/**
 * Catalog execution seam — kind-agnostic CatalogEntry-keyed dispatch
 * (BR-42b Lot 2)
 *
 * This module provides the generic dispatch path for tool calls whose names
 * are NOT hardcoded in `foundation-executor.ts`.
 *
 * Purpose (SPEC_EVOL_CATALOG §3.4):
 *   Today `foundation-executor.ts` dispatches the ~27 foundation tools by
 *   HARDCODED name and returns `{ handled: false }` for anything else.
 *   An MCP/standalone `tool` entry would *resolve* into the chat tool set
 *   (via the composite registry) but could NEVER execute — there is no
 *   dispatch path for it. This seam closes that gap.
 *
 * How it works:
 *   1. `foundation-executor.ts` handles all hardcoded names first (unchanged).
 *   2. For any name NOT matched by the hardcoded branches, `foundation-executor`
 *      now calls `executeCatalogSeam(name, args, registry)` before returning
 *      `{ handled: false }`.
 *   3. The seam looks up the `CompositeCatalogRegistry` for an entry whose
 *      `metadata.name` matches the tool call name.
 *   4. If the entry is a `tool`-kind entry, the seam retrieves the handler from
 *      its source (via `StandaloneToolSource.getHandler`) and invokes it.
 *   5. The return value is an `ExecutionSeamResult` that mirrors the
 *      `ExecuteFoundationSkillToolResult` shape used by `foundation-executor`.
 *
 * D-TOOL-RECONCILE:
 *   `skill`-kind entries are NOT dispatched through this seam. Skill execution
 *   stays in `foundation-executor`'s hardcoded branches (search_skills and the
 *   ~25 named tool dispatchers). The seam only handles `tool`-kind entries
 *   (standalone / MCP tools). This is enforced by the `entry.kind === 'tool'`
 *   guard below.
 *
 * Authz note:
 *   The execution seam trusts that the tool name arrived in the per-turn tool
 *   call — meaning it already passed the `resolveTools` authz filter in the
 *   `SkillsToolRegistry` adapter. No additional authz check is performed here.
 *   Fine-grained authz (e.g. MCP-server-level allow/deny) is the responsibility
 *   of the individual handler registered via `StandaloneToolSource.register()`.
 */

import type { CompositeCatalogRegistry } from './composite-registry.js';
import type { StandaloneToolSource } from './sources/standalone-tool-source.js';

// ---------------------------------------------------------------------------
// Result shape — mirrors ExecuteFoundationSkillToolResult
// ---------------------------------------------------------------------------

/**
 * Result returned by `executeCatalogSeam`.
 *
 * `handled: true`  — a catalog entry was found, its handler was invoked, and
 *                     `result` carries the handler's return value.
 * `handled: false` — no matching `tool`-kind entry; caller should continue its
 *                     own fallback chain (ultimately returning `{ handled: false }`
 *                     to `chat-service.ts:4119`).
 */
export interface ExecutionSeamResult {
  readonly handled: boolean;
  readonly result?: unknown;
}

// ---------------------------------------------------------------------------
// CatalogExecutionSeam class
// ---------------------------------------------------------------------------

/**
 * Stateless dispatch hub that looks up `CatalogEntry` objects by name and
 * routes tool calls to the appropriate handler.
 *
 * A single instance is created per process and wired into `catalog.ts`;
 * `foundation-executor.ts` imports the module-level singleton.
 */
export class CatalogExecutionSeam {
  private readonly registry: CompositeCatalogRegistry;
  /**
   * Sources that expose a `getHandler()` lookup.
   * Currently only `StandaloneToolSource`; in Lot 5 `McpCatalogSource`
   * will also implement the same accessor interface.
   */
  private readonly handlerSources: StandaloneToolSource[];

  constructor(
    registry: CompositeCatalogRegistry,
    handlerSources: StandaloneToolSource[],
  ) {
    this.registry = registry;
    this.handlerSources = handlerSources;
  }

  /**
   * Attempt to dispatch a tool call through the catalog.
   *
   * Lookup order:
   *   1. Find a `CatalogEntry` by `metadata.name === name`.
   *   2. If the entry is `kind: 'tool'`, iterate handler sources to find
   *      a matching handler and invoke it.
   *   3. If no entry or no handler found → `{ handled: false }`.
   *
   * D-TOOL-RECONCILE: `skill`-kind entries are intentionally NOT dispatched
   * here; their tools are handled by `foundation-executor`'s hardcoded
   * branches. This seam is exclusively for standalone `tool`-kind entries.
   *
   * @param name  The public `metadata.name` of the tool being called.
   * @param args  Parsed tool call arguments (Record<string, unknown>).
   * @returns     `ExecutionSeamResult` — `handled` flag + optional result.
   */
  async execute(
    name: string,
    args: Record<string, unknown>,
  ): Promise<ExecutionSeamResult> {
    const entry = this.registry.get(name);

    // No catalog entry for this name.
    if (entry === null) {
      return { handled: false };
    }

    // D-TOOL-RECONCILE: skip skill-kind entries — their dispatch lives in
    // foundation-executor's hardcoded branches, not here.
    if (entry.kind !== 'tool') {
      return { handled: false };
    }

    // Find the handler for this tool entry across all registered sources.
    for (const source of this.handlerSources) {
      const handler = source.getHandler(name);
      if (handler !== undefined) {
        const result = await Promise.resolve(handler(args));
        return { handled: true, result };
      }
    }

    // Entry exists in the catalog but no handler source is wired for it.
    // This can happen if the source was registered for snapshot purposes
    // only (e.g. a read-only catalog view). Return unhandled so the caller
    // can surface it as an error or no-op.
    return { handled: false };
  }
}
