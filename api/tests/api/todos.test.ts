import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { app } from "../../src/app";
import { db } from "../../src/db/client";
import { executionEvents, executionRuns, plans, tasks, todos, workspaceMemberships } from "../../src/db/schema";
import { authenticatedRequest, cleanupAuthData, createAuthenticatedUser } from "../utils/auth-helper";

describe("Todos API", () => {
  let editor: any;
  let owner: any;
  let viewer: any;

  beforeEach(async () => {
    editor = await createAuthenticatedUser("editor");
    owner = await createAuthenticatedUser("editor");
    viewer = await createAuthenticatedUser("guest");

    await db
      .insert(workspaceMemberships)
      .values([
        {
          workspaceId: editor.workspaceId,
          userId: owner.id,
          role: "editor",
          createdAt: new Date(),
        },
        {
          workspaceId: editor.workspaceId,
          userId: viewer.id,
          role: "viewer",
          createdAt: new Date(),
        },
      ])
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

  async function createPlanAndTodo() {
    const planRes = await authenticatedRequest(app, "POST", "/api/v1/plans", editor.sessionToken, {
      title: "Execution plan",
    });
    expect(planRes.status).toBe(201);
    const plan = (await planRes.json()).plan;

    const todoRes = await authenticatedRequest(
      app,
      "POST",
      `/api/v1/plans/${plan.id}/todos`,
      editor.sessionToken,
      {
        title: "Main lot",
      },
    );
    expect(todoRes.status).toBe(201);
    const todo = (await todoRes.json()).todo;

    return { plan, todo };
  }

  it("patches and assigns todos with ownership rules", async () => {
    const { todo } = await createPlanAndTodo();

    const patchRes = await authenticatedRequest(app, "PATCH", `/api/v1/todos/${todo.id}`, editor.sessionToken, {
      title: "Main lot updated",
    });
    expect(patchRes.status).toBe(200);
    expect((await patchRes.json()).todo.title).toBe("Main lot updated");

    const assignRes = await authenticatedRequest(
      app,
      "POST",
      `/api/v1/todos/${todo.id}/assign`,
      editor.sessionToken,
      {
        ownerUserId: owner.id,
      },
    );
    expect(assignRes.status).toBe(200);

    const closeAsCreatorRes = await authenticatedRequest(
      app,
      "PATCH",
      `/api/v1/todos/${todo.id}`,
      editor.sessionToken,
      {
        closed: true,
      },
    );
    expect(closeAsCreatorRes.status).toBe(403);

    const closeAsOwnerRes = await authenticatedRequest(
      app,
      "PATCH",
      `/api/v1/todos/${todo.id}?workspace_id=${editor.workspaceId}`,
      owner.sessionToken,
      {
        closed: true,
      },
    );
    expect(closeAsOwnerRes.status).toBe(200);
    const closeBody = await closeAsOwnerRes.json();
    expect(closeBody.todo.closedAt).toBeTruthy();
  });

  it("creates tasks under a todo and blocks viewer mutations", async () => {
    const { todo } = await createPlanAndTodo();

    const createTaskRes = await authenticatedRequest(
      app,
      "POST",
      `/api/v1/todos/${todo.id}/tasks`,
      editor.sessionToken,
      {
        title: "Implement endpoint",
        status: "planned",
      },
    );

    expect(createTaskRes.status).toBe(201);
    const createTaskBody = await createTaskRes.json();
    expect(createTaskBody.task.status).toBe("planned");

    const viewerAssignRes = await authenticatedRequest(
      app,
      "POST",
      `/api/v1/todos/${todo.id}/assign?workspace_id=${editor.workspaceId}`,
      viewer.sessionToken,
      {
        ownerUserId: viewer.id,
      },
    );

    expect(viewerAssignRes.status).toBe(403);
  });
});
