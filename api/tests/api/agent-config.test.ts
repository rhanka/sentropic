import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { app } from "../../src/app";
import { db } from "../../src/db/client";
import { agentDefinitions, workspaceMemberships } from "../../src/db/schema";
import { authenticatedRequest, cleanupAuthData, createAuthenticatedUser } from "../utils/auth-helper";

describe("Agent config API", () => {
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
      await db.delete(agentDefinitions).where(eq(agentDefinitions.workspaceId, editor.workspaceId));
      await db.delete(workspaceMemberships).where(eq(workspaceMemberships.workspaceId, editor.workspaceId));
    }
    await cleanupAuthData();
  });

  it("supports get/put/fork/reset lifecycle", async () => {
    const putRes = await authenticatedRequest(app, "PUT", "/api/v1/agent-config", editor.sessionToken, {
      items: [
        {
          key: "planner",
          name: "Planner",
          description: "Primary planning agent",
          config: { model: "gpt-4.1-nano" },
          sourceLevel: "admin",
        },
      ],
    });

    expect(putRes.status).toBe(200);
    const putBody = await putRes.json();
    expect(putBody.items).toHaveLength(1);
    const root = putBody.items[0];

    const listRes = await authenticatedRequest(app, "GET", "/api/v1/agent-config", editor.sessionToken);
    expect(listRes.status).toBe(200);
    const listBody = await listRes.json();
    expect(listBody.items.some((item: any) => item.key === "planner")).toBe(true);

    const forkRes = await authenticatedRequest(
      app,
      "POST",
      `/api/v1/agent-config/${root.id}/fork`,
      editor.sessionToken,
      {
        key: "planner-user",
        name: "Planner User",
      },
    );
    expect(forkRes.status).toBe(201);
    const forkBody = await forkRes.json();
    expect(forkBody.item.parentId).toBe(root.id);

    // Reset: delete the fork, return parent
    const resetRes = await authenticatedRequest(
      app,
      "POST",
      `/api/v1/agent-config/${forkBody.item.id}/reset`,
      editor.sessionToken,
      {},
    );
    expect(resetRes.status).toBe(200);
    const resetBody = await resetRes.json();
    expect(resetBody.item.id).toBe(root.id);
  });

  it("supports copy/reset lifecycle (new canonical endpoints)", async () => {
    // Create a root agent config
    const putRes = await authenticatedRequest(app, "PUT", "/api/v1/agent-config", editor.sessionToken, {
      items: [
        {
          key: "analyst",
          name: "Analyst",
          description: "Analysis agent",
          config: { model: "gpt-4.1-nano" },
          sourceLevel: "admin",
        },
      ],
    });
    expect(putRes.status).toBe(200);
    const root = (await putRes.json()).items[0];

    // Copy via POST /:id/copy
    const copyRes = await authenticatedRequest(
      app,
      "POST",
      `/api/v1/agent-config/${root.id}/copy`,
      editor.sessionToken,
      { key: "analyst-copy", name: "Analyst Copy" },
    );
    expect(copyRes.status).toBe(201);
    const copyBody = await copyRes.json();
    expect(copyBody.item.parentId).toBe(root.id);
    expect(copyBody.item.key).toBe("analyst-copy");

    // Reset via POST /:id/reset — deletes copy, returns parent
    const resetRes = await authenticatedRequest(
      app,
      "POST",
      `/api/v1/agent-config/${copyBody.item.id}/reset`,
      editor.sessionToken,
      {},
    );
    expect(resetRes.status).toBe(200);
    const resetBody = await resetRes.json();
    expect(resetBody.item.id).toBe(root.id);
  });

  it("rejects reset on agent config without parent", async () => {
    const putRes = await authenticatedRequest(app, "PUT", "/api/v1/agent-config", editor.sessionToken, {
      items: [
        {
          key: "orphan",
          name: "Orphan",
          config: {},
          sourceLevel: "admin",
        },
      ],
    });
    expect(putRes.status).toBe(200);
    const root = (await putRes.json()).items[0];

    const resetRes = await authenticatedRequest(
      app,
      "POST",
      `/api/v1/agent-config/${root.id}/reset`,
      editor.sessionToken,
      {},
    );
    expect(resetRes.status).toBe(400);
  });

  it("rejects delete on system/forked agent config (403)", async () => {
    const putRes = await authenticatedRequest(app, "PUT", "/api/v1/agent-config", editor.sessionToken, {
      items: [
        {
          key: "system-agent",
          name: "System Agent",
          config: {},
          sourceLevel: "admin",
        },
      ],
    });
    expect(putRes.status).toBe(200);
    const root = (await putRes.json()).items[0];

    // Fork it so it has a parent
    const copyRes = await authenticatedRequest(
      app,
      "POST",
      `/api/v1/agent-config/${root.id}/copy`,
      editor.sessionToken,
      { key: "system-agent-copy", name: "System Agent Copy" },
    );
    expect(copyRes.status).toBe(201);
    const copy = (await copyRes.json()).item;

    // Delete the copy (has parentId) — should be 403
    const deleteRes = await authenticatedRequest(
      app,
      "DELETE",
      `/api/v1/agent-config/${copy.id}`,
      editor.sessionToken,
    );
    expect(deleteRes.status).toBe(403);
  });

  it("allows delete on user-created agent config with no parent", async () => {
    const putRes = await authenticatedRequest(app, "PUT", "/api/v1/agent-config", editor.sessionToken, {
      items: [
        {
          key: "user-custom",
          name: "User Custom",
          config: {},
          sourceLevel: "user",
        },
      ],
    });
    expect(putRes.status).toBe(200);
    const created = (await putRes.json()).items[0];

    const deleteRes = await authenticatedRequest(
      app,
      "DELETE",
      `/api/v1/agent-config/${created.id}`,
      editor.sessionToken,
    );
    expect(deleteRes.status).toBe(204);
  });

  it("returns 410 Gone for deprecated detach endpoint", async () => {
    const detachRes = await authenticatedRequest(
      app,
      "POST",
      "/api/v1/agent-config/any-id/detach",
      editor.sessionToken,
      {},
    );
    expect(detachRes.status).toBe(410);
  });

  it("rejects put for viewer role", async () => {
    const response = await authenticatedRequest(
      app,
      "PUT",
      `/api/v1/agent-config?workspace_id=${editor.workspaceId}`,
      viewer.sessionToken,
      {
        items: [{ key: "viewer", name: "Viewer" }],
      },
    );

    expect(response.status).toBe(403);
  });
});
