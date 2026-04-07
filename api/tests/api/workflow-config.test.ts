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

  it("supports workflow get/put/fork/reset with ordered tasks", async () => {
    const putRes = await authenticatedRequest(app, "PUT", "/api/v1/workflow-config", editor.sessionToken, {
      items: [
        {
          key: "initiative-generation",
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
        key: "initiative-generation-user",
        name: "Usecase generation user",
      },
    );
    expect(forkRes.status).toBe(201);
    const forkBody = await forkRes.json();
    expect(forkBody.item.parentId).toBe(workflow.id);

    // Reset: delete the fork, return parent
    const resetRes = await authenticatedRequest(
      app,
      "POST",
      `/api/v1/workflow-config/${forkBody.item.id}/reset`,
      editor.sessionToken,
      {},
    );
    expect(resetRes.status).toBe(200);
    const resetBody = await resetRes.json();
    expect(resetBody.item.id).toBe(workflow.id);
  });

  it("supports copy/reset lifecycle (new canonical endpoints)", async () => {
    // Create a root workflow config
    const putRes = await authenticatedRequest(app, "PUT", "/api/v1/workflow-config", editor.sessionToken, {
      items: [
        {
          key: "review-workflow",
          name: "Review Workflow",
          description: "Review pipeline",
          config: { variant: "default" },
          tasks: [
            { taskKey: "gather", title: "Gather data", orderIndex: 1 },
          ],
        },
      ],
    });
    expect(putRes.status).toBe(200);
    const root = (await putRes.json()).items[0];

    // Copy via POST /:id/copy
    const copyRes = await authenticatedRequest(
      app,
      "POST",
      `/api/v1/workflow-config/${root.id}/copy`,
      editor.sessionToken,
      { key: "review-workflow-copy", name: "Review Copy" },
    );
    expect(copyRes.status).toBe(201);
    const copyBody = await copyRes.json();
    expect(copyBody.item.parentId).toBe(root.id);
    expect(copyBody.item.key).toBe("review-workflow-copy");

    // Reset via POST /:id/reset — deletes copy, returns parent
    const resetRes = await authenticatedRequest(
      app,
      "POST",
      `/api/v1/workflow-config/${copyBody.item.id}/reset`,
      editor.sessionToken,
      {},
    );
    expect(resetRes.status).toBe(200);
    const resetBody = await resetRes.json();
    expect(resetBody.item.id).toBe(root.id);
  });

  it("rejects reset on workflow config without parent", async () => {
    const putRes = await authenticatedRequest(app, "PUT", "/api/v1/workflow-config", editor.sessionToken, {
      items: [
        {
          key: "orphan-wf",
          name: "Orphan Workflow",
          config: {},
          tasks: [],
        },
      ],
    });
    expect(putRes.status).toBe(200);
    const root = (await putRes.json()).items[0];

    const resetRes = await authenticatedRequest(
      app,
      "POST",
      `/api/v1/workflow-config/${root.id}/reset`,
      editor.sessionToken,
      {},
    );
    expect(resetRes.status).toBe(400);
  });

  it("rejects delete on forked workflow config (403)", async () => {
    const putRes = await authenticatedRequest(app, "PUT", "/api/v1/workflow-config", editor.sessionToken, {
      items: [
        {
          key: "sys-workflow",
          name: "System Workflow",
          config: {},
          tasks: [],
        },
      ],
    });
    expect(putRes.status).toBe(200);
    const root = (await putRes.json()).items[0];

    // Fork so it has a parent
    const copyRes = await authenticatedRequest(
      app,
      "POST",
      `/api/v1/workflow-config/${root.id}/copy`,
      editor.sessionToken,
      { key: "sys-workflow-copy", name: "System Workflow Copy" },
    );
    expect(copyRes.status).toBe(201);
    const copy = (await copyRes.json()).item;

    // Delete the copy (has parentId) — should be 403
    const deleteRes = await authenticatedRequest(
      app,
      "DELETE",
      `/api/v1/workflow-config/${copy.id}`,
      editor.sessionToken,
    );
    expect(deleteRes.status).toBe(403);
  });

  it("allows delete on user-created workflow config with no parent", async () => {
    const putRes = await authenticatedRequest(app, "PUT", "/api/v1/workflow-config", editor.sessionToken, {
      items: [
        {
          key: "user-wf",
          name: "User Workflow",
          config: {},
          sourceLevel: "user",
          tasks: [],
        },
      ],
    });
    expect(putRes.status).toBe(200);
    const created = (await putRes.json()).items[0];

    const deleteRes = await authenticatedRequest(
      app,
      "DELETE",
      `/api/v1/workflow-config/${created.id}`,
      editor.sessionToken,
    );
    expect(deleteRes.status).toBe(204);
  });

  it("returns 410 Gone for deprecated detach endpoint", async () => {
    const detachRes = await authenticatedRequest(
      app,
      "POST",
      "/api/v1/workflow-config/any-id/detach",
      editor.sessionToken,
      {},
    );
    expect(detachRes.status).toBe(410);
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
