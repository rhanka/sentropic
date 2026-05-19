/**
 * @sentropic/flow — runtime workflow definition shapes.
 *
 * Real reorganization (BR-26 Lot 7): these used to live as local
 * `type` declarations in `api/src/services/queue-manager.ts`
 * (`WorkflowTaskExecutionDefinition`, `WorkflowTransitionDefinition`,
 * `WorkflowRuntimeDefinition`). They describe a workflow as the
 * runtime sees it after `loadWorkflowRuntimeDefinition()` joins
 * `workflow_definition_tasks` + `workflow_task_transitions` from
 * Postgres.
 *
 * Lifting them into the package is the prerequisite for the
 * functional decomposition of the dispatch graph (see BR26-FB-03):
 * `dispatchWorkflowTransitions` and `dispatchWorkflowTask` need
 * these types as inputs without dragging them back from `api/`.
 *
 * `WorkflowDispatchDescriptor` lives in `./job-queue.ts` (the
 * JobQueue port already returns it).
 */

export interface WorkflowTaskExecutionDefinition {
  taskKey: string;
  orderIndex: number;
  agentDefinitionId: string | null;
  metadata: Record<string, unknown>;
}

export interface WorkflowTransitionDefinition {
  fromTaskKey: string | null;
  toTaskKey: string | null;
  transitionType: string;
  condition: Record<string, unknown>;
  metadata: Record<string, unknown>;
}

export interface WorkflowRuntimeDefinition {
  tasks: Map<string, WorkflowTaskExecutionDefinition>;
  transitions: WorkflowTransitionDefinition[];
  agentMap: Record<string, string>;
  agentIdsByKey: Record<string, string>;
}
