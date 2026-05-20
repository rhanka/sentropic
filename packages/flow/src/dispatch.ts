/**
 * @sentropic/flow — workflow dispatch graph (pure functions).
 *
 * Real reorganization (BR-26 Lot 7, see BR26-FB-03):
 * the dispatch graph (`dispatchWorkflowTransitions`,
 * `dispatchReadyWorkflowJoins`) used to be private methods of
 * `QueueManager`. They are extracted here as pure functions taking
 * a `WorkflowDispatchDeps` parameter that wires the side-effecting
 * neighbours (run-store writes, execution-run status, the recursive
 * `dispatchTask`, the join-readiness query) without dragging the
 * full `QueueManager` along.
 *
 * The pure helpers used here (`evaluateWorkflowCondition`,
 * `getPathValue`, `buildWorkflowTaskInstanceKey`, `isRecord`) are
 * imported from `./condition-eval.js` so this module stays
 * I/O-free except via `deps`.
 */

import {
  buildWorkflowTaskInstanceKey,
  evaluateWorkflowCondition,
  getPathValue,
  isRecord,
  resolveWorkflowBindingValue,
} from './condition-eval.js';
import type { WorkflowDispatchDescriptor } from './job-queue.js';
import type {
  WorkflowRuntimeContext,
  WorkflowRuntimeDefinition,
  WorkflowTaskExecutionDefinition,
  WorkflowTransitionDefinition,
} from './workflow-types.js';

export type DispatchScope = 'transitions' | 'fanout' | 'joins' | 'completion' | string;

export type WorkflowTaskRuntimeStatus =
  | 'pending'
  | 'in_progress'
  | 'completed'
  | 'failed';

export type ExecutionRunStatus = 'in_progress' | 'completed' | 'failed';

export interface UpsertTaskResultParams {
  workflow: WorkflowRuntimeContext;
  workspaceId: string;
  taskInstanceKey: string;
  status: WorkflowTaskRuntimeStatus;
  inputPayload?: Record<string, unknown>;
  output?: Record<string, unknown>;
  statePatch?: Record<string, unknown>;
  attempts?: number;
  lastError?: Record<string, unknown> | null;
  startedAt?: Date | null;
  completedAt?: Date | null;
}

export interface ReserveTaskDispatchParams {
  workflowRunId: string;
  workflowDefinitionId: string;
  workspaceId: string;
  taskKey: string;
  taskInstanceKey: string;
  inputPayload: Record<string, unknown>;
}

export interface EnqueueJobOptions {
  workspaceId?: string;
  maxRetries?: number;
}

export interface WorkflowDispatchDeps<TJobType = string> {
  /** Returns true when dispatch should be skipped (e.g. cancellation in flight). */
  canSkipDispatch(scope: DispatchScope, workflowRunId: string): boolean;
  /** Persist a workflow-run state mutation (status, currentTaskKey, …). */
  mergeRunState(params: {
    runId: string;
    status?: WorkflowTaskRuntimeStatus;
    currentTaskKey?: string | null;
    currentTaskInstanceKey?: string | null;
  }): Promise<void>;
  /** Persist the underlying execution_run status alongside the workflow run. */
  markExecutionStatus(workflowRunId: string, status: ExecutionRunStatus): Promise<void>;
  /** Recursive call into the per-task dispatch. */
  dispatchTask(params: {
    workspaceId: string;
    workflowRunId: string;
    workflowDefinitionId: string;
    runtimeDefinition: WorkflowRuntimeDefinition;
    runContext: Record<string, unknown>;
    state: Record<string, unknown>;
    taskKey: string;
    taskInstanceKey: string;
    item?: unknown;
  }): Promise<WorkflowDispatchDescriptor<TJobType>[]>;
  /** Returns true when a `join` transition has gathered all its required inputs. */
  isJoinReady(params: {
    workflowRunId: string;
    runtimeDefinition: WorkflowRuntimeDefinition;
    transition: WorkflowTransitionDefinition;
    state: Record<string, unknown>;
  }): Promise<boolean>;
  /** Read the current persisted status for a (run, task, instance). */
  getTaskResultStatus(
    workflowRunId: string,
    taskKey: string,
    taskInstanceKey: string,
  ): Promise<WorkflowTaskRuntimeStatus | null>;
  /** Atomically reserve a row for a fresh task dispatch. Returns false on conflict. */
  reserveTaskDispatch(params: ReserveTaskDispatchParams): Promise<boolean>;
  /** Upsert the persisted task result (status / output / statePatch / retry meta). */
  upsertTaskResult(params: UpsertTaskResultParams): Promise<void>;
  /** Enqueue an executor job. Returns the generated job id. */
  enqueueJob(
    jobType: TJobType,
    data: Record<string, unknown>,
    opts?: EnqueueJobOptions,
  ): Promise<string>;
}

/**
 * Resolve the agent definition id for a task: applies
 * `metadata.agentSelection.rules` (condition-matched) and falls back
 * to `metadata.agentSelection.defaultAgentKey`, then to
 * `task.agentDefinitionId`. Pure — depends only on the package-local
 * condition evaluator.
 *
 * Real reorganization (BR-26 Lot 7): ex
 * `QueueManager.resolveWorkflowTaskAgentDefinitionId`.
 */
export function resolveWorkflowTaskAgentDefinitionId(
  task: WorkflowTaskExecutionDefinition,
  state: Record<string, unknown>,
  agentIdsByKey: Record<string, string>,
): string | null {
  const metadata = isRecord(task.metadata) ? task.metadata : {};
  const selection = isRecord(metadata.agentSelection) ? metadata.agentSelection : null;
  if (!selection) {
    return task.agentDefinitionId;
  }
  const rules = Array.isArray(selection.rules) ? selection.rules : [];
  for (const rule of rules) {
    if (!isRecord(rule)) continue;
    if (!evaluateWorkflowCondition(rule.condition, state)) continue;
    const agentKey = typeof rule.agentKey === 'string' ? rule.agentKey : null;
    if (agentKey && agentIdsByKey[agentKey]) {
      return agentIdsByKey[agentKey];
    }
  }
  const defaultAgentKey =
    typeof selection.defaultAgentKey === 'string' ? selection.defaultAgentKey : null;
  if (defaultAgentKey && agentIdsByKey[defaultAgentKey]) {
    return agentIdsByKey[defaultAgentKey];
  }
  return task.agentDefinitionId;
}

export interface WorkflowTaskDispatchParams {
  workspaceId: string;
  workflowRunId: string;
  workflowDefinitionId: string;
  runtimeDefinition: WorkflowRuntimeDefinition;
  runContext: Record<string, unknown>;
  state: Record<string, unknown>;
  taskKey: string;
  taskInstanceKey: string;
  item?: unknown;
}

export interface WorkflowTransitionsDispatchParams {
  workspaceId: string;
  workflowRunId: string;
  workflowDefinitionId: string;
  runtimeDefinition: WorkflowRuntimeDefinition;
  runContext: Record<string, unknown>;
  state: Record<string, unknown>;
  fromTaskKey: string | null;
}

/**
 * Dispatch every transition matching `fromTaskKey`. Handles `end`,
 * `fanout`, `join`, and regular linear transitions. Equivalent in
 * behavior to the old `QueueManager.dispatchWorkflowTransitions`
 * (replay byte-identity preserved).
 */
export async function dispatchWorkflowTransitions<TJobType = string>(
  params: WorkflowTransitionsDispatchParams,
  deps: WorkflowDispatchDeps<TJobType>,
): Promise<WorkflowDispatchDescriptor<TJobType>[]> {
  const matchingTransitions = params.runtimeDefinition.transitions.filter(
    (transition) => transition.fromTaskKey === params.fromTaskKey,
  );
  const dispatched: WorkflowDispatchDescriptor<TJobType>[] = [];
  for (const transition of matchingTransitions) {
    if (deps.canSkipDispatch('transitions', params.workflowRunId)) {
      return dispatched;
    }
    const conditionMatches = evaluateWorkflowCondition(transition.condition, params.state);
    if (!conditionMatches) {
      continue;
    }
    if (transition.transitionType === 'end' || !transition.toTaskKey) {
      await deps.mergeRunState({
        runId: params.workflowRunId,
        status: 'completed',
        currentTaskKey: params.fromTaskKey,
        currentTaskInstanceKey: 'main',
      });
      await deps.markExecutionStatus(params.workflowRunId, 'completed');
      continue;
    }
    if (transition.transitionType === 'fanout') {
      const fanout = isRecord(transition.metadata.fanout) ? transition.metadata.fanout : {};
      const sourcePath = typeof fanout.sourcePath === 'string' ? fanout.sourcePath : null;
      if (!sourcePath) {
        continue;
      }
      const sourceItems = getPathValue(params.state, sourcePath);
      if (!Array.isArray(sourceItems)) {
        continue;
      }
      for (const [index, item] of sourceItems.entries()) {
        if (deps.canSkipDispatch('fanout', params.workflowRunId)) {
          return dispatched;
        }
        dispatched.push(
          ...(await deps.dispatchTask({
            workspaceId: params.workspaceId,
            workflowRunId: params.workflowRunId,
            workflowDefinitionId: params.workflowDefinitionId,
            runtimeDefinition: params.runtimeDefinition,
            runContext: params.runContext,
            state: params.state,
            taskKey: transition.toTaskKey,
            taskInstanceKey: buildWorkflowTaskInstanceKey(
              item,
              index,
              transition.metadata,
              transition.toTaskKey,
            ),
            item,
          })),
        );
      }
      continue;
    }
    if (transition.transitionType === 'join') {
      const isReady = await deps.isJoinReady({
        workflowRunId: params.workflowRunId,
        runtimeDefinition: params.runtimeDefinition,
        transition,
        state: params.state,
      });
      if (!isReady) {
        continue;
      }
      dispatched.push(
        ...(await deps.dispatchTask({
          workspaceId: params.workspaceId,
          workflowRunId: params.workflowRunId,
          workflowDefinitionId: params.workflowDefinitionId,
          runtimeDefinition: params.runtimeDefinition,
          runContext: params.runContext,
          state: params.state,
          taskKey: transition.toTaskKey,
          taskInstanceKey: 'main',
        })),
      );
      continue;
    }
    dispatched.push(
      ...(await deps.dispatchTask({
        workspaceId: params.workspaceId,
        workflowRunId: params.workflowRunId,
        workflowDefinitionId: params.workflowDefinitionId,
        runtimeDefinition: params.runtimeDefinition,
        runContext: params.runContext,
        state: params.state,
        taskKey: transition.toTaskKey,
        taskInstanceKey: 'main',
      })),
    );
  }
  return dispatched;
}

export interface WorkflowJoinsDispatchParams {
  workspaceId: string;
  workflowRunId: string;
  workflowDefinitionId: string;
  runtimeDefinition: WorkflowRuntimeDefinition;
  runContext: Record<string, unknown>;
  state: Record<string, unknown>;
}

/**
 * Scan every join transition and dispatch the ones whose inputs are
 * all ready. Equivalent to the old
 * `QueueManager.dispatchReadyWorkflowJoins` (replay byte-identity
 * preserved).
 */
export async function dispatchReadyWorkflowJoins<TJobType = string>(
  params: WorkflowJoinsDispatchParams,
  deps: WorkflowDispatchDeps<TJobType>,
): Promise<WorkflowDispatchDescriptor<TJobType>[]> {
  const dispatched: WorkflowDispatchDescriptor<TJobType>[] = [];
  for (const transition of params.runtimeDefinition.transitions) {
    if (deps.canSkipDispatch('joins', params.workflowRunId)) {
      return dispatched;
    }
    if (transition.transitionType !== 'join' || !transition.toTaskKey) {
      continue;
    }
    if (!evaluateWorkflowCondition(transition.condition, params.state)) {
      continue;
    }
    const isReady = await deps.isJoinReady({
      workflowRunId: params.workflowRunId,
      runtimeDefinition: params.runtimeDefinition,
      transition,
      state: params.state,
    });
    if (!isReady) {
      continue;
    }
    dispatched.push(
      ...(await deps.dispatchTask({
        workspaceId: params.workspaceId,
        workflowRunId: params.workflowRunId,
        workflowDefinitionId: params.workflowDefinitionId,
        runtimeDefinition: params.runtimeDefinition,
        runContext: params.runContext,
        state: params.state,
        taskKey: transition.toTaskKey,
        taskInstanceKey: 'main',
      })),
    );
  }
  return dispatched;
}

/**
 * Dispatch a single workflow task instance: resolves the input
 * payload via bindings, reserves the task row, then either marks the
 * task `completed` immediately (`executor: 'noop'`) and recursively
 * dispatches downstream transitions, or enqueues an executor job
 * (`executor: 'job'`) whose `jobType` comes from `metadata.jobType`.
 *
 * Real reorganization (BR-26 Lot 7): ex `QueueManager.dispatchWorkflowTask`.
 * Behavior-preserving — replay byte-identical.
 */
export async function dispatchWorkflowTask<TJobType extends string = string>(
  params: WorkflowTaskDispatchParams,
  deps: WorkflowDispatchDeps<TJobType>,
): Promise<WorkflowDispatchDescriptor<TJobType>[]> {
  if (deps.canSkipDispatch(`task:${params.taskKey}`, params.workflowRunId)) {
    return [];
  }

  const task = params.runtimeDefinition.tasks.get(params.taskKey);
  if (!task) return [];

  const metadata = isRecord(task.metadata) ? task.metadata : {};
  const executor = typeof metadata.executor === 'string' ? metadata.executor : 'noop';
  const inputBindings = isRecord(metadata.inputBindings) ? metadata.inputBindings : {};
  const resolvedPayload = resolveWorkflowBindingValue(inputBindings, {
    state: params.state,
    run: params.runContext,
    item: params.item,
  });
  const inputPayload = isRecord(resolvedPayload) ? resolvedPayload : {};
  const agentDefinitionId = resolveWorkflowTaskAgentDefinitionId(
    task,
    params.state,
    params.runtimeDefinition.agentIdsByKey,
  );
  const workflowContext: WorkflowRuntimeContext = {
    workflowRunId: params.workflowRunId,
    workflowDefinitionId: params.workflowDefinitionId,
    taskKey: params.taskKey,
    agentDefinitionId,
    agentMap: {
      ...params.runtimeDefinition.agentMap,
      ...(agentDefinitionId ? { [params.taskKey]: agentDefinitionId } : {}),
    },
  };

  const existingStatus = await deps.getTaskResultStatus(
    params.workflowRunId,
    params.taskKey,
    params.taskInstanceKey,
  );
  if (existingStatus && existingStatus !== 'failed') {
    return [];
  }
  if (!existingStatus) {
    const reserved = await deps.reserveTaskDispatch({
      workflowRunId: params.workflowRunId,
      workflowDefinitionId: params.workflowDefinitionId,
      workspaceId: params.workspaceId,
      taskKey: params.taskKey,
      taskInstanceKey: params.taskInstanceKey,
      inputPayload,
    });
    if (!reserved) {
      return [];
    }
  }

  if (executor === 'noop') {
    const now = new Date();
    await deps.upsertTaskResult({
      workflow: workflowContext,
      workspaceId: params.workspaceId,
      taskInstanceKey: params.taskInstanceKey,
      status: 'completed',
      inputPayload,
      output: {},
      statePatch: {},
      attempts: 1,
      lastError: null,
      startedAt: now,
      completedAt: now,
    });
    await deps.mergeRunState({
      runId: params.workflowRunId,
      status: 'in_progress',
      currentTaskKey: params.taskKey,
      currentTaskInstanceKey: params.taskInstanceKey,
    });
    return dispatchWorkflowTransitions<TJobType>(
      {
        workspaceId: params.workspaceId,
        workflowRunId: params.workflowRunId,
        workflowDefinitionId: params.workflowDefinitionId,
        runtimeDefinition: params.runtimeDefinition,
        runContext: params.runContext,
        state: params.state,
        fromTaskKey: params.taskKey,
      },
      deps,
    );
  }

  if (executor === 'job') {
    const jobType =
      typeof metadata.jobType === 'string' ? (metadata.jobType as TJobType) : null;
    if (!jobType) {
      throw new Error(`Workflow task ${params.taskKey} is missing metadata.jobType`);
    }
    await deps.upsertTaskResult({
      workflow: workflowContext,
      workspaceId: params.workspaceId,
      taskInstanceKey: params.taskInstanceKey,
      status: 'pending',
      inputPayload,
      output: {},
      statePatch: {},
      attempts: 0,
      lastError: null,
      startedAt: null,
      completedAt: null,
    });
    let jobId: string;
    try {
      jobId = await deps.enqueueJob(
        jobType,
        {
          ...inputPayload,
          workflow: workflowContext,
        },
        { workspaceId: params.workspaceId, maxRetries: 1 },
      );
    } catch (error) {
      await deps.upsertTaskResult({
        workflow: workflowContext,
        workspaceId: params.workspaceId,
        taskInstanceKey: params.taskInstanceKey,
        status: 'failed',
        inputPayload,
        output: {},
        statePatch: {},
        attempts: 0,
        lastError: {
          name: error instanceof Error ? error.name : 'Error',
          message: error instanceof Error ? error.message : String(error),
        },
        startedAt: null,
        completedAt: new Date(),
      });
      throw error;
    }
    await deps.mergeRunState({
      runId: params.workflowRunId,
      status: 'in_progress',
      currentTaskKey: params.taskKey,
      currentTaskInstanceKey: params.taskInstanceKey,
    });
    return [
      {
        taskKey: params.taskKey,
        taskInstanceKey: params.taskInstanceKey,
        executor,
        jobType,
        jobId,
      },
    ];
  }

  throw new Error(`Unsupported workflow executor "${executor}" for task ${params.taskKey}`);
}
