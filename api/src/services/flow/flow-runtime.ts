import {
  buildGenericWorkflowRunMetadata,
  buildGenericWorkflowRunState,
  buildGenericWorkflowStartedPayload,
  buildWorkflowTaskAssignments,
  getFirstWorkflowAgentDefinitionId,
  getFirstWorkflowTaskKey,
  type FlowRuntime,
  type FlowRuntimePorts,
  type StartInitiativeGenerationParams,
  type StartWorkflowParams,
} from '@sentropic/flow';
import { and, asc, eq } from 'drizzle-orm';
import { db } from '../../db/client';
import {
  executionEvents,
  executionRuns,
  workflowDefinitionTasks,
  workflowDefinitions,
  workflowRunState,
} from '../../db/schema';
import { createId } from '../../utils/id';
import {
  TodoOrchestrationError,
  todoOrchestrationService,
  type StartInitiativeGenerationWorkflowInput,
  type TodoActor,
  type WorkflowTaskAssignments,
  type InitiativeGenerationWorkflowRuntime,
  type StartInitiativeGenerationWorkflowDispatchResult,
} from '../todo-orchestration';
import type { JobData, JobType } from '../queue-manager';
import { postgresApprovalGate } from './postgres-approval-gate';
import { postgresAgentTemplate } from './postgres-agent-template';
import { postgresJobQueue } from './postgres-job-queue';
import { postgresRunStore } from './postgres-run-store';
import { postgresTransitions } from './postgres-transitions';
import { postgresWorkflowStore } from './postgres-workflow-store';

/**
 * App-level `StartWorkflow` input shape. The package interface uses
 * `workflowDefinitionId` as the lookup key, but the current
 * `todoOrchestrationService.startWorkflow` is keyed by `workflowKey`
 * (the workspace-scoped unique key). Until Lot 8 unifies the
 * vocabulary, the adapter accepts both — `workflowDefinitionId` is
 * treated as the key when it doesn't match a UUID shape.
 */
export interface AppStartWorkflowInput {
  workflowKey: string;
  metadata?: Record<string, unknown>;
}

export type AppStartWorkflowRuntime = {
  workflowRunId: string;
  workflowDefinitionId: string;
  taskAssignments: WorkflowTaskAssignments;
};

/**
 * `FlowRuntime` composition root for the app.
 *
 * Lot 3 contract: delegates every method to
 * `todoOrchestrationService`. Holds references to every port adapter
 * so consumers can drill into them after Lot 4..8 progressive moves.
 *
 * Per spec/SPEC_EVOL_BR26_FLOW_FACADE.md §3.
 */
export class AppFlowRuntime
  implements
    FlowRuntime<
      TodoActor,
      AppStartWorkflowInput | StartInitiativeGenerationWorkflowInput,
      AppStartWorkflowRuntime
        | InitiativeGenerationWorkflowRuntime
        | StartInitiativeGenerationWorkflowDispatchResult,
      unknown
    >
{
  readonly ports: FlowRuntimePorts<TodoActor, unknown, JobType, JobData>;

  constructor() {
    this.ports = {
      workflowStore: postgresWorkflowStore,
      runStore: postgresRunStore,
      jobQueue: postgresJobQueue,
      approvalGate: postgresApprovalGate,
      agentTemplate: postgresAgentTemplate,
      transitions: postgresTransitions,
    };
  }

  startWorkflow(
    params: StartWorkflowParams<TodoActor, AppStartWorkflowInput>,
  ): Promise<AppStartWorkflowRuntime> {
    return this.startWorkflowDirect(params);
  }

  private async startWorkflowDirect(
    params: StartWorkflowParams<TodoActor, AppStartWorkflowInput>,
  ): Promise<AppStartWorkflowRuntime> {
    const workflowKey = params.input.workflowKey;
    const metadata = params.input.metadata;
    const [wfDef] = await db
      .select()
      .from(workflowDefinitions)
      .where(
        and(
          eq(workflowDefinitions.workspaceId, params.actor.workspaceId),
          eq(workflowDefinitions.key, workflowKey),
        ),
      )
      .limit(1);

    if (!wfDef) {
      throw new TodoOrchestrationError(404, `Workflow not found: ${workflowKey}`);
    }

    const wfTasks = await db
      .select({
        taskKey: workflowDefinitionTasks.taskKey,
        agentDefinitionId: workflowDefinitionTasks.agentDefinitionId,
      })
      .from(workflowDefinitionTasks)
      .where(
        and(
          eq(workflowDefinitionTasks.workspaceId, params.actor.workspaceId),
          eq(workflowDefinitionTasks.workflowDefinitionId, wfDef.id),
        ),
      )
      .orderBy(asc(workflowDefinitionTasks.orderIndex), asc(workflowDefinitionTasks.createdAt));

    const taskAssignments = buildWorkflowTaskAssignments(wfTasks) as WorkflowTaskAssignments;
    const workflowRunId = createId();
    const now = new Date();

    await db.insert(executionRuns).values({
      id: workflowRunId,
      workspaceId: params.actor.workspaceId,
      planId: null,
      todoId: null,
      taskId: null,
      workflowDefinitionId: wfDef.id,
      agentDefinitionId: getFirstWorkflowAgentDefinitionId(wfTasks),
      mode: 'full_auto',
      status: 'in_progress',
      startedByUserId: params.actor.userId,
      startedAt: now,
      completedAt: null,
      metadata: buildGenericWorkflowRunMetadata({ workflowKey, metadata }),
      createdAt: now,
      updatedAt: now,
    });

    await db.insert(executionEvents).values({
      id: createId(),
      workspaceId: params.actor.workspaceId,
      runId: workflowRunId,
      eventType: 'workflow_started',
      actorType: 'user',
      actorId: params.actor.userId,
      payload: buildGenericWorkflowStartedPayload({
        workflowKey,
        workflowDefinitionId: wfDef.id,
        metadata,
      }),
      sequence: 1,
      createdAt: now,
    });

    await db.insert(workflowRunState).values({
      runId: workflowRunId,
      workspaceId: params.actor.workspaceId,
      workflowDefinitionId: wfDef.id,
      status: 'in_progress',
      state: buildGenericWorkflowRunState({ workflowKey, metadata }),
      version: 1,
      currentTaskKey: getFirstWorkflowTaskKey(wfTasks),
      currentTaskInstanceKey: 'main',
      checkpointedAt: now,
      createdAt: now,
      updatedAt: now,
    });

    await this.ports.jobQueue.dispatchWorkflowEntryTasks({
      workspaceId: params.actor.workspaceId,
      workflowRunId,
      workflowDefinitionId: wfDef.id,
    });

    return {
      workflowRunId,
      workflowDefinitionId: wfDef.id,
      taskAssignments,
    };
  }

  startInitiativeGenerationWorkflow(
    params: StartInitiativeGenerationParams<
      TodoActor,
      StartInitiativeGenerationWorkflowInput
    >,
  ): Promise<InitiativeGenerationWorkflowRuntime> {
    return todoOrchestrationService.startInitiativeGenerationWorkflow(
      params.actor,
      params.input,
    );
  }

  startAndDispatch(
    params: StartInitiativeGenerationParams<
      TodoActor,
      StartInitiativeGenerationWorkflowInput
    >,
  ): Promise<StartInitiativeGenerationWorkflowDispatchResult> {
    return todoOrchestrationService.startAndDispatchInitiativeGenerationWorkflow(
      params.actor,
      params.input,
    );
  }

  async pauseRun(actor: TodoActor, runId: string): Promise<void> {
    await todoOrchestrationService.pauseRun(actor, runId);
  }

  async resumeRun(actor: TodoActor, runId: string): Promise<void> {
    await todoOrchestrationService.resumeRun(actor, runId);
  }

  getSessionRuntime(actor: TodoActor, sessionId: string): Promise<unknown> {
    return todoOrchestrationService.getSessionTodoRuntime(actor, sessionId);
  }
}

export const flowRuntime = new AppFlowRuntime();
