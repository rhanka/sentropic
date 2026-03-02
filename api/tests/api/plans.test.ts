import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { app } from "../../src/app";
import { db } from "../../src/db/client";
import { executionEvents, executionRuns, plans, tasks, todos, workspaceMemberships } from "../../src/db/schema";
import { authenticatedRequest, cleanupAuthData, createAuthenticatedUser } from "../utils/auth-helper";

describe("Plans API", () => {
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
      await db.delete(executionEvents).where(eq(executionEvents.workspaceId, editor.workspaceId));
      await db.delete(executionRuns).where(eq(executionRuns.workspaceId, editor.workspaceId));
      await db.delete(tasks).where(eq(tasks.workspaceId, editor.workspaceId));
      await db.delete(todos).where(eq(todos.workspaceId, editor.workspaceId));
      await db.delete(plans).where(eq(plans.workspaceId, editor.workspaceId));
      await db.delete(workspaceMemberships).where(eq(workspaceMemberships.workspaceId, editor.workspaceId));
    }
    await cleanupAuthData();
  });

  it("creates and updates plans and creates todos under plan", async () => {
    const createPlanRes = await authenticatedRequest(app, "POST", "/api/v1/plans", editor.sessionToken, {
      title: "Delivery plan",
      description: "Lot orchestration",
    });

    expect(createPlanRes.status).toBe(201);
    const createdPlanBody = await createPlanRes.json();
    const planId = createdPlanBody.plan.id as string;
    expect(planId).toBeTruthy();
    expect(createdPlanBody.plan.derivedStatus).toBe("todo");

    const patchPlanRes = await authenticatedRequest(app, "PATCH", `/api/v1/plans/${planId}`, editor.sessionToken, {
      description: "Updated description",
    });

    expect(patchPlanRes.status).toBe(200);
    const patchedPlanBody = await patchPlanRes.json();
    expect(patchedPlanBody.plan.description).toBe("Updated description");

    const createTodoRes = await authenticatedRequest(
      app,
      "POST",
      `/api/v1/plans/${planId}/todos`,
      editor.sessionToken,
      {
        title: "Lot 2",
        description: "Implement endpoints",
      },
    );

    expect(createTodoRes.status).toBe(201);
    const createTodoBody = await createTodoRes.json();
    expect(createTodoBody.todo.planId).toBe(planId);
    expect(createTodoBody.todo.derivedStatus).toBe("todo");
  });

  it("rejects plan creation for viewer role", async () => {
    const response = await authenticatedRequest(
      app,
      "POST",
      `/api/v1/plans?workspace_id=${editor.workspaceId}`,
      viewer.sessionToken,
      {
        title: "Viewer cannot create",
      },
    );

    expect(response.status).toBe(403);
  });
});
