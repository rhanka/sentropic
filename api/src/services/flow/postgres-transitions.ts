import type {
  BindingResolutionContext,
  NextTaskComputation,
  Transitions,
  WorkflowCondition,
} from '@sentropic/flow';
import {
  assertTaskStatusTransition,
  type TaskStatus,
} from '../todo-runtime';

/**
 * Postgres-backed `Transitions` adapter.
 *
 * Lot 3 contract: only the methods with a public delegate today are
 * wired. The condition/binding/next-task helpers currently live as
 * private methods of `QueueManager`
 * (`evaluateWorkflowCondition`, `resolveWorkflowBindingValue`,
 * `dispatchWorkflowTransitions`). They will be lifted into the
 * adapter at Lot 7 alongside the queue extraction. Until then,
 * those methods throw to make accidental callers loud.
 *
 * Per spec/SPEC_EVOL_BR26_FLOW_FACADE.md §3 (façade design — no
 * logic moved, deferred to slice lots).
 */
export class PostgresTransitions implements Transitions<unknown, unknown, TaskStatus> {
  evaluateCondition(_condition: WorkflowCondition, _state: unknown): boolean {
    throw new Error(
      '[PostgresTransitions.evaluateCondition] not yet wired — pending Lot 7 ' +
        '(QueueManager.evaluateWorkflowCondition is currently private).',
    );
  }

  resolveBindingValue(_binding: string, _ctx: BindingResolutionContext<unknown>): unknown {
    throw new Error(
      '[PostgresTransitions.resolveBindingValue] not yet wired — pending Lot 7 ' +
        '(QueueManager.resolveWorkflowBindingValue is currently private).',
    );
  }

  computeNextTask(
    _definition: unknown,
    _currentTaskKey: string,
    _state: unknown,
  ): NextTaskComputation {
    throw new Error(
      '[PostgresTransitions.computeNextTask] not yet wired — pending Lot 7 ' +
        '(QueueManager.dispatchWorkflowTransitions is currently private).',
    );
  }

  assertStatusTransition(from: TaskStatus, to: TaskStatus): void {
    assertTaskStatusTransition(from, to);
  }
}

/**
 * Default singleton — only `assertStatusTransition` is callable today.
 */
export const postgresTransitions = new PostgresTransitions();
