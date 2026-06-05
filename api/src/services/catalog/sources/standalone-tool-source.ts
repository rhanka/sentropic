/**
 * StandaloneToolSource — `CatalogSource` for standalone `tool`-kind entries
 * (BR-42b Lot 2)
 *
 * Makes standalone tools (tools NOT owned by any skill) first-class
 * `CatalogEntry` objects in the unified catalog. Each entry carries:
 *   - A `SkillTool` descriptor (name, description, inputSchema, …)
 *   - An optional `rawName` for provider-native names that cannot be used
 *     as the public `metadata.name` (§3.3 naming rule, SPEC_EVOL_CATALOG).
 *   - A synchronous `handler` that will be invoked by the execution seam
 *     (execution-seam.ts) when a tool call targets this entry.
 *
 * D-TOOL-RECONCILE invariant (SPEC_EVOL_CATALOG §2.1, §4):
 *   Skill-owned tools are NOT represented here. A skill entry already carries
 *   all of its tools inside `skill.tools`; duplicating them as standalone
 *   entries would violate the single-owner model and break collision resolution
 *   in `CompositeCatalogRegistry`. Only genuinely-standalone tools (MCP tools,
 *   code tools not attached to any skill) are registered via this source.
 *
 * In Lot 2 the source starts EMPTY — no standalone tools are pre-registered.
 * The point of this lot is the type plumbing + the execution seam prerequisite
 * for Lot 5 (MCP), which will call `register()` when tools/list results arrive.
 *
 * Source id convention: `'standalone'` (default); can be overridden at
 * construction time to support named sources (e.g. `'mcp:my-server'`).
 * Source kind: `'static'` (in-process registration, no async refresh needed
 * for standalone code tools; `McpCatalogSource` in Lot 5 will use `'mcp'`).
 */

import type { SkillTool } from '../../../../../packages/skills/src/index.js';
import type { CatalogSource } from '../source.js';
import type { CatalogEntry, ToolEntry } from '../types.js';

// ---------------------------------------------------------------------------
// Standalone tool handler type
// ---------------------------------------------------------------------------

/**
 * The execution handler attached to a standalone `ToolEntry`.
 *
 * The handler receives the raw args (already parsed from JSON by
 * foundation-executor.ts) and must return a plain result object that the
 * execution seam will forward as-is to the caller.
 *
 * The handler is SYNC or ASYNC — returning either `unknown` or
 * `Promise<unknown>` is accepted; the seam awaits the result.
 *
 * Note: the handler is NOT stored in the `CatalogEntry` itself — the public
 * `ToolEntry` type (types.ts) deliberately omits it so that entry shapes stay
 * serialisable.  Instead `StandaloneToolSource` keeps a parallel side-table
 * mapping `metadata.name → handler` and exposes a `getHandler()` accessor
 * consumed by the execution seam.
 */
export type StandaloneToolHandler = (
  args: Record<string, unknown>,
) => unknown | Promise<unknown>;

// ---------------------------------------------------------------------------
// Registration record
// ---------------------------------------------------------------------------

export interface StandaloneToolRegistration {
  /** The tool descriptor (SkillTool shape from @sentropic/skills). */
  readonly tool: SkillTool;
  /**
   * Original provider name when it differs from the public `metadata.name`
   * (e.g. MCP `mcp:server/tool` → sanitized public id + rawName mapping).
   * Omit for code-defined tools whose names are already provider-safe.
   */
  readonly rawName?: string;
  /** Execution handler invoked by the catalog execution seam. */
  readonly handler: StandaloneToolHandler;
  /** Optional semver version string. */
  readonly version?: string;
  /** Optional taxonomy category. */
  readonly category?: string;
}

// ---------------------------------------------------------------------------
// StandaloneToolSource
// ---------------------------------------------------------------------------

/**
 * A `CatalogSource` that holds standalone `tool`-kind entries.
 *
 * Standalone tools are tools that are NOT owned by any skill. They are
 * registered directly via `register()` and dispatched via the catalog
 * execution seam (execution-seam.ts).
 *
 * D-TOOL-RECONCILE: skill-owned tools must NOT be registered here.
 * The source enforces no runtime guard (it trusts the caller), but the
 * comment + naming make the ownership boundary explicit for reviewers.
 */
export class StandaloneToolSource implements CatalogSource {
  readonly id: string;
  readonly kind = 'static' as const;

  /** In-memory snapshot of ToolEntry objects, in registration order. */
  private readonly _entries: ToolEntry[] = [];

  /**
   * Side-table: public metadata.name → execution handler.
   * Kept separate from CatalogEntry so that entries remain serialisable.
   */
  private readonly _handlers = new Map<string, StandaloneToolHandler>();

  /**
   * @param id  Source identifier. Defaults to `'standalone'`.
   *            Use a scoped id for named sources (e.g. `'mcp:my-server'`).
   */
  constructor(id = 'standalone') {
    this.id = id;
  }

  // -------------------------------------------------------------------------
  // CatalogSource — snapshot (sync, hot path safe)
  // -------------------------------------------------------------------------

  /**
   * SYNC — returns the current in-memory entry array.
   * Called on every per-turn tool resolve; performs no I/O.
   */
  snapshot(): ReadonlyArray<CatalogEntry> {
    return this._entries;
  }

  // -------------------------------------------------------------------------
  // Registration API
  // -------------------------------------------------------------------------

  /**
   * Register a standalone tool entry with its execution handler.
   *
   * D-TOOL-RECONCILE: do NOT register tools that are already owned by a skill
   * (i.e. tools listed in any `Skill.tools` array). Those are surfaced through
   * the `SkillEntry` → `skill.tools` path; duplicating them here would create
   * two catalog entries with the same public name and violate the single-owner
   * model.
   *
   * Throws if a tool with the same `metadata.name` is already registered.
   */
  register(reg: StandaloneToolRegistration): this {
    const name = reg.tool.name;
    if (this._handlers.has(name)) {
      throw new Error(
        `StandaloneToolSource (${this.id}): tool '${name}' is already registered`,
      );
    }

    const entry: ToolEntry = {
      kind: 'tool',
      sourceId: this.id,
      metadata: {
        name,
        description: reg.tool.description,
        version: reg.version,
        category: reg.category,
      },
      tool: reg.tool,
      rawName: reg.rawName,
    };

    this._entries.push(entry);
    this._handlers.set(name, reg.handler);
    return this;
  }

  /**
   * Unregister a standalone tool by its public `metadata.name`.
   * No-op if the name is not registered.
   */
  unregister(name: string): this {
    const idx = this._entries.findIndex((e) => e.metadata.name === name);
    if (idx !== -1) {
      this._entries.splice(idx, 1);
      this._handlers.delete(name);
    }
    return this;
  }

  // -------------------------------------------------------------------------
  // Handler lookup (consumed by execution-seam.ts)
  // -------------------------------------------------------------------------

  /**
   * Look up the execution handler for a given public `metadata.name`.
   * Returns `undefined` when the name is not registered in this source.
   */
  getHandler(name: string): StandaloneToolHandler | undefined {
    return this._handlers.get(name);
  }

  /**
   * Return the number of registered entries.
   */
  get size(): number {
    return this._entries.length;
  }
}

// ---------------------------------------------------------------------------
// Module-level singleton (empty by default in Lot 2)
// ---------------------------------------------------------------------------

/**
 * Global singleton standalone tool source.
 * Empty in Lot 2; Lot 5 (MCP) will call `register()` on it as MCP tools
 * are discovered from connected servers.
 *
 * Wire this source into `CompositeCatalogRegistry` in `catalog.ts` to make
 * standalone tools visible to the live-chat tool resolve path.
 */
export const standaloneToolSource = new StandaloneToolSource('standalone');
