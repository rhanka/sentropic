/**
 * @sentropic/flow — Transitions port.
 *
 * Pure (no DB) port for evaluating workflow conditions and computing
 * the next-task transition. Mirrors the private helpers
 * `QueueManager.evaluateWorkflowCondition`,
 * `resolveWorkflowBindingValue`, plus
 * `todo-runtime.assertTaskStatusTransition`.
 *
 * Per spec/SPEC_EVOL_BR26_FLOW_FACADE.md §2.
 */

export type ConditionOperator = 'eq' | 'not_empty' | 'all' | 'any' | 'not';

export interface WorkflowCondition {
  operator: ConditionOperator;
  /** Path into the workflow run state for the lhs value. */
  lhs?: string;
  /** rhs value for `eq`. */
  value?: unknown;
  /** Nested operands for `all` / `any` / `not`. */
  operands?: WorkflowCondition[];
}

export interface BindingResolutionContext<TState = unknown> {
  state: TState;
  taskOutputs?: Record<string, unknown>;
  runMetadata?: Record<string, unknown>;
}

export interface NextTaskComputation {
  nextTaskKey: string | null;
  /** For `fanout` transitions: the per-instance keys to dispatch. */
  fanoutInstances?: string[];
  /** Reason a transition was skipped (for replay equality). */
  reason?: string;
}

export interface Transitions<TState = unknown, TWorkflowDef = unknown, TTaskStatus = string> {
  /** Evaluate a workflow condition against a run state snapshot. */
  evaluateCondition(condition: WorkflowCondition, state: TState): boolean;

  /** Resolve a binding (path string) into a concrete value. */
  resolveBindingValue(binding: string, ctx: BindingResolutionContext<TState>): unknown;

  /**
   * Compute the next task to dispatch after `currentTaskKey` completes.
   * Returns `nextTaskKey: null` for terminal transitions.
   */
  computeNextTask(
    definition: TWorkflowDef,
    currentTaskKey: string,
    state: TState,
  ): NextTaskComputation;

  /**
   * Assert a status transition is allowed (FSM check). Throws when
   * the transition is rejected.
   */
  assertStatusTransition(from: TTaskStatus, to: TTaskStatus): void;
}
