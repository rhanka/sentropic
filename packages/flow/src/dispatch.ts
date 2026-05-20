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
} from './condition-eval.js';
import type { WorkflowDispatchDescriptor } from './job-queue.js';
import type {
  WorkflowRuntimeDefinition,
  WorkflowTransitionDefinition,
} from './workflow-types.js';

export type DispatchScope = 'transitions' | 'fanout' | 'joins' | 'completion' | string;

export type WorkflowTaskRuntimeStatus =
  | 'pending'
  | 'in_progress'
  | 'completed'
  | 'failed';

export type ExecutionRunStatus = 'in_progress' | 'completed' | 'failed';

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
