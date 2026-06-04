/**
 * McpCatalogSource — `CatalogSource` for MCP server tools (BR-42b Lot 5)
 *
 * Absorbs and retires the dormant `feat/mcp-tool-catalog-br19b` stub.
 *
 * Connects to an MCP server via the official `@modelcontextprotocol/sdk`,
 * runs `tools/list`, and maps each MCP tool to a `tool`-kind `CatalogEntry`:
 *   - Sanitized provider-safe public `metadata.name` (kebab/underscore charset
 *     accepted by the parser and the OpenAI tool call schema).
 *   - `rawName` on the `ToolEntry` carries the MCP server's original tool name,
 *     enabling the `call` dispatch to use the correct name with the MCP server.
 *   - The catalog owns the public-id↔rawName map; the model never sees raw names.
 *
 * Sync constraint (SPEC_EVOL_CATALOG §3.2 / Codex MF2):
 *   `snapshot()` is SYNCHRONOUS and returns the LAST refreshed in-memory set.
 *   `refresh()` is ASYNC — connects, calls `tools/list`, repopulates the cache.
 *   NEVER connect or call `tools/list` on the per-turn resolve.
 *
 * Default-off (0-regression critical):
 *   With no MCP server configured, this source returns an EMPTY snapshot.
 *   The default chat tool set is UNCHANGED (no MCP tools leak into the tool set).
 *   The source must be wired explicitly in `catalog.ts`; it is NOT auto-registered.
 *
 * Per-source config (server URL/command, auth token/headers, allow/deny filter)
 * is carried out-of-band in the constructor options, NOT inside the entry.
 *
 * Naming rule (SPEC_EVOL_CATALOG §3.3 / Codex MF3):
 *   MCP tool names often contain `:` and `/` (e.g. `mcp:my-server/tool_name`)
 *   which are invalid as OpenAI tool identifiers and violate the kebab-pattern
 *   enforced by `packages/skills/src/format/parser.ts:21`:
 *     `KEBAB_PATTERN = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/`
 *   `sanitizeMcpToolName()` replaces all invalid characters with `_` and lower-
 *   cases the result. Collisions after sanitization are broken by appending `_N`.
 */

import type { Client as McpClient } from '@modelcontextprotocol/sdk/client/index.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';

import type { SkillTool } from '../../../../../packages/skills/src/index.js';
import type { StandaloneToolHandler } from './standalone-tool-source.js';
import type { CatalogSource } from '../source.js';
import type { CatalogEntry, ToolEntry } from '../types.js';

// ---------------------------------------------------------------------------
// Re-export for external consumers (type only)
// ---------------------------------------------------------------------------

export type { StandaloneToolHandler as McpToolHandler };

// ---------------------------------------------------------------------------
// Name sanitization (§3.3 / Codex MF3)
// ---------------------------------------------------------------------------

/**
 * KEBAB_PATTERN accepted by `packages/skills/src/format/parser.ts:21`.
 * Matches: /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/
 *
 * MCP names can contain `:` and `/` which are INVALID. This function:
 *   1. Lowercases the input.
 *   2. Replaces any run of non-kebab characters ([^a-z0-9_-]) with `_`.
 *   3. Strips leading/trailing `_` or `-`.
 *   4. Collapses consecutive `_` or `-` into a single `_`.
 *
 * Examples:
 *   'mcp:my-server/greet_user' → 'mcp_my_server_greet_user'
 *   'MyTool'                   → 'mytool'
 *   'tool--name'               → 'tool_name'
 */
export function sanitizeMcpToolName(rawName: string): string {
  return rawName
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_') // replace invalid chars with _
    .replace(/[-]{2,}/g, '_')       // collapse consecutive dashes
    .replace(/[_]{2,}/g, '_')       // collapse consecutive underscores
    .replace(/^[_-]+|[_-]+$/g, ''); // strip leading/trailing separators
}

// ---------------------------------------------------------------------------
// Per-source configuration
// ---------------------------------------------------------------------------

/**
 * Configuration for a single MCP server connection.
 *
 * Per-source config is carried out-of-band (constructor/env/workspace config),
 * NOT inside the catalog entries. This keeps entries serialisable.
 */
export interface McpSourceConfig {
  /**
   * Human-readable server name used as the source identifier suffix.
   * Example: `'my-server'` → source id = `'mcp:my-server'`.
   */
  readonly serverName: string;

  /**
   * Optional allowlist of raw MCP tool names to include.
   * When provided, tools NOT in this list are silently excluded.
   * When absent, all tools from `tools/list` are included.
   */
  readonly allowedTools?: ReadonlyArray<string>;

  /**
   * Optional denylist of raw MCP tool names to exclude.
   * Applied after the allowlist; tools in this list are excluded.
   */
  readonly deniedTools?: ReadonlyArray<string>;
}

// ---------------------------------------------------------------------------
// ToolHandlerSource interface (minimal surface for the execution seam)
// ---------------------------------------------------------------------------

/**
 * Minimal interface implemented by any source that can provide tool handlers
 * to the `CatalogExecutionSeam`.
 *
 * Both `StandaloneToolSource` and `McpCatalogSource` implement this interface,
 * allowing the seam to dispatch to either source type.
 */
export interface ToolHandlerSource {
  getHandler(name: string): StandaloneToolHandler | undefined;
}

// ---------------------------------------------------------------------------
// McpCatalogSource
// ---------------------------------------------------------------------------

/**
 * A `CatalogSource` that connects to an MCP server and maps its tools to
 * `tool`-kind `CatalogEntry` objects via `tools/list`.
 *
 * Transport is provided externally (stdio or HTTP/SSE) — the source does NOT
 * construct transports itself, keeping it testable with in-memory transports.
 *
 * Lifecycle:
 *   1. Construct with `config` + a lazy `transportFactory` (returns a Transport).
 *   2. Call `refresh()` once (or on a schedule) to connect and populate the
 *      snapshot. `snapshot()` is empty until the first `refresh()` completes.
 *   3. `snapshot()` returns the last cached set synchronously on every call.
 *   4. Subsequent `refresh()` calls repopulate the snapshot (e.g. after server
 *      reconnect or tool list changes).
 *
 * Thread-safety: NodeJS is single-threaded; concurrent `refresh()` calls are
 * safe but will result in back-to-back `tools/list` calls. The last one wins.
 */
export class McpCatalogSource implements CatalogSource, ToolHandlerSource {
  readonly id: string;
  readonly kind = 'mcp' as const;

  private readonly config: McpSourceConfig;
  /**
   * Factory that returns a fresh Transport for each connection attempt.
   * Lazily evaluated — called only inside `refresh()`, never on `snapshot()`.
   */
  private readonly transportFactory: () => Transport;

  /** In-memory snapshot of ToolEntry objects, populated by `refresh()`. */
  private _entries: ToolEntry[] = [];

  /**
   * Side-table: sanitized public metadata.name → MCP call handler.
   * Kept separate from `CatalogEntry` so entries remain serialisable.
   */
  private readonly _handlers = new Map<string, StandaloneToolHandler>();

  /** Whether this source has successfully completed at least one refresh. */
  private _initialized = false;

  /**
   * @param config           Per-source configuration (server name, allow/deny).
   * @param transportFactory Returns a fresh Transport for each refresh attempt.
   *                         Accepts both stdio and HTTP/SSE transports.
   *                         In tests, use `InMemoryTransport.createLinkedPair()`.
   */
  constructor(config: McpSourceConfig, transportFactory: () => Transport) {
    this.config = config;
    this.transportFactory = transportFactory;
    this.id = `mcp:${config.serverName}`;
  }

  // -------------------------------------------------------------------------
  // CatalogSource — snapshot (sync, hot path safe)
  // -------------------------------------------------------------------------

  /**
   * SYNC — returns the current in-memory entry array.
   * Called on every per-turn tool resolve; performs NO I/O.
   * Returns `[]` until the first `refresh()` completes successfully.
   */
  snapshot(): ReadonlyArray<CatalogEntry> {
    return this._entries;
  }

  // -------------------------------------------------------------------------
  // CatalogSource — refresh (async, out-of-band only)
  // -------------------------------------------------------------------------

  /**
   * ASYNC — connects to the MCP server, calls `tools/list`, and repopulates
   * the in-memory snapshot.
   *
   * This method MUST be called out-of-band (on startup / schedule / reconnect).
   * It MUST NOT be called on the per-turn resolve path.
   *
   * On success: replaces `_entries` and `_handlers` atomically (at the end
   * of the update so that snapshot() always returns a consistent set).
   * On failure: leaves the previous snapshot intact and rethrows the error.
   */
  async refresh(): Promise<void> {
    // Dynamic import to avoid top-level SDK instantiation at module load time.
    // This keeps the module lightweight when no MCP server is configured.
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');

    const transport = this.transportFactory();
    const client: McpClient = new Client(
      { name: this.id, version: '1.0.0' },
      { capabilities: {} },
    );

    await client.connect(transport);
    try {
      const { tools: rawTools } = await client.listTools();
      this._applyToolList(rawTools);
      this._initialized = true;
    } finally {
      // Always close the transport after listing — we do NOT keep the connection
      // open. Each refresh() opens a fresh connection, lists tools, and closes.
      // This matches the "refresh out-of-band" contract: no persistent connection
      // on the hot path.
      await client.close();
    }
  }

  // -------------------------------------------------------------------------
  // CatalogSource — health (optional async check)
  // -------------------------------------------------------------------------

  async health(): Promise<{ ok: boolean; detail?: string }> {
    if (!this._initialized) {
      return { ok: false, detail: 'not yet refreshed' };
    }
    return { ok: true, detail: `${this._entries.length} tools loaded` };
  }

  // -------------------------------------------------------------------------
  // ToolHandlerSource — getHandler (consumed by CatalogExecutionSeam)
  // -------------------------------------------------------------------------

  /**
   * Look up the MCP call handler for a given sanitized public `metadata.name`.
   * Returns `undefined` when the name is not registered in this source.
   */
  getHandler(name: string): StandaloneToolHandler | undefined {
    return this._handlers.get(name);
  }

  // -------------------------------------------------------------------------
  // Public inspection
  // -------------------------------------------------------------------------

  /** Return the number of currently loaded entries. */
  get size(): number {
    return this._entries.length;
  }

  /** Whether at least one successful `refresh()` has completed. */
  get initialized(): boolean {
    return this._initialized;
  }

  // -------------------------------------------------------------------------
  // Private — apply a raw tools/list result
  // -------------------------------------------------------------------------

  /**
   * Apply a raw MCP `tools/list` result, building new entries + handlers.
   *
   * The update is applied atomically by replacing `_entries` and clearing/
   * repopulating `_handlers` at the end, so `snapshot()` always returns a
   * consistent set.
   */
  private _applyToolList(
    rawTools: Array<{
      name: string;
      description?: string;
      inputSchema?: {
        type?: string;
        properties?: Record<string, unknown>;
        required?: string[];
        [key: string]: unknown;
      };
    }>,
  ): void {
    const allowedSet =
      this.config.allowedTools !== undefined
        ? new Set(this.config.allowedTools)
        : null;
    const deniedSet =
      this.config.deniedTools !== undefined
        ? new Set(this.config.deniedTools)
        : null;

    const newEntries: ToolEntry[] = [];
    const newHandlers = new Map<string, StandaloneToolHandler>();

    // Track sanitized names to handle collisions (append _N suffix).
    const sanitizedNameCounts = new Map<string, number>();

    for (const rawTool of rawTools) {
      // Apply allow/deny filter.
      if (allowedSet !== null && !allowedSet.has(rawTool.name)) continue;
      if (deniedSet !== null && deniedSet.has(rawTool.name)) continue;

      // Sanitize the raw MCP tool name to a provider-safe public id.
      let publicName = sanitizeMcpToolName(rawTool.name);

      // Fallback: if sanitization yields an empty string, use 'tool'.
      if (publicName.length === 0) {
        publicName = 'tool';
      }

      // Handle collisions: append _2, _3, … for duplicate sanitized names.
      const baseName = publicName;
      const count = sanitizedNameCounts.get(baseName) ?? 0;
      sanitizedNameCounts.set(baseName, count + 1);
      if (count > 0) {
        publicName = `${baseName}_${count + 1}`;
      }

      // Build the SkillTool descriptor from the MCP tool metadata.
      const tool: SkillTool = {
        name: publicName,
        description: rawTool.description ?? `MCP tool: ${rawTool.name}`,
        inputSchema: this._buildInputSchema(rawTool.inputSchema),
      };

      // rawName: the MCP server's original tool name for the call dispatch.
      // Stored in ToolEntry; never surfaced in the model's tool descriptor.
      const rawName = rawTool.name;

      const entry: ToolEntry = {
        kind: 'tool',
        sourceId: this.id,
        metadata: {
          name: publicName,
          description: tool.description,
          category: 'mcp',
        },
        tool,
        rawName,
      };

      // Build the MCP call handler. The handler closes over rawName to
      // dispatch to the MCP server using the original tool name.
      const rawNameForHandler = rawName;
      const sourceId = this.id;
      const handler: StandaloneToolHandler = async (
        args: Record<string, unknown>,
      ) => {
        // Dynamic import to avoid top-level SDK instantiation at module load time.
        const { Client } = await import(
          '@modelcontextprotocol/sdk/client/index.js'
        );

        const callTransport = this.transportFactory();
        const callClient: McpClient = new Client(
          { name: sourceId, version: '1.0.0' },
          { capabilities: {} },
        );
        await callClient.connect(callTransport);
        try {
          const result = await callClient.callTool({
            name: rawNameForHandler,
            arguments: args,
          });
          return result;
        } finally {
          await callClient.close();
        }
      };

      newEntries.push(entry);
      newHandlers.set(publicName, handler);
    }

    // Atomic replacement: replace snapshot + handlers together.
    this._entries = newEntries;
    this._handlers.clear();
    for (const [k, v] of newHandlers) {
      this._handlers.set(k, v);
    }
  }

  /**
   * Build a minimal `SkillTool.inputSchema` from the MCP tool's inputSchema.
   *
   * MCP `inputSchema` is a JSON Schema object. We pass it through as-is into
   * `SkillTool.inputSchema` (which is typed as `JsonSchemaFragment`). If the
   * MCP tool has no inputSchema, we fall back to an empty object schema.
   */
  private _buildInputSchema(
    inputSchema:
      | {
          type?: string;
          properties?: Record<string, unknown>;
          required?: string[];
          [key: string]: unknown;
        }
      | undefined,
  ): Record<string, unknown> {
    if (
      inputSchema === undefined ||
      inputSchema === null ||
      typeof inputSchema !== 'object'
    ) {
      return { type: 'object', properties: {} };
    }
    return inputSchema as Record<string, unknown>;
  }
}
