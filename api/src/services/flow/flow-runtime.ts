import {
  DEFAULT_USE_CASE_GENERATION_WORKFLOW,
  buildInitialGenerationWorkflowState,
  buildGenericWorkflowRunMetadata,
  buildGenericWorkflowRunState,
  buildGenericWorkflowStartedPayload,
  buildInitiativeGenerationRunMetadata,
  buildInitiativeGenerationStartedPayload,
  buildWorkflowAgentMap,
  buildWorkflowTaskAssignments,
  getFirstWorkflowAgentDefinitionId,
  getFirstWorkflowTaskKey,
  getWorkflowSeedsForType,
  normalizeFlowMetadata,
  type FlowRuntime,
  type FlowRuntimePorts,
  type ResolvedWorkflowTask,
  type StartInitiativeGenerationParams,
  type StartWorkflowParams,
} from '@sentropic/flow';
import { and, asc, eq } from 'drizzle-orm';
import { db } from '../../db/client';
import {
  agentDefinitions,
  executionEvents,
  executionRuns,
  workflowDefinitionTasks,
  workflowDefinitions,
  workflowRunState,
  workspaces,
} from '../../db/schema';
import { createId } from '../../utils/id';
import {
  getAgentSeedsForType,
} from '../../config/default-agents';
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
 * Lot 8 progressively moves workflow orchestration behind this
 * composition root while legacy consumers keep their existing imports
 * until Lot N-3.
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
  ): Promise<InitiativeGenerationWorkflowRuntime & { resolvedTasks: ResolvedWorkflowTask[] }> {
    return this.startInitiativeGenerationWorkflowDirect(params);
  }

  private async startInitiativeGenerationWorkflowDirect(
    params: StartInitiativeGenerationParams<
      TodoActor,
      StartInitiativeGenerationWorkflowInput
    >,
  ): Promise<InitiativeGenerationWorkflowRuntime & { resolvedTasks: ResolvedWorkflowTask[] }> {
    const { workflowDefinitionId, workflowKey, agentMap, resolvedTasks } =
      await this.ensureInitiativeGenerationWorkflowDefinition(params.actor);
    const firstAgent = resolvedTasks.length > 0 ? resolvedTasks[0] : null;
    const workflowRunId = createId();
    const now = new Date();

    await db.insert(executionRuns).values({
      id: workflowRunId,
      workspaceId: params.actor.workspaceId,
      planId: null,
      todoId: null,
      taskId: null,
      workflowDefinitionId,
      agentDefinitionId: firstAgent?.agentDefinitionId ?? null,
      mode: 'full_auto',
      status: 'in_progress',
      startedByUserId: params.actor.userId,
      startedAt: now,
      completedAt: null,
      metadata: buildInitiativeGenerationRunMetadata({
        workflowKey,
        input: params.input,
      }),
      createdAt: now,
      updatedAt: now,
    });

    await db.insert(executionEvents).values({
      id: createId(),
      workspaceId: params.actor.workspaceId,
      runId: workflowRunId,
      eventType: 'workflow_generation_started',
      actorType: 'user',
      actorId: params.actor.userId,
      payload: buildInitiativeGenerationStartedPayload({
        workflowKey,
        workflowDefinitionId,
        input: params.input,
      }),
      sequence: 1,
      createdAt: now,
    });

    await db.insert(workflowRunState).values({
      runId: workflowRunId,
      workspaceId: params.actor.workspaceId,
      workflowDefinitionId,
      status: 'in_progress',
      state: buildInitialGenerationWorkflowState(workflowKey, params.input),
      version: 1,
      currentTaskKey: firstAgent?.taskKey ?? null,
      currentTaskInstanceKey: 'main',
      checkpointedAt: now,
      createdAt: now,
      updatedAt: now,
    });

    return {
      workflowRunId,
      workflowDefinitionId,
      agentMap,
      resolvedTasks,
    };
  }

  private async ensureInitiativeGenerationWorkflowDefinition(
    actor: TodoActor,
  ): Promise<{
    workflowDefinitionId: string;
    workflowKey: string;
    agentMap: Record<string, string>;
    resolvedTasks: ResolvedWorkflowTask[];
  }> {
    const [workspace] = await db
      .select({ type: workspaces.type })
      .from(workspaces)
      .where(eq(workspaces.id, actor.workspaceId))
      .limit(1);
    const workspaceType = workspace?.type ?? 'ai-priorities';
    const typeSeed = getWorkflowSeedsForType(workspaceType);
    const workflowSeed = typeSeed?.workflows[0] ?? DEFAULT_USE_CASE_GENERATION_WORKFLOW;

    const agentSeed = getAgentSeedsForType(workspaceType);
    if (agentSeed) {
      await todoOrchestrationService.seedAgentsForType(actor, agentSeed.agents);
    }

    await this.ports.workflowStore.seedForWorkspaceType(
      actor,
      typeSeed ? workspaceType : 'ai-priorities',
    );

    const [workflowDefinition] = await db
      .select({ id: workflowDefinitions.id })
      .from(workflowDefinitions)
      .where(
        and(
          eq(workflowDefinitions.workspaceId, actor.workspaceId),
          eq(workflowDefinitions.key, workflowSeed.key),
        ),
      )
      .limit(1);

    if (!workflowDefinition) {
      throw new TodoOrchestrationError(
        500,
        `Missing workflow definition for key ${workflowSeed.key}`,
      );
    }

    const resolvedTasks = await this.resolveWorkflowTasksWithAgents(
      actor.workspaceId,
      workflowDefinition.id,
    );

    return {
      workflowDefinitionId: workflowDefinition.id,
      workflowKey: workflowSeed.key,
      agentMap: buildWorkflowAgentMap(resolvedTasks),
      resolvedTasks,
    };
  }

  private async resolveWorkflowTasksWithAgents(
    workspaceId: string,
    workflowDefinitionId: string,
  ): Promise<ResolvedWorkflowTask[]> {
    const rows = await db
      .select({
        taskKey: workflowDefinitionTasks.taskKey,
        orderIndex: workflowDefinitionTasks.orderIndex,
        agentDefinitionId: workflowDefinitionTasks.agentDefinitionId,
        agentConfig: agentDefinitions.config,
      })
      .from(workflowDefinitionTasks)
      .leftJoin(
        agentDefinitions,
        eq(workflowDefinitionTasks.agentDefinitionId, agentDefinitions.id),
      )
      .where(
        and(
          eq(workflowDefinitionTasks.workspaceId, workspaceId),
          eq(workflowDefinitionTasks.workflowDefinitionId, workflowDefinitionId),
        ),
      )
      .orderBy(asc(workflowDefinitionTasks.orderIndex), asc(workflowDefinitionTasks.createdAt));

    return rows.map((row) => {
      const config = normalizeFlowMetadata(row.agentConfig);
      return {
        taskKey: row.taskKey,
        orderIndex: row.orderIndex,
        agentDefinitionId: row.agentDefinitionId ?? null,
        agentRole: typeof config.role === 'string' ? config.role : null,
        agentPromptTemplate:
          typeof config.promptTemplate === 'string' ? config.promptTemplate : null,
      };
    });
  }

  startAndDispatch(
    params: StartInitiativeGenerationParams<
      TodoActor,
      StartInitiativeGenerationWorkflowInput
    >,
  ): Promise<StartInitiativeGenerationWorkflowDispatchResult> {
    return this.startAndDispatchDirect(params);
  }

  private async startAndDispatchDirect(
    params: StartInitiativeGenerationParams<
      TodoActor,
      StartInitiativeGenerationWorkflowInput
    >,
  ): Promise<StartInitiativeGenerationWorkflowDispatchResult> {
    const workflowRuntime = await this.startInitiativeGenerationWorkflow(params);
    const dispatched = await this.ports.jobQueue.dispatchWorkflowEntryTasks({
      workspaceId: params.actor.workspaceId,
      workflowRunId: workflowRuntime.workflowRunId,
      workflowDefinitionId: workflowRuntime.workflowDefinitionId,
    });
    const matrixJobId = dispatched.find((entry) => entry.jobType === 'matrix_generate')?.jobId;
    const primaryDispatch =
      dispatched.find((entry) => entry.jobType === 'initiative_list') ??
      dispatched.find((entry) => entry.jobType === 'organization_batch_create') ??
      dispatched[0];
    const resolvedJobId = primaryDispatch?.jobId;
    if (!resolvedJobId) {
      throw new TodoOrchestrationError(500, 'No generation job could be dispatched');
    }

    return {
      workflowRunId: workflowRuntime.workflowRunId,
      workflowDefinitionId: workflowRuntime.workflowDefinitionId,
      agentMap: workflowRuntime.agentMap,
      jobId: resolvedJobId,
      matrixJobId,
    };
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
