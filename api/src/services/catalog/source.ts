/**
 * CatalogSource interface (BR-42b Lot 1)
 *
 * A `CatalogSource` is a pluggable provider of `CatalogEntry` objects. The
 * catalog's hot path (the per-turn tool resolve) is synchronous end-to-end
 * (`adapter.ts:38` → `catalog.ts` → `chat-service.ts:2749`), so sources MUST
 * expose a synchronous `snapshot()` consumed on that path.
 *
 * Remote sources (MCP, Google marketplace) repopulate their snapshot
 * out-of-band via the optional async `refresh()`, which is never called on
 * the per-turn resolve.
 *
 * Design reference: SPEC_EVOL_CATALOG §3.2 (sync constraint / Codex MF2).
 */

import type { CatalogEntry } from './types.js';

// ---------------------------------------------------------------------------
// Source kind discriminant
// ---------------------------------------------------------------------------

export type CatalogSourceKind = 'static' | 'mcp' | 'marketplace';

// ---------------------------------------------------------------------------
// CatalogSource interface
// ---------------------------------------------------------------------------

/**
 * A pluggable provider of catalog entries.
 *
 * Contract:
 *   - `snapshot()` MUST be synchronous and always return the current in-memory
 *     state. It is called on every per-turn resolve; it MUST NOT do I/O.
 *   - `refresh()` is optional. When present it repopulates the in-memory
 *     snapshot asynchronously (e.g. connect to MCP server, call `tools/list`,
 *     update the snapshot). It MUST NOT be called on the per-turn resolve.
 *   - `health()` is optional. Returns a simple health indicator for monitoring.
 *   - Static sources (e.g. `StaticCatalogSource`) are always-fresh: their
 *     `snapshot()` derives from the in-process constant, so `refresh()` is
 *     not needed.
 */
export interface CatalogSource {
  /** Unique provider identifier. Examples: `'foundation'`, `'mcp:my-server'`. */
  readonly id: string;
  /** Source classification used for routing and policy decisions. */
  readonly kind: CatalogSourceKind;
  /**
   * SYNC snapshot consumed on every per-turn tool resolve.
   * MUST return the current in-memory state; MUST NOT perform I/O.
   */
  snapshot(): ReadonlyArray<CatalogEntry>;
  /**
   * ASYNC refresh — repopulates the in-memory snapshot from a remote source.
   * Called out-of-band (on connect / schedule); never on the per-turn resolve.
   * Static sources may omit this method.
   */
  refresh?(): Promise<void>;
  /**
   * ASYNC health check for monitoring / startup probes.
   */
  health?(): Promise<{ ok: boolean; detail?: string }>;
}
