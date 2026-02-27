import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { app } from "../../src/app";
import { db } from "../../src/db/client";
import {
  executionEvents,
  executionRuns,
  guardrails,
  plans,
  tasks,
  todos,
  workspaceMemberships,
} from "../../src/db/schema";
import { createId } from "../../src/utils/id";
import { authenticatedRequest, cleanupAuthData, createAuthenticatedUser } from "../utils/auth-helper";

describe("Tasks API", () => {
  let editor: any;
  let assignee: any;

  beforeEach(async () => {
    editor = await createAuthenticatedUser("editor");
    assignee = await createAuthenticatedUser("editor");

    await db
      .insert(workspaceMemberships)
      .values({
        workspaceId: editor.workspaceId,
        userId: assignee.id,
        role: "editor",
        createdAt: new Date(),
      })
      .onConflictDoNothing();
  });

  afterEach(async () => {
    if (editor?.workspaceId) {
      await db.delete(executionEvents).where(eq(executionEvents.workspaceId, editor.workspaceId));
      await db.delete(executionRuns).where(eq(executionRuns.workspaceId, editor.workspaceId));
      await db.delete(guardrails).where(eq(guardrails.workspaceId, editor.workspaceId));
      await db.delete(tasks).where(eq(tasks.workspaceId, editor.workspaceId));
      await db.delete(todos).where(eq(todos.workspaceId, editor.workspaceId));
      await db.delete(plans).where(eq(plans.workspaceId, editor.workspaceId));
      await db.delete(workspaceMemberships).where(eq(workspaceMemberships.workspaceId, editor.workspaceId));
    }
    await cleanupAuthData();
  });

  async function createTaskFixture() {
    const planRes = await authenticatedRequest(app, "POST", "/api/v1/plans", editor.sessionToken, {
      title: "Task execution plan",
    });
    expect(planRes.status).toBe(201);
    const plan = (await planRes.json()).plan;

    const todoRes = await authenticatedRequest(
      app,
      "POST",
      `/api/v1/plans/${plan.id}/todos`,
      editor.sessionToken,
      {
        title: "Lot A",
      },
    );
    expect(todoRes.status).toBe(201);
    const todo = (await todoRes.json()).todo;

    const taskRes = await authenticatedRequest(
      app,
      "POST",
      `/api/v1/todos/${todo.id}/tasks`,
      editor.sessionToken,
      {
        title: "Implement orchestration",
      },
    );
    expect(taskRes.status).toBe(201);
    const task = (await taskRes.json()).task;

    return { plan, todo, task };
  }

  it("assigns, starts, and completes tasks with run events", async () => {
    const { task } = await createTaskFixture();

    const assignRes = await authenticatedRequest(
      app,
      "POST",
      `/api/v1/tasks/${task.id}/assign`,
      editor.sessionToken,
      {
        assigneeUserId: assignee.id,
      },
    );
    expect(assignRes.status).toBe(200);

    const patchAsAssigneeRes = await authenticatedRequest(
      app,
      "PATCH",
      `/api/v1/tasks/${task.id}?workspace_id=${editor.workspaceId}`,
      assignee.sessionToken,
      {
        status: "planned",
      },
    );
    expect(patchAsAssigneeRes.status).toBe(200);

    const startRes = await authenticatedRequest(
      app,
      "POST",
      `/api/v1/tasks/${task.id}/start`,
      editor.sessionToken,
      {},
    );
    expect(startRes.status).toBe(200);
    const startBody = await startRes.json();
    expect(startBody.runId).toBeTruthy();
    expect(startBody.task.status).toBe("in_progress");

    const completeRes = await authenticatedRequest(
      app,
      "POST",
      `/api/v1/tasks/${task.id}/complete`,
      editor.sessionToken,
      {},
    );
    expect(completeRes.status).toBe(200);
    const completeBody = await completeRes.json();
    expect(completeBody.task.status).toBe("done");

    const [run] = await db
      .select()
      .from(executionRuns)
      .where(and(eq(executionRuns.workspaceId, editor.workspaceId), eq(executionRuns.id, startBody.runId)))
      .limit(1);
    expect(run?.status).toBe("completed");

    const events = await db
      .select({ eventType: executionEvents.eventType })
      .from(executionEvents)
      .where(eq(executionEvents.runId, startBody.runId));
    const eventTypes = events.map((event) => event.eventType);
    expect(eventTypes).toContain("task_started");
    expect(eventTypes).toContain("task_completed");
  });

  it("blocks start when active guardrails require blocking", async () => {
    const { task } = await createTaskFixture();

    await db.insert(guardrails).values({
      id: createId(),
      workspaceId: editor.workspaceId,
      entityType: "task",
      entityId: task.id,
      category: "safety",
      title: "No auto-start",
      instruction: "Cannot start until safety check is done",
      config: { violated: true },
      isActive: true,
      createdByUserId: editor.id,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const startRes = await authenticatedRequest(
      app,
      "POST",
      `/api/v1/tasks/${task.id}/start`,
      editor.sessionToken,
      {},
    );

    expect(startRes.status).toBe(409);
    const body = await startRes.json();
    expect(body.error).toContain("Guardrail");

    const [run] = await db
      .select()
      .from(executionRuns)
      .where(and(eq(executionRuns.workspaceId, editor.workspaceId), eq(executionRuns.taskId, task.id)))
      .orderBy(executionRuns.createdAt)
      .limit(1);

    expect(run?.status).toBe("blocked");

    const events = await db
      .select({ eventType: executionEvents.eventType })
      .from(executionEvents)
      .where(eq(executionEvents.runId, run!.id));

    expect(events.map((event) => event.eventType)).toContain("guardrail_blocked");
  });
});
