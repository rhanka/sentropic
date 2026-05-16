import type {
  FlowRuntime,
  FlowRuntimePorts,
  StartInitiativeGenerationParams,
  StartWorkflowParams,
} from '@sentropic/flow';
import {
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
    return todoOrchestrationService.startWorkflow(
      params.actor,
      params.input.workflowKey,
      params.input.metadata,
    );
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
