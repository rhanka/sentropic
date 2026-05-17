/**
 * @sentropic/flow — public surface.
 *
 * Port interfaces only. Concrete adapters live in the application
 * (`api/src/services/flow/postgres-*.ts`) and are wired through the
 * `FlowRuntime` composition root.
 *
 * Per spec/SPEC_EVOL_BR26_FLOW_FACADE.md §2 (boundary inventory) and
 * §3 (façade design).
 *
 * Lot 3 lands the port files in slices to keep commits ≤150 LOC:
 *   Step 1: workflow-store + run-store + transitions (data ports).
 *   Step 1b: job-queue + approval-gate + agent-template (effect ports).
 *   Step 1c: flow-runtime composition + final exports.
 */

export type {
  WorkflowStore,
  WorkspaceTypeWorkflowEntry,
} from './workflow-store.js';

export type {
  MergeStateParams,
  RunStatus,
  RunStore,
  TaskResultParams,
  WorkflowRunStateSnapshot,
} from './run-store.js';

export type {
  DispatchWorkflowEntryParams,
  EnqueueOptions,
  JobQueue,
  QueuedJob,
  WorkflowDispatchDescriptor,
} from './job-queue.js';

export type {
  ApprovalGate,
  GateConfig,
  GateCriteria,
  GateDecision,
  GateEvaluationResult,
  GateMode,
} from './approval-gate.js';

export type {
  AgentTemplate,
  ResolvedAgentConfig,
} from './agent-template.js';

export type {
  BindingResolutionContext,
  ConditionOperator,
  NextTaskComputation,
  Transitions,
  WorkflowCondition,
} from './transitions.js';

export type {
  FlowRuntime,
  FlowRuntimePorts,
  StartInitiativeGenerationParams,
  StartWorkflowParams,
} from './flow-runtime.js';

// ---------------------------------------------------------------------------
// Seed catalogs (pure data) — BR-26 Lot 5
// ---------------------------------------------------------------------------

export type {
  DefaultWorkflowDefinition,
  DefaultWorkflowTaskDefinition,
  DefaultWorkflowTransitionDefinition,
  GenerationAgentKey,
  InitiativeGenerationWorkflowTaskKey,
  WorkspaceTypeWorkflowSeed,
} from './seeds/workflows.js';

export {
  CODE_ANALYSIS_WORKFLOW,
  DEFAULT_USE_CASE_GENERATION_WORKFLOW,
  OPPORTUNITY_IDENTIFICATION_WORKFLOW,
  OPPORTUNITY_QUALIFICATION_WORKFLOW,
  USE_CASE_GENERATION_WORKFLOW_KEY,
  WORKSPACE_TYPE_WORKFLOW_SEEDS,
  getWorkflowSeedsForType,
} from './seeds/workflows.js';
