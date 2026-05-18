import type {
  MergeStateParams,
  RunStatus,
  RunStore,
  TaskResultParams,
  WorkflowRunStateSnapshot,
} from '@sentropic/flow';
import { and, eq } from 'drizzle-orm';
import { db } from '../../db/client';
import { executionRuns, workflowRunState, workflowTaskResults } from '../../db/schema';

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function deepMergeState(base: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const next: Record<string, unknown> = { ...base };
  for (const [key, patchValue] of Object.entries(patch)) {
    const currentValue = next[key];
    if (isRecord(currentValue) && isRecord(patchValue)) {
      next[key] = deepMergeState(currentValue, patchValue);
      continue;
    }
    next[key] = patchValue;
  }
  return next;
}

/**
 * Postgres-backed `RunStore` adapter.
 *
 * Lot 6: owns the `workflow_run_state` + `workflow_task_results` CRUD
 * previously embedded as private QueueManager helpers. QueueManager now
 * delegates the persistence step here and keeps orchestration/dispatch only.
 *
 * Per spec/SPEC_EVOL_BR26_FLOW_FACADE.md §3 and §4 (Lot 6 slice).
 */
export class PostgresRunStore implements RunStore<unknown> {
  async getSnapshot(runId: string): Promise<WorkflowRunStateSnapshot<unknown> | null> {
    const [row] = await db
      .select({
        runId: workflowRunState.runId,
        workspaceId: workflowRunState.workspaceId,
        workflowDefinitionId: workflowRunState.workflowDefinitionId,
        status: workflowRunState.status,
        state: workflowRunState.state,
        version: workflowRunState.version,
        currentTaskKey: workflowRunState.currentTaskKey,
        currentTaskInstanceKey: workflowRunState.currentTaskInstanceKey,
        checkpointedAt: workflowRunState.checkpointedAt,
      })
      .from(workflowRunState)
      .where(eq(workflowRunState.runId, runId))
      .limit(1);

    if (!row) return null;
    return {
      runId: row.runId,
      workspaceId: row.workspaceId,
      workflowDefinitionId: row.workflowDefinitionId ?? null,
      status: row.status,
      state: isRecord(row.state) ? row.state : {},
      version: row.version ?? 1,
      currentTaskKey: row.currentTaskKey ?? null,
      currentTaskInstanceKey: row.currentTaskInstanceKey ?? null,
      checkpointedAt: row.checkpointedAt ?? null,
    };
  }

  async mergeState(params: MergeStateParams<unknown>): Promise<WorkflowRunStateSnapshot<unknown>> {
    const current = await this.getSnapshot(params.runId);
    if (!current) {
      throw new Error(`Workflow run state ${params.runId} was not found`);
    }
    if (current.version !== params.expectedVersion) {
      throw new Error(
        `Workflow run state version conflict for ${params.runId}: expected ` +
          `${params.expectedVersion}, found ${current.version}`,
      );
    }

    const hasPatch = params.patch !== undefined;
    const patch = isRecord(params.patch) ? params.patch : {};
    const nextState = hasPatch ? deepMergeState(current.state as Record<string, unknown>, patch) : current.state;
    const nextVersion = hasPatch ? current.version + 1 : current.version;
    const now = new Date();

    const updatedRows = await db
      .update(workflowRunState)
      .set({
        status: params.status ?? current.status,
        state: nextState,
        version: nextVersion,
        currentTaskKey:
          Object.prototype.hasOwnProperty.call(params, 'currentTaskKey')
            ? (params.currentTaskKey ?? null)
            : current.currentTaskKey,
        currentTaskInstanceKey:
          Object.prototype.hasOwnProperty.call(params, 'currentTaskInstanceKey')
            ? (params.currentTaskInstanceKey ?? null)
            : current.currentTaskInstanceKey,
        checkpointedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(workflowRunState.runId, params.runId),
          eq(workflowRunState.version, params.expectedVersion),
        ),
      )
      .returning({ runId: workflowRunState.runId });

    if (updatedRows.length === 0) {
      throw new Error(`Workflow run state version conflict for ${params.runId}`);
    }

    const next = await this.getSnapshot(params.runId);
    if (!next) {
      throw new Error(`Workflow run state ${params.runId} disappeared after merge`);
    }
    return next;
  }

  async upsertTaskResult(params: TaskResultParams): Promise<void> {
    const snapshot = await this.getSnapshot(params.runId);
    if (!snapshot) {
      throw new Error(`Workflow run state ${params.runId} was not found`);
    }
    const now = new Date();
    const status = params.status ?? 'pending';
    const insertValues = {
      runId: params.runId,
      workspaceId: snapshot.workspaceId,
      workflowDefinitionId: snapshot.workflowDefinitionId,
      taskKey: params.taskKey,
      taskInstanceKey: params.taskInstanceKey,
      status,
      inputPayload: isRecord(params.input) ? params.input : {},
      output: isRecord(params.output) ? params.output : {},
      statePatch: params.statePatch ?? {},
      attempts: params.attempts ?? 1,
      lastError: params.lastError ?? null,
      startedAt: params.startedAt ?? (status === 'pending' ? null : now),
      completedAt:
        params.completedAt ??
        (status === 'completed' || status === 'failed' || status === 'cancelled' ? now : null),
      createdAt: now,
      updatedAt: now,
    };
    await db
      .insert(workflowTaskResults)
      .values(insertValues)
      .onConflictDoUpdate({
        target: [
          workflowTaskResults.runId,
          workflowTaskResults.taskKey,
          workflowTaskResults.taskInstanceKey,
        ],
        set: {
          status: insertValues.status,
          inputPayload: insertValues.inputPayload,
          output: insertValues.output,
          statePatch: insertValues.statePatch,
          attempts: insertValues.attempts,
          lastError: insertValues.lastError,
          ...(params.startedAt !== undefined ? { startedAt: params.startedAt } : {}),
          ...(params.completedAt !== undefined ? { completedAt: params.completedAt } : {}),
          updatedAt: now,
        },
      });
  }

  async markTaskStarted(
    params: Pick<TaskResultParams, 'runId' | 'taskKey' | 'taskInstanceKey' | 'input'>,
  ): Promise<void> {
    const snapshot = await this.getSnapshot(params.runId);
    if (!snapshot) return;
    await this.upsertTaskResult({
      ...params,
      status: 'in_progress',
      output: {},
      statePatch: {},
      attempts: 1,
      lastError: null,
    });
    await this.mergeState({
      runId: params.runId,
      expectedVersion: snapshot.version,
      status: 'in_progress',
      currentTaskKey: params.taskKey,
      currentTaskInstanceKey: params.taskInstanceKey,
    });
    await this.markRunStatus(params.runId, 'in_progress');
  }

  async completeTask(params: TaskResultParams): Promise<void> {
    const snapshot = await this.getSnapshot(params.runId);
    if (!snapshot) return;
    await this.upsertTaskResult({ ...params, status: 'completed', lastError: null });
    await this.mergeState({
      runId: params.runId,
      expectedVersion: snapshot.version,
      patch: params.statePatch ?? {},
      status: 'in_progress',
      currentTaskKey: params.taskKey,
      currentTaskInstanceKey: params.taskInstanceKey,
    });
  }

  async failTask(params: TaskResultParams & { lastError: string }): Promise<void> {
    const snapshot = await this.getSnapshot(params.runId);
    if (!snapshot) return;
    await this.upsertTaskResult({ ...params, status: 'failed' });
    await this.mergeState({
      runId: params.runId,
      expectedVersion: snapshot.version,
      status: 'failed',
      currentTaskKey: params.taskKey,
      currentTaskInstanceKey: params.taskInstanceKey,
    });
    await this.markRunStatus(params.runId, 'failed');
  }

  async markRunStatus(runId: string, status: RunStatus): Promise<void> {
    const now = new Date();
    await db
      .update(executionRuns)
      .set({
        status,
        completedAt:
          status === 'completed' || status === 'failed' || status === 'cancelled' ? now : null,
        updatedAt: now,
      })
      .where(eq(executionRuns.id, runId));
  }
}

export const postgresRunStore = new PostgresRunStore();
