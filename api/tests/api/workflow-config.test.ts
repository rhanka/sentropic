import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { app } from "../../src/app";
import { db } from "../../src/db/client";
import { workflowDefinitionTasks, workflowDefinitions, workspaceMemberships } from "../../src/db/schema";
import { authenticatedRequest, cleanupAuthData, createAuthenticatedUser } from "../utils/auth-helper";

describe("Workflow config API", () => {
  let editor: any;
  let viewer: any;

  beforeEach(async () => {
    editor = await createAuthenticatedUser("editor");
    viewer = await createAuthenticatedUser("guest");
    await db
      .insert(workspaceMemberships)
      .values({
        workspaceId: editor.workspaceId,
        userId: viewer.id,
        role: "viewer",
        createdAt: new Date(),
      })
      .onConflictDoNothing();
  });

  afterEach(async () => {
    if (editor?.workspaceId) {
      await db.delete(workflowDefinitionTasks).where(eq(workflowDefinitionTasks.workspaceId, editor.workspaceId));
      await db.delete(workflowDefinitions).where(eq(workflowDefinitions.workspaceId, editor.workspaceId));
      await db.delete(workspaceMemberships).where(eq(workspaceMemberships.workspaceId, editor.workspaceId));
    }
    await cleanupAuthData();
  });

  it("supports workflow get/put/fork/detach with ordered tasks", async () => {
    const putRes = await authenticatedRequest(app, "PUT", "/api/v1/workflow-config", editor.sessionToken, {
      items: [
        {
          key: "usecase-generation",
          name: "Usecase generation",
          description: "BR-03 workflow",
          config: { variant: "default" },
          tasks: [
            { taskKey: "collect_context", title: "Collect context", orderIndex: 1 },
            { taskKey: "draft_output", title: "Draft output", orderIndex: 2 },
          ],
        },
      ],
    });

    expect(putRes.status).toBe(200);
    const putBody = await putRes.json();
    expect(putBody.items).toHaveLength(1);
    const workflow = putBody.items[0];
    expect(workflow.tasks).toHaveLength(2);

    const listRes = await authenticatedRequest(app, "GET", "/api/v1/workflow-config", editor.sessionToken);
    expect(listRes.status).toBe(200);
    const listBody = await listRes.json();
    const listed = listBody.items.find((item: any) => item.id === workflow.id);
    expect(listed).toBeTruthy();
    expect(listed.tasks.map((task: any) => task.taskKey)).toEqual(["collect_context", "draft_output"]);

    const forkRes = await authenticatedRequest(
      app,
      "POST",
      `/api/v1/workflow-config/${workflow.id}/fork`,
      editor.sessionToken,
      {
        key: "usecase-generation-user",
        name: "Usecase generation user",
      },
    );
    expect(forkRes.status).toBe(201);
    const forkBody = await forkRes.json();
    expect(forkBody.item.parentId).toBe(workflow.id);

    const detachRes = await authenticatedRequest(
      app,
      "POST",
      `/api/v1/workflow-config/${forkBody.item.id}/detach`,
      editor.sessionToken,
      {},
    );
    expect(detachRes.status).toBe(200);
    const detachBody = await detachRes.json();
    expect(detachBody.item.isDetached).toBe(true);
  });

  it("rejects put for viewer role", async () => {
    const response = await authenticatedRequest(
      app,
      "PUT",
      `/api/v1/workflow-config?workspace_id=${editor.workspaceId}`,
      viewer.sessionToken,
      {
        items: [{ key: "viewer", name: "Viewer workflow" }],
      },
    );

    expect(response.status).toBe(403);
  });
});
