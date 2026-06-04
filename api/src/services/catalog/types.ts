/**
 * Unified Capability Catalog — entry types (BR-42b Lot 1)
 *
 * All five entry kinds are defined here as a discriminated union keyed by `kind`.
 * Only the `skill` kind is populated in Lot 1; the other four are type-only
 * placeholders that will carry real payloads in later lots.
 *
 * Design invariant (SPEC_EVOL_CATALOG §3.1):
 *   `CatalogEntryMetadata` = the GENUINE INTERSECTION of the five kinds.
 *   Skill-specific fields (`sandbox`, `toolNames`) live in the `SkillEntry`
 *   payload (inside the `Skill` object), never in shared metadata.
 */

import type { ContextFilter, Skill, SkillAuthzRequirements, SkillTool } from '../../../../packages/skills/src/index.js';
import type { DefaultGenerationAgentDefinition } from '../../config/default-agents-types.js';
import type { DefaultWorkflowDefinition } from '@sentropic/flow';

// ---------------------------------------------------------------------------
// Discriminant
// ---------------------------------------------------------------------------

export type CatalogEntryKind = 'skill' | 'tool' | 'agent' | 'workflow' | 'canvas';

// ---------------------------------------------------------------------------
// Shared metadata — the intersection of all five kinds
// ---------------------------------------------------------------------------

/**
 * Fields that are genuinely common across every catalog entry kind.
 *
 * Anything kind-specific (a skill's `sandbox`/`toolNames`, a tool's `rawName`,
 * an agent's `config`, a workflow's `tasks`/`transitions`, a canvas template's
 * `mimeType`/`initialContent`) belongs in the per-kind payload below, never here.
 */
export interface CatalogEntryMetadata {
  /** Provider-safe public identifier. Kebab-case. Globally unique within the catalog. */
  readonly name: string;
  /** Human-readable description (≤ 280 chars) used for discovery. */
  readonly description: string;
  /** Semver version string — optional because not every kind is versioned. */
  readonly version?: string;
  /** Free taxonomy tag — optional. */
  readonly category?: string;
  /** Availability gating — optional; omitted means always available. */
  readonly contextFilter?: ContextFilter;
  /** Fine-grained authz requirements — optional. */
  readonly authzRequirements?: SkillAuthzRequirements;
}

// ---------------------------------------------------------------------------
// Base — every entry carries a kind discriminant, shared metadata, and
// a provenance tag pointing back to the source that emitted it.
// ---------------------------------------------------------------------------

export interface CatalogEntryBase {
  readonly kind: CatalogEntryKind;
  readonly metadata: CatalogEntryMetadata;
  /** Which `CatalogSource.id` produced this entry. */
  readonly sourceId: string;
}

// ---------------------------------------------------------------------------
// Per-kind payload entries
// ---------------------------------------------------------------------------

/**
 * Skill entry — the only fully-populated kind in Lot 1.
 * The `skill` payload carries the full `Skill` bundle (metadata + tools + body
 * + optional handlers + optional sandboxEntry). Skill-specific metadata fields
 * (`sandbox`, `toolNames`) are accessible via `entry.skill.metadata`, NOT on
 * `entry.metadata`.
 */
export type SkillEntry = CatalogEntryBase & {
  readonly kind: 'skill';
  /** Full skill bundle from `@sentropic/skills`. */
  readonly skill: Skill;
};

/**
 * Tool entry — makes a standalone tool a first-class catalog entry.
 * Primarily for MCP-sourced tools (Lot 5) and standalone code tools (Lot 2).
 * `rawName` holds the provider's native name when it cannot be used as the
 * public `metadata.name` (e.g. MCP `mcp:<server>/<tool>` with `:` and `/`).
 *
 * Type-only placeholder in Lot 1; populated in Lot 2.
 */
export type ToolEntry = CatalogEntryBase & {
  readonly kind: 'tool';
  /** Single tool descriptor (from `@sentropic/skills` `SkillTool`). */
  readonly tool: SkillTool;
  /** Original provider name when it differs from the public `metadata.name`. */
  readonly rawName?: string;
};

/**
 * Agent template entry — catalogs code-level agent templates from
 * `api/src/config/default-agents.ts` (`DefaultGenerationAgentDefinition`).
 * Per-workspace DB `agent_definitions` rows are NOT catalogued (§14 invariant).
 *
 * Populated in Lot 3 via `AgentTemplateSource`.
 */
export type AgentEntry = CatalogEntryBase & {
  readonly kind: 'agent';
  /**
   * The code-level agent template definition from `default-agents.ts`.
   * Per-workspace DB `agent_definitions` rows are NOT carried here.
   */
  readonly template: DefaultGenerationAgentDefinition;
};

/**
 * Re-export for consumers that only need the agent template payload type.
 * The canonical type is `DefaultGenerationAgentDefinition` from
 * `api/src/config/default-agents-types.ts`.
 */
export type { DefaultGenerationAgentDefinition as AgentEntryTemplate };

/**
 * Workflow entry — catalogs code-level workflow seed orchestration templates
 * from `@sentropic/flow` `WORKSPACE_TYPE_WORKFLOW_SEEDS`
 * (`DefaultWorkflowDefinition`). Per-workspace DB `workflow_definitions` rows
 * are NOT catalogued (D-WORKFLOW-SCOPE invariant).
 *
 * Populated in Lot 4 via `WorkflowSeedSource`.
 */
export type WorkflowEntry = CatalogEntryBase & {
  readonly kind: 'workflow';
  /**
   * The code-level workflow seed template from `@sentropic/flow`.
   * Per-workspace DB `workflow_definitions` rows are NOT carried here.
   */
  readonly workflow: DefaultWorkflowDefinition;
};

/**
 * Re-export for consumers that only need the workflow template payload type.
 * The canonical type is `DefaultWorkflowDefinition` from `@sentropic/flow`.
 */
export type { DefaultWorkflowDefinition as WorkflowEntryTemplate };

/**
 * Canvas template entry — catalogs `LiveDocumentRef`-shaped artifact template
 * starters. The `LiveDocumentStore`/CRDT/editor runtime is carved out to
 * `SPEC_EVOL_CHAT_CANVAS` and NOT included here.
 *
 * Type-only placeholder in Lot 1; populated in Lot 6.
 */
export type CanvasEntry = CatalogEntryBase & {
  readonly kind: 'canvas';
  /** Canvas template payload (LiveDocumentRef-shaped starter). */
  readonly template: CanvasTemplate;
};

/**
 * Minimal placeholder for a canvas/live-document artifact template.
 * Mirrors §10.3 `LiveDocumentRef` from `SPEC_STUDY_ARCHITECTURE_BOUNDARIES.md`.
 */
export interface CanvasTemplate {
  readonly id: string;
  readonly title: string;
  readonly mimeType: string;
  readonly initialContent?: string;
  readonly schema?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Discriminated union
// ---------------------------------------------------------------------------

/** The five-kind unified catalog entry union. */
export type CatalogEntry = SkillEntry | ToolEntry | AgentEntry | WorkflowEntry | CanvasEntry;
