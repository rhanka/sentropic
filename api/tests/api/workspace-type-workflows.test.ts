import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { app } from "../../src/app";
import { db } from "../../src/db/client";
import {
  agentDefinitions,
  workflowDefinitionTasks,
  workflowDefinitions,
  workspaceMemberships,
  workspaceTypeWorkflows,
} from "../../src/db/schema";
import { authenticatedRequest, cleanupAuthData, createAuthenticatedUser } from "../utils/auth-helper";
import { createId } from "../../src/utils/id";

describe("Workspace type workflow registry API", () => {
  let admin: any;
  let editor: any;

  beforeEach(async () => {
    admin = await createAuthenticatedUser("admin_org");
    editor = await createAuthenticatedUser("editor");
  });

  afterEach(async () => {
    // Clean up workspace_type_workflows
    await db.delete(workspaceTypeWorkflows);
    // Clean up workflow data
    for (const user of [admin, editor]) {
      if (user?.workspaceId) {
        await db.delete(workflowDefinitionTasks).where(eq(workflowDefinitionTasks.workspaceId, user.workspaceId));
        await db.delete(workflowDefinitions).where(eq(workflowDefinitions.workspaceId, user.workspaceId));
        await db.delete(agentDefinitions).where(eq(agentDefinitions.workspaceId, user.workspaceId));
        await db.delete(workspaceMemberships).where(eq(workspaceMemberships.workspaceId, user.workspaceId));
      }
    }
    await cleanupAuthData();
  });

  it("lists registered workflows for a workspace type (empty initially)", async () => {
    const res = await authenticatedRequest(app, "GET", "/api/v1/workspace-types/ai-ideas/workflows", admin.sessionToken);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toBeInstanceOf(Array);
  });

  it("registers, lists, and deletes a workflow for a workspace type", async () => {
    // First create a workflow definition in the editor's workspace
    const putRes = await authenticatedRequest(app, "PUT", "/api/v1/workflow-config", editor.sessionToken, {
      items: [
        {
          key: "test-workflow",
          name: "Test Workflow",
          description: "For registry test",
          tasks: [
            { taskKey: "step_1", title: "Step 1", orderIndex: 0 },
          ],
        },
      ],
    });
    expect(putRes.status).toBe(200);
    const putBody = await putRes.json();
    const workflowDefId = putBody.items[0].id;

    // Register it for ai-ideas type (requires admin)
    const registerRes = await authenticatedRequest(
      app,
      "POST",
      "/api/v1/workspace-types/ai-ideas/workflows",
      admin.sessionToken,
      {
        workflowDefinitionId: workflowDefId,
        isDefault: true,
      },
    );
    expect(registerRes.status).toBe(201);
    const registerBody = await registerRes.json();
    expect(registerBody.item.workspaceType).toBe("ai-ideas");
    expect(registerBody.item.isDefault).toBe(true);
    const registrationId = registerBody.item.id;

    // List should now include it
    const listRes = await authenticatedRequest(app, "GET", "/api/v1/workspace-types/ai-ideas/workflows", admin.sessionToken);
    expect(listRes.status).toBe(200);
    const listBody = await listRes.json();
    expect(listBody.items.length).toBeGreaterThanOrEqual(1);
    const found = listBody.items.find((item: any) => item.id === registrationId);
    expect(found).toBeTruthy();
    expect(found.workflowKey).toBe("test-workflow");

    // Delete the registration
    const deleteRes = await authenticatedRequest(
      app,
      "DELETE",
      `/api/v1/workspace-types/ai-ideas/workflows/${registrationId}`,
      admin.sessionToken,
    );
    expect(deleteRes.status).toBe(200);

    // List should be empty again (for this workflow)
    const listRes2 = await authenticatedRequest(app, "GET", "/api/v1/workspace-types/ai-ideas/workflows", admin.sessionToken);
    const listBody2 = await listRes2.json();
    const found2 = listBody2.items.find((item: any) => item.id === registrationId);
    expect(found2).toBeUndefined();
  });

  it("rejects invalid workspace type", async () => {
    const res = await authenticatedRequest(app, "GET", "/api/v1/workspace-types/invalid/workflows", admin.sessionToken);
    expect(res.status).toBe(400);
  });

  it("rejects registration of non-existent workflow definition", async () => {
    const res = await authenticatedRequest(
      app,
      "POST",
      "/api/v1/workspace-types/opportunity/workflows",
      admin.sessionToken,
      { workflowDefinitionId: "nonexistent-id" },
    );
    expect(res.status).toBe(404);
  });

  it("unsets previous default when registering a new default", async () => {
    // Create two workflow definitions
    const putRes = await authenticatedRequest(app, "PUT", "/api/v1/workflow-config", editor.sessionToken, {
      items: [
        { key: "wf-a", name: "Workflow A", tasks: [] },
        { key: "wf-b", name: "Workflow B", tasks: [] },
      ],
    });
    const putBody = await putRes.json();
    const wfAId = putBody.items.find((i: any) => i.key === "wf-a").id;
    const wfBId = putBody.items.find((i: any) => i.key === "wf-b").id;

    // Register A as default
    await authenticatedRequest(app, "POST", "/api/v1/workspace-types/code/workflows", admin.sessionToken, {
      workflowDefinitionId: wfAId,
      isDefault: true,
    });

    // Register B as default — A should lose default status
    await authenticatedRequest(app, "POST", "/api/v1/workspace-types/code/workflows", admin.sessionToken, {
      workflowDefinitionId: wfBId,
      isDefault: true,
    });

    const listRes = await authenticatedRequest(app, "GET", "/api/v1/workspace-types/code/workflows", admin.sessionToken);
    const listBody = await listRes.json();
    const aRow = listBody.items.find((i: any) => i.workflowDefinitionId === wfAId);
    const bRow = listBody.items.find((i: any) => i.workflowDefinitionId === wfBId);
    expect(aRow?.isDefault).toBe(false);
    expect(bRow?.isDefault).toBe(true);
  });
});
