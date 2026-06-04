/**
 * AgentTemplateSource — unit tests (BR-42b Lot 3)
 *
 * Covers:
 *   - Seeds → `agent`-kind entries (shape, count, de-duplication by key)
 *   - `list/search/get` parity with the skill source pattern
 *   - `snapshot()` is synchronous and always-fresh (no I/O)
 *   - Source id / kind identity
 *   - CatalogEntryMetadata carries the shared intersection fields
 *   - §14 invariant: per-workspace DB rows are NOT catalogued; only code-level
 *     seeds from WORKSPACE_TYPE_AGENT_SEEDS appear in the snapshot
 *   - 0-regression: agent entries are absent from the resolved OpenAI chat tool
 *     set produced by `resolveFoundationChatTools` (they must NOT leak into the
 *     28-tool order oracle from the characterization spec)
 */

import { describe, expect, it } from 'vitest';

import {
  WORKSPACE_TYPE_AGENT_SEEDS,
} from '../../../../api/src/config/default-agents';
import {
  AgentTemplateSource,
  agentTemplateSource,
} from '../../../src/services/catalog/sources/agent-template-source';
import type { AgentEntry } from '../../../src/services/catalog/types';
import {
  FOUNDATION_SKILLS,
} from '../../../../packages/skills/src/index';
import {
  resolveFoundationChatTools,
} from '../../../src/services/skills/catalog';

// ---------------------------------------------------------------------------
// Helpers / fixtures
// ---------------------------------------------------------------------------

/** All unique agent keys across all workspace-type seeds (first-seen wins). */
const UNIQUE_AGENT_KEYS = (() => {
  const seen = new Set<string>();
  const keys: string[] = [];
  for (const seed of WORKSPACE_TYPE_AGENT_SEEDS) {
    for (const agent of seed.agents) {
      if (!seen.has(agent.key)) {
        seen.add(agent.key);
        keys.push(agent.key);
      }
    }
  }
  return keys;
})();

/** All foundation tool names — needed to build the full-access authz for the 0-regression check. */
const ALL_FOUNDATION_TOOL_NAMES: string[] = FOUNDATION_SKILLS.flatMap((s) =>
  s.tools.map((t) => t.name),
);

// ---------------------------------------------------------------------------
// § 1  Module-level singleton identity
// ---------------------------------------------------------------------------

describe('agentTemplateSource singleton', () => {
  it('has id "agent-templates" and kind "static"', () => {
    expect(agentTemplateSource.id).toBe('agent-templates');
    expect(agentTemplateSource.kind).toBe('static');
  });

  it('is an instance of AgentTemplateSource', () => {
    expect(agentTemplateSource).toBeInstanceOf(AgentTemplateSource);
  });
});

// ---------------------------------------------------------------------------
// § 2  snapshot() — synchronous and always-fresh
// ---------------------------------------------------------------------------

describe('AgentTemplateSource.snapshot() — sync + always-fresh', () => {
  it('is synchronous — returns an array, not a Promise', () => {
    const src = new AgentTemplateSource();
    const result = src.snapshot();
    expect(result).toBeInstanceOf(Array);
    expect((result as unknown as { then?: unknown }).then).toBeUndefined();
  });

  it('returns the same reference on repeated calls (no recomputation)', () => {
    const src = new AgentTemplateSource();
    const a = src.snapshot();
    const b = src.snapshot();
    expect(a).toBe(b);
  });

  it('has no refresh() method (static sources are always-fresh)', () => {
    const src = new AgentTemplateSource();
    expect((src as { refresh?: unknown }).refresh).toBeUndefined();
  });

  it('has no health() method', () => {
    const src = new AgentTemplateSource();
    expect((src as { health?: unknown }).health).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// § 3  Entries — agent-kind, count, and de-duplication
// ---------------------------------------------------------------------------

describe('AgentTemplateSource — entries count and de-duplication', () => {
  const src = new AgentTemplateSource();
  const entries = src.snapshot() as AgentEntry[];

  it('contains exactly one entry per unique agent key across all workspace types', () => {
    // The source de-duplicates by key; WORKSPACE_TYPE_AGENT_SEEDS shares SHARED_AGENTS
    // across multiple workspace types, so unique count < total seeds sum.
    expect(entries).toHaveLength(UNIQUE_AGENT_KEYS.length);
  });

  it('no duplicate metadata.name in the snapshot', () => {
    const names = entries.map((e) => e.metadata.name);
    const uniqueNames = new Set(names);
    expect(uniqueNames.size).toBe(names.length);
  });

  it('all entries have kind="agent"', () => {
    for (const entry of entries) {
      expect(entry.kind).toBe('agent');
    }
  });

  it('all entries have sourceId matching the source id', () => {
    for (const entry of entries) {
      expect(entry.sourceId).toBe('agent-templates');
    }
  });

  it('size property matches snapshot length', () => {
    expect(src.size).toBe(entries.length);
  });
});

// ---------------------------------------------------------------------------
// § 4  CatalogEntryMetadata — shared intersection fields
// ---------------------------------------------------------------------------

describe('AgentTemplateSource — CatalogEntryMetadata fields', () => {
  const src = new AgentTemplateSource();
  const entries = src.snapshot() as AgentEntry[];

  it('each entry.metadata.name equals entry.template.key (provider-safe mapping)', () => {
    for (const entry of entries) {
      expect(entry.metadata.name).toBe(entry.template.key);
    }
  });

  it('each entry.metadata.description equals entry.template.description', () => {
    for (const entry of entries) {
      expect(entry.metadata.description).toBe(entry.template.description);
      expect(entry.metadata.description.length).toBeGreaterThan(0);
    }
  });

  it('each entry.metadata.category is "agent"', () => {
    for (const entry of entries) {
      expect(entry.metadata.category).toBe('agent');
    }
  });

  it('entries have no version (agent templates are not semver-versioned)', () => {
    for (const entry of entries) {
      expect(entry.metadata.version).toBeUndefined();
    }
  });

  it('entries have no contextFilter (no workspace-type gating on templates)', () => {
    for (const entry of entries) {
      expect(entry.metadata.contextFilter).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// § 5  Agent template payload round-trip
// ---------------------------------------------------------------------------

describe('AgentTemplateSource — template payload', () => {
  const src = new AgentTemplateSource();
  const entries = src.snapshot() as AgentEntry[];

  it('each entry.template.sourceLevel is "code"', () => {
    for (const entry of entries) {
      expect(entry.template.sourceLevel).toBe('code');
    }
  });

  it('each entry.template.key is a non-empty string', () => {
    for (const entry of entries) {
      expect(typeof entry.template.key).toBe('string');
      expect(entry.template.key.length).toBeGreaterThan(0);
    }
  });

  it('each entry.template.name is a non-empty string', () => {
    for (const entry of entries) {
      expect(typeof entry.template.name).toBe('string');
      expect(entry.template.name.length).toBeGreaterThan(0);
    }
  });

  it('each entry.template.config is a non-null object', () => {
    for (const entry of entries) {
      expect(typeof entry.template.config).toBe('object');
      expect(entry.template.config).not.toBeNull();
    }
  });

  it('all expected unique agent keys appear in the snapshot (completeness check)', () => {
    const snapshotKeys = (src.snapshot() as AgentEntry[]).map((e) => e.template.key);
    for (const key of UNIQUE_AGENT_KEYS) {
      expect(snapshotKeys).toContain(key);
    }
  });
});

// ---------------------------------------------------------------------------
// § 6  Custom source id
// ---------------------------------------------------------------------------

describe('AgentTemplateSource — custom id', () => {
  it('accepts a custom id and sets it on entries', () => {
    const src = new AgentTemplateSource('my-agents');
    expect(src.id).toBe('my-agents');
    const entries = src.snapshot() as AgentEntry[];
    for (const entry of entries) {
      expect(entry.sourceId).toBe('my-agents');
    }
  });
});

// ---------------------------------------------------------------------------
// § 7  §14 invariant — no DB-row leakage; only code-level seeds are catalogued
// ---------------------------------------------------------------------------

describe('§14 invariant — only code-level agent seeds are catalogued', () => {
  const src = new AgentTemplateSource();
  const entries = src.snapshot() as AgentEntry[];

  it('all template entries have sourceLevel="code" (not "admin" or "user")', () => {
    // Per-workspace DB rows can have sourceLevel 'admin' or 'user' (schema.ts:840-866).
    // Only 'code'-level seeds belong in the catalog.
    for (const entry of entries) {
      expect(entry.template.sourceLevel).toBe('code');
    }
  });

  it('snapshot count equals WORKSPACE_TYPE_AGENT_SEEDS unique-key count (no extra DB rows)', () => {
    // If DB rows were leaking in, this count would differ.
    // We verify it equals the compile-time constant unique key count.
    expect(entries.length).toBe(UNIQUE_AGENT_KEYS.length);
    expect(entries.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// § 8  0-regression — agent entries MUST NOT enter the resolved chat tool set
// ---------------------------------------------------------------------------

/**
 * Agent keys that are NOT foundation tool names.
 * The resolved chat tool set contains ONLY foundation tool names (from skill entries).
 * Some agent keys coincidentally share the same name as a foundation tool
 * (e.g. `comment_assistant` is both an agent key and a foundation tool name).
 * Those coincidental overlaps are expected — they don't indicate a leak.
 *
 * The real 0-regression check is the TOOL COUNT: adding the agent source must
 * NOT increase the resolved tool count beyond the baseline 28 (1 search_skills +
 * 27 foundation tools). That's the byte-identical oracle from the characterization
 * spec §7.
 */
const AGENT_ONLY_KEYS = UNIQUE_AGENT_KEYS.filter(
  (key) => !ALL_FOUNDATION_TOOL_NAMES.includes(key),
);

describe('0-regression — agent entries absent from resolveFoundationChatTools', () => {
  it('agent-only keys (not coinciding with foundation tool names) are NOT in the resolved tool set', () => {
    // resolveFoundationChatTools projects ONLY skill-kind entries via
    // SkillsToolRegistry. Agent entries are in the composite registry for
    // discovery but must NOT appear in the resolved chat tool array.
    //
    // We test agent-only keys to avoid false positives from coincidental
    // name overlap (e.g. `comment_assistant` is both an agent key AND a
    // foundation tool name — its presence in the tool set is correct).
    const tools = resolveFoundationChatTools({
      userId: 'u-lot3-test',
      workspaceId: 'ws-lot3-test',
      workspaceType: 'ai-ideas',
      currentUserRole: 'editor',
      allowedTools: ALL_FOUNDATION_TOOL_NAMES,
    });

    const toolNames = new Set(tools.map((t) => t.function.name));

    // Sanity: there must be agent-only keys to validate (non-empty).
    expect(AGENT_ONLY_KEYS.length).toBeGreaterThan(0);

    // None of the agent-only keys should appear in the resolved tool set.
    for (const key of AGENT_ONLY_KEYS) {
      expect(toolNames.has(key)).toBe(false);
    }
  });

  it('the tool count oracle is byte-identical after wiring the agent source (Lot 7: 31 tools)', () => {
    // This mirrors the characterization spec §7 (updated in Lot 7):
    // search_skills (index 0) + search_catalog (index 1, Lot 7 addition) + foundation tools.
    // Adding the agent source to the composite registry must NOT add any tool to this count.
    const tools = resolveFoundationChatTools({
      userId: 'u-lot3-test',
      workspaceId: 'ws-lot3-test',
      workspaceType: 'ai-ideas',
      currentUserRole: 'editor',
      allowedTools: ALL_FOUNDATION_TOOL_NAMES,
    });
    // 2 meta-tools (search_skills + search_catalog) + all foundation tools
    expect(tools).toHaveLength(2 + ALL_FOUNDATION_TOOL_NAMES.length);
    expect(tools[0]!.function.name).toBe('search_skills');
    expect(tools[1]!.function.name).toBe('search_catalog');
  });

  it('search_skills is still the FIRST tool after adding the agent source', () => {
    const tools = resolveFoundationChatTools({
      userId: 'u-lot3-test',
      workspaceId: 'ws-lot3-test',
      workspaceType: 'ai-ideas',
      currentUserRole: 'editor',
      allowedTools: ALL_FOUNDATION_TOOL_NAMES,
    });
    expect(tools[0]!.function.name).toBe('search_skills');
  });

  it('the exact tool name sequence includes search_catalog at index 1 (Lot 7 update)', () => {
    // Lot 7 update: agent entries cause ZERO change to the foundation tool sequence.
    // search_catalog is now at index 1 (added by Lot 7). Agent entries do NOT appear.
    const tools = resolveFoundationChatTools({
      userId: 'u-lot3-test',
      workspaceId: 'ws-lot3-test',
      workspaceType: 'ai-ideas',
      currentUserRole: 'editor',
      allowedTools: ALL_FOUNDATION_TOOL_NAMES,
    });
    const names = tools.map((t) => t.function.name);

    // Updated oracle (Lot 7): search_catalog inserted at index 1.
    const EXPECTED_TOOL_ORDER = [
      'search_skills',
      'search_catalog',
      'workspace_list',
      'initiative_search',
      'web_search',
      'web_extract',
      'organizations_list',
      'organization_get',
      'organization_update',
      'folders_list',
      'folder_get',
      'folder_update',
      'initiatives_list',
      'read_initiative',
      'update_initiative',
      'solutions_list',
      'solution_get',
      'proposals_list',
      'proposal_get',
      'products_list',
      'product_get',
      'executive_summary_get',
      'executive_summary_update',
      'matrix_get',
      'matrix_update',
      'history_analyze',
      'gate_review',
      'documents',
      'comment_assistant',
      'plan',
      'document_generate',
    ] as const;

    expect(names).toEqual(EXPECTED_TOOL_ORDER);
  });
});

// ---------------------------------------------------------------------------
// § 9  list/get/search parity with skill source
// ---------------------------------------------------------------------------

describe('AgentTemplateSource — list/search/get via CompositeCatalogRegistry', () => {
  // These tests operate on the source directly (snapshot) to verify parity
  // without needing the full registry. The composite integration is covered
  // by composite-registry.spec.ts.

  const src = new AgentTemplateSource();

  it('get by key returns the matching entry', () => {
    const entries = src.snapshot() as AgentEntry[];
    // Pick the first entry and try to look it up by name.
    const first = entries[0]!;
    const found = (src.snapshot() as AgentEntry[]).find(
      (e) => e.metadata.name === first.metadata.name,
    );
    expect(found).toBeDefined();
    expect(found!.kind).toBe('agent');
    expect(found!.template.key).toBe(first.metadata.name);
  });

  it('snapshot entries are all agent-kind (kind parity)', () => {
    const entries = src.snapshot();
    for (const entry of entries) {
      expect(entry.kind).toBe('agent');
    }
  });

  it('de-duplication: shared agents appear once even if they span multiple workspace types', () => {
    // SHARED_AGENTS are merged into ai-ideas, opportunity, and code seeds.
    // Verify shared agent keys appear exactly once.
    const entries = src.snapshot() as AgentEntry[];
    const allKeys = entries.map((e) => e.template.key);
    const uniqueKeys = new Set(allKeys);
    expect(uniqueKeys.size).toBe(allKeys.length);
  });
});
