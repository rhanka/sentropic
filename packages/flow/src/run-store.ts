/**
 * @sentropic/flow — RunStore port.
 *
 * CRUD over `workflow_run_state` + `workflow_task_results` with
 * strict OCC (optimistic concurrency control via `version` column).
 *
 * Mirrors the private helpers currently embedded in `queue-manager.ts`:
 *   - `getWorkflowRunStateSnapshot` → `getSnapshot`
 *   - `mergeWorkflowRunState`       → `mergeState`
 *   - `upsertWorkflowTaskResult`    → `upsertTaskResult`
 *   - `markWorkflowTaskStarted`     → `markTaskStarted`
 *   - `completeWorkflowTask`        → `completeTask`
 *   - `failWorkflowTask`            → `failTask`
 *   - `markExecutionRunStatus`      → `markRunStatus`
 *
 * Per spec/SPEC_EVOL_BR26_FLOW_FACADE.md §2 + §6 (BR26-Q4: include
 * `version`, `sequence`, and `attempts` in the byte-identical replay
 * equality check).
 */

export interface WorkflowRunStateSnapshot<TState = unknown> {
  runId: string;
  workspaceId: string;
  workflowDefinitionId: string | null;
  status: string;
  state: TState;
  version: number;
  currentTaskKey: string | null;
  currentTaskInstanceKey: string | null;
  checkpointedAt: Date | null;
}

export interface MergeStateParams<TState = unknown> {
  runId: string;
  patch: Partial<TState> | TState;
  expectedVersion: number;
  currentTaskKey?: string | null;
  currentTaskInstanceKey?: string | null;
}

export interface TaskResultParams<TInput = unknown, TOutput = unknown> {
  runId: string;
  taskKey: string;
  taskInstanceKey: string;
  input?: TInput;
  output?: TOutput;
  statePatch?: Record<string, unknown>;
  attempts?: number;
  lastError?: string | null;
}

export type RunStatus =
  | 'pending'
  | 'in_progress'
  | 'paused'
  | 'blocked'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface RunStore<TState = unknown> {
  getSnapshot(runId: string): Promise<WorkflowRunStateSnapshot<TState> | null>;

  /**
   * Merge a state patch with strict OCC. Returns the new version on
   * success; throws or returns null on version conflict (the adapter
   * may retry up to N times — current implementation: 5).
   */
  mergeState(params: MergeStateParams<TState>): Promise<WorkflowRunStateSnapshot<TState>>;

  upsertTaskResult(params: TaskResultParams): Promise<void>;

  markTaskStarted(params: Pick<TaskResultParams, 'runId' | 'taskKey' | 'taskInstanceKey' | 'input'>): Promise<void>;

  completeTask(params: TaskResultParams): Promise<void>;

  failTask(params: TaskResultParams & { lastError: string }): Promise<void>;

  markRunStatus(runId: string, status: RunStatus): Promise<void>;
}
