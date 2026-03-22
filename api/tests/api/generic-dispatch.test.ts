import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../../src/db/client";
import {
  agentDefinitions,
  executionEvents,
  executionRuns,
  workflowDefinitionTasks,
  workflowDefinitions,
  workspaceMemberships,
  workspaceTypeWorkflows,
} from "../../src/db/schema";
import { createAuthenticatedUser, cleanupAuthData } from "../utils/auth-helper";
import { todoOrchestrationService, type TodoActor } from "../../src/services/todo-orchestration";
import { USE_CASE_GENERATION_WORKFLOW_KEY } from "../../src/config/default-workflows";

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
      await db.delete(executionRuns).where(eq(executionRuns.workspaceId, editor.workspaceId));
      await db.delete(workspaceTypeWorkflows);
      await db.delete(workflowDefinitionTasks).where(eq(workflowDefinitionTasks.workspaceId, editor.workspaceId));
      await db.delete(workflowDefinitions).where(eq(workflowDefinitions.workspaceId, editor.workspaceId));
      await db.delete(agentDefinitions).where(eq(agentDefinitions.workspaceId, editor.workspaceId));
      await db.delete(workspaceMemberships).where(eq(workspaceMemberships.workspaceId, editor.workspaceId));
    }
    await cleanupAuthData();
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
      expect(wfTasks.length).toBe(7); // 7 tasks in ai-ideas workflow (incl. generation_create_organizations)

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
      expect(wfTasks.length).toBe(5); // 5 tasks in opportunity workflow

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
