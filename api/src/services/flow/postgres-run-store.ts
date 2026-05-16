import type {
  MergeStateParams,
  RunStatus,
  RunStore,
  TaskResultParams,
  WorkflowRunStateSnapshot,
} from '@sentropic/flow';

/**
 * Postgres-backed `RunStore` adapter.
 *
 * Lot 3 contract: every method delegates to the matching helper of
 * `queueManager`. Today those helpers are **private** to the class
 * (`getWorkflowRunStateSnapshot`, `mergeWorkflowRunState`,
 * `upsertWorkflowTaskResult`, `markWorkflowTaskStarted`,
 * `completeWorkflowTask`, `failWorkflowTask`,
 * `markExecutionRunStatus`). Exposing them publicly is a Lot 6 move
 * (Slice 3: `workflow_run_state` CRUD → RunStore). Until then the
 * adapter throws to make accidental callers loud and to preserve the
 * Lot 3 "no logic moved" invariant.
 *
 * Per spec/SPEC_EVOL_BR26_FLOW_FACADE.md §3 and §4 (Lot 6 slice).
 */
export class PostgresRunStore implements RunStore<unknown> {
  getSnapshot(_runId: string): Promise<WorkflowRunStateSnapshot<unknown> | null> {
    throw new Error(
      '[PostgresRunStore.getSnapshot] not yet wired — pending Lot 6 ' +
        '(QueueManager.getWorkflowRunStateSnapshot is currently private).',
    );
  }

  mergeState(_params: MergeStateParams<unknown>): Promise<WorkflowRunStateSnapshot<unknown>> {
    throw new Error(
      '[PostgresRunStore.mergeState] not yet wired — pending Lot 6 ' +
        '(QueueManager.mergeWorkflowRunState is currently private).',
    );
  }

  upsertTaskResult(_params: TaskResultParams): Promise<void> {
    throw new Error(
      '[PostgresRunStore.upsertTaskResult] not yet wired — pending Lot 6 ' +
        '(QueueManager.upsertWorkflowTaskResult is currently private).',
    );
  }

  markTaskStarted(
    _params: Pick<TaskResultParams, 'runId' | 'taskKey' | 'taskInstanceKey' | 'input'>,
  ): Promise<void> {
    throw new Error(
      '[PostgresRunStore.markTaskStarted] not yet wired — pending Lot 6 ' +
        '(QueueManager.markWorkflowTaskStarted is currently private).',
    );
  }

  completeTask(_params: TaskResultParams): Promise<void> {
    throw new Error(
      '[PostgresRunStore.completeTask] not yet wired — pending Lot 6 ' +
        '(QueueManager.completeWorkflowTask is currently private).',
    );
  }

  failTask(_params: TaskResultParams & { lastError: string }): Promise<void> {
    throw new Error(
      '[PostgresRunStore.failTask] not yet wired — pending Lot 6 ' +
        '(QueueManager.failWorkflowTask is currently private).',
    );
  }

  markRunStatus(_runId: string, _status: RunStatus): Promise<void> {
    throw new Error(
      '[PostgresRunStore.markRunStatus] not yet wired — pending Lot 6 ' +
        '(QueueManager.markExecutionRunStatus is currently private).',
    );
  }
}

export const postgresRunStore = new PostgresRunStore();
