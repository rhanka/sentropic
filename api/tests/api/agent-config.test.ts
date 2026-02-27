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

  it("supports get/put/fork/detach lifecycle", async () => {
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

    const detachRes = await authenticatedRequest(
      app,
      "POST",
      `/api/v1/agent-config/${forkBody.item.id}/detach`,
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
      `/api/v1/agent-config?workspace_id=${editor.workspaceId}`,
      viewer.sessionToken,
      {
        items: [{ key: "viewer", name: "Viewer" }],
      },
    );

    expect(response.status).toBe(403);
  });
});
