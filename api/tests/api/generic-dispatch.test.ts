import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../../src/db/client";
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
} from "../../src/db/schema";
import { createAuthenticatedUser, cleanupAuthData } from "../utils/auth-helper";
import { todoOrchestrationService, type TodoActor } from "../../src/services/todo-orchestration";
import { USE_CASE_GENERATION_WORKFLOW_KEY } from "../../src/config/default-workflows";
import { queueManager } from "../../src/services/queue-manager";

describe("Generic dispatch and backward compat", () => {
  let editor: any;
  let actor: TodoActor;

  beforeEach(async () => {
    editor = await createAuthenticatedUser("editor");
    actor = {
      userId: editor.id,
      role: editor.role,
      workspaceId: editor.workspaceId!,
    };
  });

  afterEach(async () => {
    if (editor?.workspaceId) {
      await db.delete(executionEvents).where(eq(executionEvents.workspaceId, editor.workspaceId));
      await db.delete(workflowTaskResults).where(eq(workflowTaskResults.workspaceId, editor.workspaceId));
      await db.delete(workflowRunState).where(eq(workflowRunState.workspaceId, editor.workspaceId));
      await db.delete(executionRuns).where(eq(executionRuns.workspaceId, editor.workspaceId));
      await db.delete(jobQueue).where(eq(jobQueue.workspaceId, editor.workspaceId));
      await db.delete(workspaceTypeWorkflows);
      await db.delete(workflowDefinitionTasks).where(eq(workflowDefinitionTasks.workspaceId, editor.workspaceId));
      await db.delete(workflowDefinitions).where(eq(workflowDefinitions.workspaceId, editor.workspaceId));
      await db.delete(agentDefinitions).where(eq(agentDefinitions.workspaceId, editor.workspaceId));
      await db.delete(workspaceMemberships).where(eq(workspaceMemberships.workspaceId, editor.workspaceId));
    }
    await cleanupAuthData();
    vi.restoreAllMocks();
  });

  describe("seedWorkflowsForType", () => {
    it("seeds ai-ideas workflows and agents on workspace creation", async () => {
      await todoOrchestrationService.seedWorkflowsForType(actor, "ai-ideas");

      // Check workflow definition exists
      const [wfDef] = await db
        .select()
        .from(workflowDefinitions)
        .where(
          and(
            eq(workflowDefinitions.workspaceId, actor.workspaceId),
            eq(workflowDefinitions.key, USE_CASE_GENERATION_WORKFLOW_KEY),
          ),
        )
        .limit(1);
      expect(wfDef).toBeTruthy();
      expect(wfDef.sourceLevel).toBe("code");

      // Check tasks seeded
      const wfTasks = await db
        .select()
        .from(workflowDefinitionTasks)
        .where(
          and(
            eq(workflowDefinitionTasks.workspaceId, actor.workspaceId),
            eq(workflowDefinitionTasks.workflowDefinitionId, wfDef.id),
          ),
        );
      expect(wfTasks.length).toBe(9); // 9 tasks in ai-ideas workflow including org fanout/join runtime tasks

      const transitions = await db
        .select()
        .from(workflowTaskTransitions)
        .where(
          and(
            eq(workflowTaskTransitions.workspaceId, actor.workspaceId),
            eq(workflowTaskTransitions.workflowDefinitionId, wfDef.id),
          ),
        );
      expect(transitions.length).toBeGreaterThan(0);

      // Check agents seeded
      const agents = await db
        .select()
        .from(agentDefinitions)
        .where(eq(agentDefinitions.workspaceId, actor.workspaceId));
      expect(agents.length).toBeGreaterThanOrEqual(6);

      // Check registered in workspace_type_workflows
      const [registration] = await db
        .select()
        .from(workspaceTypeWorkflows)
        .where(
          and(
            eq(workspaceTypeWorkflows.workspaceType, "ai-ideas"),
            eq(workspaceTypeWorkflows.workflowDefinitionId, wfDef.id),
          ),
        )
        .limit(1);
      expect(registration).toBeTruthy();
      expect(registration.isDefault).toBe(true);
    });

    it("seeds opportunity workflows and agents", async () => {
      await todoOrchestrationService.seedWorkflowsForType(actor, "opportunity");

      const [wfDef] = await db
        .select()
        .from(workflowDefinitions)
        .where(
          and(
            eq(workflowDefinitions.workspaceId, actor.workspaceId),
            eq(workflowDefinitions.key, "opportunity_qualification"),
          ),
        )
        .limit(1);
      expect(wfDef).toBeTruthy();

      const wfTasks = await db
        .select()
        .from(workflowDefinitionTasks)
        .where(
          and(
            eq(workflowDefinitionTasks.workspaceId, actor.workspaceId),
            eq(workflowDefinitionTasks.workflowDefinitionId, wfDef.id),
          ),
        );
      expect(wfTasks.length).toBe(5); // opportunity_qualification remains a noop-only workflow

      // Check opportunity-specific agents
      const agents = await db
        .select()
        .from(agentDefinitions)
        .where(eq(agentDefinitions.workspaceId, actor.workspaceId));
      const agentKeys = agents.map((a) => a.key);
      expect(agentKeys).toContain("demand_analyst");
      expect(agentKeys).toContain("solution_architect");
      expect(agentKeys).toContain("bid_writer");
      expect(agentKeys).toContain("gate_reviewer");
    });

    it("seeds code workflows and agents", async () => {
      await todoOrchestrationService.seedWorkflowsForType(actor, "code");

      const [wfDef] = await db
        .select()
        .from(workflowDefinitions)
        .where(
          and(
            eq(workflowDefinitions.workspaceId, actor.workspaceId),
            eq(workflowDefinitions.key, "code_analysis"),
          ),
        )
        .limit(1);
      expect(wfDef).toBeTruthy();

      const wfTasks = await db
        .select()
        .from(workflowDefinitionTasks)
        .where(
          and(
            eq(workflowDefinitionTasks.workspaceId, actor.workspaceId),
            eq(workflowDefinitionTasks.workflowDefinitionId, wfDef.id),
          ),
        );
      expect(wfTasks.length).toBe(4); // 4 tasks in code workflow
    });

    it("does nothing for neutral workspace type", async () => {
      await todoOrchestrationService.seedWorkflowsForType(actor, "neutral");

      const wfDefs = await db
        .select()
        .from(workflowDefinitions)
        .where(eq(workflowDefinitions.workspaceId, actor.workspaceId));
      expect(wfDefs.length).toBe(0);
    });

    it("is idempotent — re-seeding does not duplicate", async () => {
      await todoOrchestrationService.seedWorkflowsForType(actor, "ai-ideas");
      await todoOrchestrationService.seedWorkflowsForType(actor, "ai-ideas");

      const wfDefs = await db
        .select()
        .from(workflowDefinitions)
        .where(
          and(
            eq(workflowDefinitions.workspaceId, actor.workspaceId),
            eq(workflowDefinitions.key, USE_CASE_GENERATION_WORKFLOW_KEY),
          ),
        );
      expect(wfDefs.length).toBe(1);
    });
  });

  describe("startWorkflow (generic dispatch)", () => {
    it("starts a workflow generically by key", async () => {
      // Seed first
      await todoOrchestrationService.seedWorkflowsForType(actor, "ai-ideas");

      const result = await todoOrchestrationService.startWorkflow(
        actor,
        USE_CASE_GENERATION_WORKFLOW_KEY,
        { test: true },
      );

      expect(result.workflowRunId).toBeTruthy();
      expect(result.workflowDefinitionId).toBeTruthy();
      expect(result.taskAssignments).toBeTruthy();
      expect(Object.keys(result.taskAssignments).length).toBeGreaterThan(0);

      // Verify run was created
      const [run] = await db
        .select()
        .from(executionRuns)
        .where(eq(executionRuns.id, result.workflowRunId))
        .limit(1);
      expect(run).toBeTruthy();
      expect(run.status).toBe("in_progress");

      const [runState] = await db
        .select()
        .from(workflowRunState)
        .where(eq(workflowRunState.runId, result.workflowRunId))
        .limit(1);
      expect(runState).toBeTruthy();

      // Verify event was logged
      const [event] = await db
        .select()
        .from(executionEvents)
        .where(eq(executionEvents.runId, result.workflowRunId))
        .limit(1);
      expect(event).toBeTruthy();
      expect(event.eventType).toBe("workflow_started");
    });

    it("throws 404 for non-existent workflow key", async () => {
      await expect(
        todoOrchestrationService.startWorkflow(actor, "nonexistent_workflow"),
      ).rejects.toThrow("Workflow not found");
    });

    it("runs noop-only workflows through the same generic transition scheduler", async () => {
      await todoOrchestrationService.seedWorkflowsForType(actor, "opportunity");

      const result = await todoOrchestrationService.startWorkflow(
        actor,
        "opportunity_qualification",
        {},
      );

      const [run] = await db
        .select()
        .from(executionRuns)
        .where(eq(executionRuns.id, result.workflowRunId))
        .limit(1);
      expect(run?.status).toBe("completed");

      const [runState] = await db
        .select()
        .from(workflowRunState)
        .where(eq(workflowRunState.runId, result.workflowRunId))
        .limit(1);
      expect(runState?.status).toBe("completed");

      const taskResults = await db
        .select({
          taskKey: workflowTaskResults.taskKey,
          status: workflowTaskResults.status,
        })
        .from(workflowTaskResults)
        .where(eq(workflowTaskResults.runId, result.workflowRunId));
      expect(taskResults).toHaveLength(5);
      expect(taskResults.every((row) => row.status === "completed")).toBe(true);
    });

    it("dispatches opportunity_identification through generic matrix/list transitions", async () => {
      await todoOrchestrationService.seedWorkflowsForType(actor, "opportunity");

      const addJobSpy = vi
        .spyOn(queueManager, "addJob")
        .mockResolvedValueOnce("job-opportunity-matrix")
        .mockResolvedValueOnce("job-opportunity-list");

      const result = await todoOrchestrationService.startWorkflow(actor, "opportunity_identification", {
        folderId: "folder-opportunity",
        input: "Qualify digital twin opportunities",
        matrixMode: "generate",
        matrixSource: "prompt",
        model: "gpt-4.1-nano",
        initiativeCount: 5,
        locale: "fr",
        autoCreateOrganizations: false,
      });

      expect(addJobSpy).toHaveBeenNthCalledWith(
        1,
        "matrix_generate",
        expect.objectContaining({
          folderId: "folder-opportunity",
          matrixSource: "prompt",
          workflow: expect.objectContaining({
            workflowRunId: result.workflowRunId,
            taskKey: "matrix_prepare",
          }),
        }),
        expect.objectContaining({ workspaceId: actor.workspaceId, maxRetries: 1 }),
      );
      expect(addJobSpy).toHaveBeenNthCalledWith(
        2,
        "initiative_list",
        expect.objectContaining({
          folderId: "folder-opportunity",
          matrixMode: "generate",
          workflow: expect.objectContaining({
            workflowRunId: result.workflowRunId,
            taskKey: "opportunity_list",
          }),
        }),
        expect.objectContaining({ workspaceId: actor.workspaceId, maxRetries: 1 }),
      );
    });

    it("dispatches create_organizations first for opportunity_identification auto-create flows", async () => {
      await todoOrchestrationService.seedWorkflowsForType(actor, "opportunity");

      const addJobSpy = vi
        .spyOn(queueManager, "addJob")
        .mockResolvedValueOnce("job-opportunity-create-organizations");

      const result = await todoOrchestrationService.startWorkflow(actor, "opportunity_identification", {
        folderId: "folder-opportunity-auto-create",
        input: "Find organizations and opportunities in aerospace MRO",
        matrixMode: "generate",
        matrixSource: "prompt",
        model: "gpt-4.1-nano",
        initiativeCount: 5,
        locale: "fr",
        autoCreateOrganizations: true,
      });

      expect(addJobSpy).toHaveBeenCalledWith(
        "organization_batch_create",
        expect.objectContaining({
          folderId: "folder-opportunity-auto-create",
          input: "Find organizations and opportunities in aerospace MRO",
          workflow: expect.objectContaining({
            workflowRunId: result.workflowRunId,
            taskKey: "create_organizations",
          }),
        }),
        expect.objectContaining({ workspaceId: actor.workspaceId, maxRetries: 1 }),
      );
    });
  });

  describe("backward compat — startInitiativeGenerationWorkflow", () => {
    it("still works with existing ai-ideas workflow via legacy method", async () => {
      const result = await todoOrchestrationService.startInitiativeGenerationWorkflow(actor, {
        folderId: "test-folder-id",
        matrixMode: "default",
        input: "test input",
        model: "gpt-4",
        locale: "en",
      });

      expect(result.workflowRunId).toBeTruthy();
      expect(result.workflowDefinitionId).toBeTruthy();
      // BR-04: agentMap maps task keys to agent definition IDs (replaces taskAssignments)
      expect(result.agentMap).toBeTruthy();
      expect(result.agentMap["generation_context_prepare"]).toBeTruthy();
      expect(result.agentMap["generation_usecase_list"]).toBeTruthy();
    });
  });
});
