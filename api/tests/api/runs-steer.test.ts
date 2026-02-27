import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { app } from "../../src/app";
import { db } from "../../src/db/client";
import { executionEvents, executionRuns, plans, tasks, todos, workspaceMemberships } from "../../src/db/schema";
import { authenticatedRequest, cleanupAuthData, createAuthenticatedUser } from "../utils/auth-helper";

describe("Runs API", () => {
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

  async function createRunFixture() {
    const planRes = await authenticatedRequest(app, "POST", "/api/v1/plans", editor.sessionToken, {
      title: "Run plan",
    });
    expect(planRes.status).toBe(201);
    const plan = (await planRes.json()).plan;

    const todoRes = await authenticatedRequest(
      app,
      "POST",
      `/api/v1/plans/${plan.id}/todos`,
      editor.sessionToken,
      { title: "Run todo" },
    );
    expect(todoRes.status).toBe(201);
    const todo = (await todoRes.json()).todo;

    const taskRes = await authenticatedRequest(
      app,
      "POST",
      `/api/v1/todos/${todo.id}/tasks`,
      editor.sessionToken,
      { title: "Run task", status: "planned" },
    );
    expect(taskRes.status).toBe(201);
    const task = (await taskRes.json()).task;

    const startRes = await authenticatedRequest(app, "POST", `/api/v1/tasks/${task.id}/start`, editor.sessionToken, {});
    expect(startRes.status).toBe(200);
    const start = await startRes.json();

    return { runId: start.runId as string };
  }

  it("persists steer/pause/resume events", async () => {
    const { runId } = await createRunFixture();

    const steerRes = await authenticatedRequest(app, "POST", `/api/v1/runs/${runId}/steer`, editor.sessionToken, {
      message: "Shift focus to API contracts",
      metadata: { lot: 2 },
    });
    expect(steerRes.status).toBe(200);

    const pauseRes = await authenticatedRequest(app, "POST", `/api/v1/runs/${runId}/pause`, editor.sessionToken, {});
    expect(pauseRes.status).toBe(200);

    const resumeRes = await authenticatedRequest(app, "POST", `/api/v1/runs/${runId}/resume`, editor.sessionToken, {});
    expect(resumeRes.status).toBe(200);

    const [run] = await db
      .select()
      .from(executionRuns)
      .where(and(eq(executionRuns.workspaceId, editor.workspaceId), eq(executionRuns.id, runId)))
      .limit(1);
    expect(run?.status).toBe("in_progress");

    const events = await db
      .select({ eventType: executionEvents.eventType })
      .from(executionEvents)
      .where(eq(executionEvents.runId, runId));

    const eventTypes = events.map((event) => event.eventType);
    expect(eventTypes).toContain("steer");
    expect(eventTypes).toContain("run_paused");
    expect(eventTypes).toContain("run_resumed");
  });

  it("rejects run control for viewer role", async () => {
    const { runId } = await createRunFixture();

    const response = await authenticatedRequest(
      app,
      "POST",
      `/api/v1/runs/${runId}/steer?workspace_id=${editor.workspaceId}`,
      viewer.sessionToken,
      {
        message: "Viewer cannot steer",
      },
    );

    expect(response.status).toBe(403);
  });
});
