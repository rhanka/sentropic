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
