/**
 * Façade re-exports for the flow runtime.
 *
 * App consumers (chat-service, route handlers) should import the
 * `flowRuntime` singleton from here so the underlying composition
 * can evolve through Lots 4..8 without touching call sites. The
 * actual rebinding of every consumer happens at Lot N-3 under
 * `BR26-EX3`.
 *
 * Per spec/SPEC_EVOL_BR26_FLOW_FACADE.md §3.
 */
export { flowRuntime, AppFlowRuntime } from './flow-runtime';
export type {
  AppStartWorkflowInput,
  AppStartWorkflowRuntime,
} from './flow-runtime';

export {
  postgresApprovalGate,
  PostgresApprovalGate,
} from './postgres-approval-gate';
export {
  postgresAgentTemplate,
  PostgresAgentTemplate,
} from './postgres-agent-template';
export {
  postgresJobQueue,
  PostgresJobQueue,
} from './postgres-job-queue';
export {
  postgresRunStore,
  PostgresRunStore,
} from './postgres-run-store';
export {
  postgresTransitions,
  PostgresTransitions,
} from './postgres-transitions';
export {
  postgresWorkflowStore,
  PostgresWorkflowStore,
} from './postgres-workflow-store';
