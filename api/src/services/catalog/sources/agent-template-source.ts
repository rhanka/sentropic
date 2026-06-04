/**
 * AgentTemplateSource — `CatalogSource` for `agent`-kind catalog entries
 * (BR-42b Lot 3)
 *
 * Exposes the code-level agent templates from `api/src/config/default-agents.ts`
 * (`WORKSPACE_TYPE_AGENT_SEEDS`) as `agent`-kind `CatalogEntry` objects, giving
 * `list/search/get` parity with the `skill`-kind entries from `StaticCatalogSource`.
 *
 * § 14 invariant (SPEC_EVOL_CATALOG §2.2 / D-AGENT-SCOPE):
 *   Only CODE-LEVEL TEMPLATES/SEEDS are catalogued here. Per-workspace DB rows
 *   (`agent_definitions` table, `schema.ts:840-866`) are NOT projected into the
 *   catalog. The flow/chat-core `AgentRuntime` port (`packages/chat-core/src/ports.ts:153`)
 *   and `AgentTemplate` resolution stay in flow — NOT modified here.
 *
 * 0-regression invariant:
 *   `agent`-kind entries are for discovery (list/search/get) ONLY. They are
 *   NOT wired into the `SkillsToolRegistry` or `resolveFoundationChatTools` path,
 *   so the resolved OpenAI chat tool set stays byte-identical to the pre-Lot-3
 *   baseline. `resolveFoundationChatTools` projects ONLY `skill`-kind entries.
 *
 * De-duplication policy:
 *   `WORKSPACE_TYPE_AGENT_SEEDS` groups agents by workspace type but the same
 *   shared agents (e.g. SHARED_AGENTS) appear in multiple groups. This source
 *   de-duplicates by `key`: the first occurrence wins (first workspace type that
 *   declares the agent), same foundation-precedence policy as `CompositeCatalogRegistry`.
 *   The resulting snapshot contains one `AgentEntry` per unique agent `key`.
 *
 * `metadata.name` mapping:
 *   An agent's `key` is already in kebab/snake-case (e.g. `generation_orchestrator`),
 *   which is provider-safe. We use the key directly as `metadata.name` so that
 *   `get(key)` works without any transformation.
 *
 * Source id:  `'agent-templates'`
 * Source kind: `'static'` (in-process constant; no async refresh needed)
 */

import {
  WORKSPACE_TYPE_AGENT_SEEDS,
  type DefaultGenerationAgentDefinition,
} from '../../../config/default-agents.js';
import type { CatalogSource } from '../source.js';
import type { AgentEntry, CatalogEntry } from '../types.js';

// ---------------------------------------------------------------------------
// AgentTemplateSource
// ---------------------------------------------------------------------------

/**
 * A `CatalogSource` backed by `WORKSPACE_TYPE_AGENT_SEEDS` from
 * `api/src/config/default-agents.ts`.
 *
 * Emits one `AgentEntry` per unique agent key across all workspace-type seed
 * groups. The snapshot is always-fresh (in-process constant, no I/O, no cache).
 *
 * § 14 invariant: per-workspace `agent_definitions` DB rows are NOT here.
 * Flow `AgentRuntime` / `AgentTemplate` resolution is UNTOUCHED.
 */
export class AgentTemplateSource implements CatalogSource {
  readonly id: string;
  readonly kind = 'static' as const;

  private readonly entries: ReadonlyArray<AgentEntry>;

  /**
   * @param id  Source identifier. Defaults to `'agent-templates'`.
   */
  constructor(id = 'agent-templates') {
    this.id = id;
    this.entries = buildAgentEntries(id);
  }

  /**
   * SYNC — returns the pre-built agent template entries array.
   * Always-fresh: backed by compile-time constants; no I/O.
   */
  snapshot(): ReadonlyArray<CatalogEntry> {
    return this.entries;
  }

  // No `refresh()` — static sources are always-fresh by definition.
  // No `health()` — in-process constant; never unhealthy.

  /**
   * Return the number of distinct agent template entries in the snapshot.
   */
  get size(): number {
    return this.entries.length;
  }
}

// ---------------------------------------------------------------------------
// Build helper — de-duplicate agent seeds by key
// ---------------------------------------------------------------------------

/**
 * Walk `WORKSPACE_TYPE_AGENT_SEEDS`, collect unique `DefaultGenerationAgentDefinition`
 * objects (first-seen wins on duplicate key), and map each to an `AgentEntry`.
 *
 * §14 invariant: only code-level seeds; no DB queries, no `agent_definitions`.
 */
function buildAgentEntries(sourceId: string): ReadonlyArray<AgentEntry> {
  const seen = new Set<string>();
  const entries: AgentEntry[] = [];

  for (const seed of WORKSPACE_TYPE_AGENT_SEEDS) {
    for (const agent of seed.agents) {
      if (seen.has(agent.key)) continue; // de-duplicate: first workspace type wins
      seen.add(agent.key);
      entries.push(agentToEntry(agent, sourceId));
    }
  }

  return entries;
}

/**
 * Map a `DefaultGenerationAgentDefinition` to an `AgentEntry`.
 *
 * `metadata.name` = `agent.key` (already provider-safe kebab/snake-case).
 * `metadata.description` = `agent.description` (required on the type; always present).
 * `metadata.category` = `'agent'` (taxonomy tag for agent-kind discovery).
 */
function agentToEntry(
  agent: DefaultGenerationAgentDefinition,
  sourceId: string,
): AgentEntry {
  return {
    kind: 'agent',
    sourceId,
    metadata: {
      name: agent.key,
      description: agent.description,
      category: 'agent',
    },
    template: agent,
  };
}

// ---------------------------------------------------------------------------
// Module-level singleton (consumed by the wired catalog.ts)
// ---------------------------------------------------------------------------

/**
 * Singleton `AgentTemplateSource` for all workspace-type agent seeds.
 * Import this to wire agent templates into `CompositeCatalogRegistry`.
 *
 * The singleton emits only code-level templates; per-workspace `agent_definitions`
 * DB rows are NOT here (§14 invariant).
 */
export const agentTemplateSource = new AgentTemplateSource('agent-templates');
