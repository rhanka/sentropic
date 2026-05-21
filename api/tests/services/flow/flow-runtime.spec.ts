import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { db } from '../../../src/db/client';
import {
  agentDefinitions,
  executionEvents,
  executionRuns,
  jobQueue,
  workflowDefinitionTasks,
  workflowDefinitions,
  workflowRunState,
  workflowTaskResults,
  workflowTaskTransitions,
  workspaceMemberships,
  workspaceTypeWorkflows,
} from '../../../src/db/schema';
import { USE_CASE_GENERATION_WORKFLOW_KEY } from '../../../src/config/default-workflows';
import {
  todoOrchestrationService,
  type TodoActor,
} from '../../../src/services/todo-orchestration';
import { flowRuntime } from '../../../src/services/flow';
import { queueManager } from '../../../src/services/queue-manager';
import { cleanupAuthData, createAuthenticatedUser } from '../../utils/auth-helper';

describe('AppFlowRuntime', () => {
  let editor: Awaited<ReturnType<typeof createAuthenticatedUser>>;
  let actor: TodoActor;
  let processJobsSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    editor = await createAuthenticatedUser('editor');
    actor = {
      userId: editor.id,
      role: editor.role,
      workspaceId: editor.workspaceId!,
    };
    processJobsSpy = vi.spyOn(queueManager, 'processJobs').mockResolvedValue();
  });

  afterEach(async () => {
    processJobsSpy.mockRestore();
    if (editor?.workspaceId) {
      await db.delete(executionEvents).where(eq(executionEvents.workspaceId, editor.workspaceId));
      await db.delete(workflowTaskResults).where(eq(workflowTaskResults.workspaceId, editor.workspaceId));
      await db.delete(workflowRunState).where(eq(workflowRunState.workspaceId, editor.workspaceId));
      await db.delete(executionRuns).where(eq(executionRuns.workspaceId, editor.workspaceId));
      await db.delete(jobQueue).where(eq(jobQueue.workspaceId, editor.workspaceId));
      await db.delete(workspaceTypeWorkflows);
      await db.delete(workflowTaskTransitions).where(eq(workflowTaskTransitions.workspaceId, editor.workspaceId));
      await db.delete(workflowDefinitionTasks).where(eq(workflowDefinitionTasks.workspaceId, editor.workspaceId));
      await db.delete(workflowDefinitions).where(eq(workflowDefinitions.workspaceId, editor.workspaceId));
      await db.delete(agentDefinitions).where(eq(agentDefinitions.workspaceId, editor.workspaceId));
      await db.delete(workspaceMemberships).where(eq(workspaceMemberships.workspaceId, editor.workspaceId));
    }
    await cleanupAuthData();
    vi.restoreAllMocks();
  });

  it('starts generic workflows without delegating back to todoOrchestrationService.startWorkflow', async () => {
    await todoOrchestrationService.seedWorkflowsForType(actor, 'ai-ideas');
    const legacyStartWorkflow = vi
      .spyOn(todoOrchestrationService, 'startWorkflow')
      .mockRejectedValue(new Error('legacy startWorkflow delegate should not be called'));

    const result = await flowRuntime.startWorkflow({
      actor,
      workflowDefinitionId: USE_CASE_GENERATION_WORKFLOW_KEY,
      input: {
        workflowKey: USE_CASE_GENERATION_WORKFLOW_KEY,
        metadata: { source: 'flow-runtime-contract' },
      },
    });

    expect(legacyStartWorkflow).not.toHaveBeenCalled();
    expect(result.workflowRunId).toBeTruthy();
    expect(result.workflowDefinitionId).toBeTruthy();
    expect(Object.keys(result.taskAssignments).length).toBeGreaterThan(0);

    const [run] = await db
      .select({
        status: executionRuns.status,
        workflowDefinitionId: executionRuns.workflowDefinitionId,
        metadata: executionRuns.metadata,
      })
      .from(executionRuns)
      .where(and(eq(executionRuns.id, result.workflowRunId), eq(executionRuns.workspaceId, actor.workspaceId)))
      .limit(1);
    expect(run).toEqual(
      expect.objectContaining({
        status: 'in_progress',
        workflowDefinitionId: result.workflowDefinitionId,
        metadata: expect.objectContaining({
          workflowKey: USE_CASE_GENERATION_WORKFLOW_KEY,
          source: 'flow-runtime-contract',
        }),
      }),
    );

    const [state] = await db
      .select({
        status: workflowRunState.status,
        state: workflowRunState.state,
        currentTaskInstanceKey: workflowRunState.currentTaskInstanceKey,
      })
      .from(workflowRunState)
      .where(eq(workflowRunState.runId, result.workflowRunId))
      .limit(1);
    expect(state).toEqual(
      expect.objectContaining({
        status: 'in_progress',
        state: {
          workflowKey: USE_CASE_GENERATION_WORKFLOW_KEY,
          inputs: { source: 'flow-runtime-contract' },
        },
        currentTaskInstanceKey: 'main',
      }),
    );

    const [event] = await db
      .select({
        eventType: executionEvents.eventType,
        payload: executionEvents.payload,
        sequence: executionEvents.sequence,
      })
      .from(executionEvents)
      .where(eq(executionEvents.runId, result.workflowRunId))
      .limit(1);
    expect(event).toEqual(
      expect.objectContaining({
        eventType: 'workflow_started',
        payload: expect.objectContaining({
          workflowKey: USE_CASE_GENERATION_WORKFLOW_KEY,
          workflowDefinitionId: result.workflowDefinitionId,
          source: 'flow-runtime-contract',
        }),
        sequence: 1,
      }),
    );
  });
});
