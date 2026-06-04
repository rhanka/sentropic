/**
 * WorkflowSeedSource — `CatalogSource` for `workflow`-kind catalog entries
 * (BR-42b Lot 4)
 *
 * Exposes the code-level workflow seeds from `@sentropic/flow`
 * (`WORKSPACE_TYPE_WORKFLOW_SEEDS`) as `workflow`-kind `CatalogEntry` objects,
 * giving `list/search/get` parity with `skill`-kind entries from
 * `StaticCatalogSource`.
 *
 * Pre-check outcome (CASE 1 — both exported):
 *   Both `WORKSPACE_TYPE_WORKFLOW_SEEDS` (value) and `DefaultWorkflowDefinition`
 *   (type) are exported from the `@sentropic/flow` public entrypoint
 *   (`packages/flow/src/index.ts` lines 169–186). They are imported read-only here;
 *   `packages/flow/src/**` is NOT edited.
 *
 * D-WORKFLOW-SCOPE invariant (SPEC_EVOL_CATALOG §2.2):
 *   Only CODE-LEVEL SEEDS/TEMPLATES are catalogued here. Per-workspace DB rows
 *   (`workflow_definitions` table) are NOT projected into the catalog.
 *   `FlowRuntime` / `processing-loop` / `job-runner` stay in `@sentropic/flow` —
 *   NOT modified here.
 *
 * 0-regression invariant:
 *   `workflow`-kind entries are for discovery (list/search/get) ONLY. They are
 *   NOT wired into the `SkillsToolRegistry` or `resolveFoundationChatTools` path,
 *   so the resolved OpenAI chat tool set stays byte-identical to the pre-Lot-4
 *   baseline. `resolveFoundationChatTools` projects ONLY `skill`-kind entries.
 *
 * De-duplication policy:
 *   `WORKSPACE_TYPE_WORKFLOW_SEEDS` groups workflows by workspace type but the
 *   same workflow definition may theoretically appear in multiple groups. This
 *   source de-duplicates by `key`: the first occurrence wins (first workspace type
 *   that declares the workflow), same foundation-precedence policy as
 *   `CompositeCatalogRegistry`.
 *   The resulting snapshot contains one `WorkflowEntry` per unique workflow `key`.
 *
 * `metadata.name` mapping:
 *   A workflow's `key` is already in snake_case (e.g. `ai_usecase_generation_v1`),
 *   which is provider-safe. We use the key directly as `metadata.name` so that
 *   `get(key)` works without any transformation.
 *
 * Source id:  `'workflow-seeds'`
 * Source kind: `'static'` (in-process constant; no async refresh needed)
 */

import {
  WORKSPACE_TYPE_WORKFLOW_SEEDS,
  type DefaultWorkflowDefinition,
} from '@sentropic/flow';
import type { CatalogSource } from '../source.js';
import type { CatalogEntry, WorkflowEntry } from '../types.js';

// ---------------------------------------------------------------------------
// WorkflowSeedSource
// ---------------------------------------------------------------------------

/**
 * A `CatalogSource` backed by `WORKSPACE_TYPE_WORKFLOW_SEEDS` from
 * `@sentropic/flow`.
 *
 * Emits one `WorkflowEntry` per unique workflow key across all workspace-type
 * seed groups. The snapshot is always-fresh (in-process constant, no I/O, no cache).
 *
 * D-WORKFLOW-SCOPE invariant: per-workspace `workflow_definitions` DB rows are
 * NOT here. `FlowRuntime` / `processing-loop` / `job-runner` stay in
 * `@sentropic/flow` — UNTOUCHED.
 */
export class WorkflowSeedSource implements CatalogSource {
  readonly id: string;
  readonly kind = 'static' as const;

  private readonly entries: ReadonlyArray<WorkflowEntry>;

  /**
   * @param id  Source identifier. Defaults to `'workflow-seeds'`.
   */
  constructor(id = 'workflow-seeds') {
    this.id = id;
    this.entries = buildWorkflowEntries(id);
  }

  /**
   * SYNC — returns the pre-built workflow seed entries array.
   * Always-fresh: backed by compile-time constants; no I/O.
   */
  snapshot(): ReadonlyArray<CatalogEntry> {
    return this.entries;
  }

  // No `refresh()` — static sources are always-fresh by definition.
  // No `health()` — in-process constant; never unhealthy.

  /**
   * Return the number of distinct workflow seed entries in the snapshot.
   */
  get size(): number {
    return this.entries.length;
  }
}

// ---------------------------------------------------------------------------
// Build helper — de-duplicate workflow seeds by key
// ---------------------------------------------------------------------------

/**
 * Walk `WORKSPACE_TYPE_WORKFLOW_SEEDS`, collect unique `DefaultWorkflowDefinition`
 * objects (first-seen wins on duplicate key), and map each to a `WorkflowEntry`.
 *
 * D-WORKFLOW-SCOPE invariant: only code-level seeds; no DB queries, no
 * `workflow_definitions`.
 */
function buildWorkflowEntries(sourceId: string): ReadonlyArray<WorkflowEntry> {
  const seen = new Set<string>();
  const entries: WorkflowEntry[] = [];

  for (const seed of WORKSPACE_TYPE_WORKFLOW_SEEDS) {
    for (const workflow of seed.workflows) {
      if (seen.has(workflow.key)) continue; // de-duplicate: first workspace type wins
      seen.add(workflow.key);
      entries.push(workflowToEntry(workflow, sourceId));
    }
  }

  return entries;
}

/**
 * Map a `DefaultWorkflowDefinition` to a `WorkflowEntry`.
 *
 * `metadata.name` = `workflow.key` (already provider-safe snake_case).
 * `metadata.description` = `workflow.description` (required on the type; always present).
 * `metadata.category` = `'workflow'` (taxonomy tag for workflow-kind discovery).
 */
function workflowToEntry(
  workflow: DefaultWorkflowDefinition,
  sourceId: string,
): WorkflowEntry {
  return {
    kind: 'workflow',
    sourceId,
    metadata: {
      name: workflow.key,
      description: workflow.description,
      category: 'workflow',
    },
    workflow,
  };
}

// ---------------------------------------------------------------------------
// Module-level singleton (consumed by the wired catalog.ts)
// ---------------------------------------------------------------------------

/**
 * Singleton `WorkflowSeedSource` for all workspace-type workflow seeds.
 * Import this to wire workflow seeds into `CompositeCatalogRegistry`.
 *
 * The singleton emits only code-level seeds; per-workspace `workflow_definitions`
 * DB rows are NOT here (D-WORKFLOW-SCOPE invariant).
 */
export const workflowSeedSource = new WorkflowSeedSource('workflow-seeds');
