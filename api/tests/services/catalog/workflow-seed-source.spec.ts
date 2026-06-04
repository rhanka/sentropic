/**
 * WorkflowSeedSource — unit tests (BR-42b Lot 4)
 *
 * Covers:
 *   - Flow seeds → `workflow`-kind entries (shape, count, de-duplication by key)
 *   - `list/search/get` parity with the skill/agent source pattern
 *   - `snapshot()` is synchronous and always-fresh (no I/O)
 *   - Source id / kind identity
 *   - CatalogEntryMetadata carries the shared intersection fields
 *   - D-WORKFLOW-SCOPE invariant: per-workspace DB rows are NOT catalogued;
 *     only code-level seeds from WORKSPACE_TYPE_WORKFLOW_SEEDS appear in the
 *     snapshot
 *   - Source import is from `@sentropic/flow` (NOT from `api/`)
 *   - 0-regression: workflow entries are absent from the resolved OpenAI chat
 *     tool set produced by `resolveFoundationChatTools` (they must NOT leak into
 *     the 28-tool order oracle from the characterization spec)
 */

import { describe, expect, it } from 'vitest';

import {
  WORKSPACE_TYPE_WORKFLOW_SEEDS,
} from '@sentropic/flow';
import {
  WorkflowSeedSource,
  workflowSeedSource,
} from '../../../src/services/catalog/sources/workflow-seed-source';
import type { WorkflowEntry } from '../../../src/services/catalog/types';
import {
  FOUNDATION_SKILLS,
} from '../../../../packages/skills/src/index';
import {
  resolveFoundationChatTools,
} from '../../../src/services/skills/catalog';

// ---------------------------------------------------------------------------
// Helpers / fixtures
// ---------------------------------------------------------------------------

/** All unique workflow keys across all workspace-type seeds (first-seen wins). */
const UNIQUE_WORKFLOW_KEYS = (() => {
  const seen = new Set<string>();
  const keys: string[] = [];
  for (const seed of WORKSPACE_TYPE_WORKFLOW_SEEDS) {
    for (const workflow of seed.workflows) {
      if (!seen.has(workflow.key)) {
        seen.add(workflow.key);
        keys.push(workflow.key);
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

describe('workflowSeedSource singleton', () => {
  it('has id "workflow-seeds" and kind "static"', () => {
    expect(workflowSeedSource.id).toBe('workflow-seeds');
    expect(workflowSeedSource.kind).toBe('static');
  });

  it('is an instance of WorkflowSeedSource', () => {
    expect(workflowSeedSource).toBeInstanceOf(WorkflowSeedSource);
  });
});

// ---------------------------------------------------------------------------
// § 2  snapshot() — synchronous and always-fresh
// ---------------------------------------------------------------------------

describe('WorkflowSeedSource.snapshot() — sync + always-fresh', () => {
  it('is synchronous — returns an array, not a Promise', () => {
    const src = new WorkflowSeedSource();
    const result = src.snapshot();
    expect(result).toBeInstanceOf(Array);
    expect((result as unknown as { then?: unknown }).then).toBeUndefined();
  });

  it('returns the same reference on repeated calls (no recomputation)', () => {
    const src = new WorkflowSeedSource();
    const a = src.snapshot();
    const b = src.snapshot();
    expect(a).toBe(b);
  });

  it('has no refresh() method (static sources are always-fresh)', () => {
    const src = new WorkflowSeedSource();
    expect((src as { refresh?: unknown }).refresh).toBeUndefined();
  });

  it('has no health() method', () => {
    const src = new WorkflowSeedSource();
    expect((src as { health?: unknown }).health).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// § 3  Entries — workflow-kind, count, and de-duplication
// ---------------------------------------------------------------------------

describe('WorkflowSeedSource — entries count and de-duplication', () => {
  const src = new WorkflowSeedSource();
  const entries = src.snapshot() as WorkflowEntry[];

  it('contains exactly one entry per unique workflow key across all workspace types', () => {
    // The source de-duplicates by key; same foundation-precedence policy as
    // CompositeCatalogRegistry.
    expect(entries).toHaveLength(UNIQUE_WORKFLOW_KEYS.length);
  });

  it('no duplicate metadata.name in the snapshot', () => {
    const names = entries.map((e) => e.metadata.name);
    const uniqueNames = new Set(names);
    expect(uniqueNames.size).toBe(names.length);
  });

  it('all entries have kind="workflow"', () => {
    for (const entry of entries) {
      expect(entry.kind).toBe('workflow');
    }
  });

  it('all entries have sourceId matching the source id', () => {
    for (const entry of entries) {
      expect(entry.sourceId).toBe('workflow-seeds');
    }
  });

  it('size property matches snapshot length', () => {
    expect(src.size).toBe(entries.length);
  });

  it('snapshot is non-empty (at least one workflow seed exists)', () => {
    expect(entries.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// § 4  CatalogEntryMetadata — shared intersection fields
// ---------------------------------------------------------------------------

describe('WorkflowSeedSource — CatalogEntryMetadata fields', () => {
  const src = new WorkflowSeedSource();
  const entries = src.snapshot() as WorkflowEntry[];

  it('each entry.metadata.name equals entry.workflow.key (provider-safe mapping)', () => {
    for (const entry of entries) {
      expect(entry.metadata.name).toBe(entry.workflow.key);
    }
  });

  it('each entry.metadata.description equals entry.workflow.description', () => {
    for (const entry of entries) {
      expect(entry.metadata.description).toBe(entry.workflow.description);
      expect(entry.metadata.description.length).toBeGreaterThan(0);
    }
  });

  it('each entry.metadata.category is "workflow"', () => {
    for (const entry of entries) {
      expect(entry.metadata.category).toBe('workflow');
    }
  });

  it('entries have no version (workflow seeds are not semver-versioned)', () => {
    for (const entry of entries) {
      expect(entry.metadata.version).toBeUndefined();
    }
  });

  it('entries have no contextFilter (no workspace-type gating on seeds)', () => {
    for (const entry of entries) {
      expect(entry.metadata.contextFilter).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// § 5  Workflow payload round-trip
// ---------------------------------------------------------------------------

describe('WorkflowSeedSource — workflow payload', () => {
  const src = new WorkflowSeedSource();
  const entries = src.snapshot() as WorkflowEntry[];

  it('each entry.workflow.key is a non-empty string', () => {
    for (const entry of entries) {
      expect(typeof entry.workflow.key).toBe('string');
      expect(entry.workflow.key.length).toBeGreaterThan(0);
    }
  });

  it('each entry.workflow.name is a non-empty string', () => {
    for (const entry of entries) {
      expect(typeof entry.workflow.name).toBe('string');
      expect(entry.workflow.name.length).toBeGreaterThan(0);
    }
  });

  it('each entry.workflow.description is a non-empty string', () => {
    for (const entry of entries) {
      expect(typeof entry.workflow.description).toBe('string');
      expect(entry.workflow.description.length).toBeGreaterThan(0);
    }
  });

  it('each entry.workflow.tasks is a non-empty readonly array', () => {
    for (const entry of entries) {
      expect(Array.isArray(entry.workflow.tasks)).toBe(true);
      expect(entry.workflow.tasks.length).toBeGreaterThan(0);
    }
  });

  it('each entry.workflow.transitions is an array', () => {
    for (const entry of entries) {
      expect(Array.isArray(entry.workflow.transitions)).toBe(true);
    }
  });

  it('each entry.workflow.config is a non-null object', () => {
    for (const entry of entries) {
      expect(typeof entry.workflow.config).toBe('object');
      expect(entry.workflow.config).not.toBeNull();
    }
  });

  it('all expected unique workflow keys appear in the snapshot (completeness check)', () => {
    const snapshotKeys = (src.snapshot() as WorkflowEntry[]).map((e) => e.workflow.key);
    for (const key of UNIQUE_WORKFLOW_KEYS) {
      expect(snapshotKeys).toContain(key);
    }
  });
});

// ---------------------------------------------------------------------------
// § 6  Custom source id
// ---------------------------------------------------------------------------

describe('WorkflowSeedSource — custom id', () => {
  it('accepts a custom id and sets it on entries', () => {
    const src = new WorkflowSeedSource('my-workflows');
    expect(src.id).toBe('my-workflows');
    const entries = src.snapshot() as WorkflowEntry[];
    for (const entry of entries) {
      expect(entry.sourceId).toBe('my-workflows');
    }
  });
});

// ---------------------------------------------------------------------------
// § 7  D-WORKFLOW-SCOPE invariant — no DB-row leakage; only code-level seeds
// ---------------------------------------------------------------------------

describe('D-WORKFLOW-SCOPE invariant — only flow seeds are catalogued', () => {
  const src = new WorkflowSeedSource();
  const entries = src.snapshot() as WorkflowEntry[];

  it('snapshot count equals WORKSPACE_TYPE_WORKFLOW_SEEDS unique-key count (no extra DB rows)', () => {
    // If DB rows were leaking in, this count would differ.
    // We verify it equals the compile-time constant unique key count.
    expect(entries.length).toBe(UNIQUE_WORKFLOW_KEYS.length);
    expect(entries.length).toBeGreaterThan(0);
  });

  it('source imports from @sentropic/flow (not from api/ internals)', () => {
    // This is a structural invariant: WORKSPACE_TYPE_WORKFLOW_SEEDS is the same
    // object reference as the one exported by @sentropic/flow. We verify it by
    // confirming the seeds we receive are identical to what the source uses.
    const snapshotWorkflows = entries.map((e) => e.workflow);
    const allFlowWorkflows: ReturnType<typeof WORKSPACE_TYPE_WORKFLOW_SEEDS[number]['workflows'][number]>[] = [];
    const seen = new Set<string>();
    for (const seed of WORKSPACE_TYPE_WORKFLOW_SEEDS) {
      for (const wf of seed.workflows) {
        if (!seen.has(wf.key)) {
          seen.add(wf.key);
          allFlowWorkflows.push(wf as ReturnType<typeof WORKSPACE_TYPE_WORKFLOW_SEEDS[number]['workflows'][number]>);
        }
      }
    }
    // Each workflow in the snapshot must have been sourced from WORKSPACE_TYPE_WORKFLOW_SEEDS.
    for (const wf of snapshotWorkflows) {
      const found = allFlowWorkflows.find((fw) => fw.key === wf.key);
      expect(found).toBeDefined();
      // Object identity: the source passes the workflow definition through unchanged.
      expect(wf).toBe(found);
    }
  });
});

// ---------------------------------------------------------------------------
// § 8  0-regression — workflow entries MUST NOT enter the resolved chat tool set
// ---------------------------------------------------------------------------

describe('0-regression — workflow entries absent from resolveFoundationChatTools', () => {
  it('workflow keys are NOT in the resolved tool set', () => {
    // resolveFoundationChatTools projects ONLY skill-kind entries via
    // SkillsToolRegistry. Workflow entries are in the composite registry for
    // discovery but must NOT appear in the resolved chat tool array.
    const tools = resolveFoundationChatTools({
      userId: 'u-lot4-test',
      workspaceId: 'ws-lot4-test',
      workspaceType: 'ai-ideas',
      currentUserRole: 'editor',
      allowedTools: ALL_FOUNDATION_TOOL_NAMES,
    });

    const toolNames = new Set(tools.map((t) => t.function.name));

    // Sanity: there must be workflow keys to validate (non-empty).
    expect(UNIQUE_WORKFLOW_KEYS.length).toBeGreaterThan(0);

    // None of the workflow keys should appear in the resolved tool set.
    for (const key of UNIQUE_WORKFLOW_KEYS) {
      expect(toolNames.has(key)).toBe(false);
    }
  });

  it('the 28-tool count oracle is byte-identical after wiring the workflow source', () => {
    // This mirrors the characterization spec §7: 1 search_skills + 27 foundation tools.
    // Adding the workflow source to the composite registry must NOT add any tool to this count.
    const tools = resolveFoundationChatTools({
      userId: 'u-lot4-test',
      workspaceId: 'ws-lot4-test',
      workspaceType: 'ai-ideas',
      currentUserRole: 'editor',
      allowedTools: ALL_FOUNDATION_TOOL_NAMES,
    });
    // search_skills (1) + all foundation tools (27)
    expect(tools).toHaveLength(1 + ALL_FOUNDATION_TOOL_NAMES.length);
    expect(tools[0]!.function.name).toBe('search_skills');
  });

  it('search_skills is still the FIRST tool after adding the workflow source', () => {
    const tools = resolveFoundationChatTools({
      userId: 'u-lot4-test',
      workspaceId: 'ws-lot4-test',
      workspaceType: 'ai-ideas',
      currentUserRole: 'editor',
      allowedTools: ALL_FOUNDATION_TOOL_NAMES,
    });
    expect(tools[0]!.function.name).toBe('search_skills');
  });

  it('the exact 28-tool name sequence is byte-identical to the pre-Lot-4 oracle', () => {
    // This is the definitive proof: workflow entries cause ZERO change to the
    // resolved tool sequence. Any change here would be a regression.
    const tools = resolveFoundationChatTools({
      userId: 'u-lot4-test',
      workspaceId: 'ws-lot4-test',
      workspaceType: 'ai-ideas',
      currentUserRole: 'editor',
      allowedTools: ALL_FOUNDATION_TOOL_NAMES,
    });
    const names = tools.map((t) => t.function.name);

    // Byte-identical oracle (same as catalog-characterization.spec.ts § 7).
    const EXPECTED_TOOL_ORDER = [
      'search_skills',
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
// § 9  list/get/search parity with skill/agent source
// ---------------------------------------------------------------------------

describe('WorkflowSeedSource — list/search/get via snapshot', () => {
  // These tests operate on the source directly (snapshot) to verify parity
  // without needing the full registry. The composite integration is covered
  // by composite-registry.spec.ts.

  const src = new WorkflowSeedSource();

  it('get by key returns the matching entry', () => {
    const entries = src.snapshot() as WorkflowEntry[];
    // Pick the first entry and try to look it up by name.
    const first = entries[0]!;
    const found = (src.snapshot() as WorkflowEntry[]).find(
      (e) => e.metadata.name === first.metadata.name,
    );
    expect(found).toBeDefined();
    expect(found!.kind).toBe('workflow');
    expect(found!.workflow.key).toBe(first.metadata.name);
  });

  it('snapshot entries are all workflow-kind (kind parity)', () => {
    const entries = src.snapshot();
    for (const entry of entries) {
      expect(entry.kind).toBe('workflow');
    }
  });

  it('de-duplication: workflows appear once even if declared in multiple workspace types', () => {
    const entries = src.snapshot() as WorkflowEntry[];
    const allKeys = entries.map((e) => e.workflow.key);
    const uniqueKeys = new Set(allKeys);
    expect(uniqueKeys.size).toBe(allKeys.length);
  });
});
