import { Hono, type Context } from "hono";
import { requireWorkspaceEditorRole } from "../../middleware/workspace-rbac";
import {
  TodoOrchestrationError,
  todoOrchestrationService,
  type TodoActor,
} from "../../services/todo-orchestration";

export const runsRouter = new Hono();

const actorFromContext = (c: Context): TodoActor => {
  const user = c.get("user") as { userId: string; role: string; workspaceId: string };
  return {
    userId: user.userId,
    role: user.role,
    workspaceId: user.workspaceId,
  };
};

const toHttpStatus = (status: number): 400 | 401 | 403 | 404 | 409 | 500 => {
  if (status === 400 || status === 401 || status === 403 || status === 404 || status === 409) {
    return status;
  }
  return 500;
};

const handleTodoError = (c: Context, error: unknown) => {
  if (error instanceof TodoOrchestrationError) {
    return c.json({ error: error.message }, toHttpStatus(error.status));
  }
  console.error("runs route error", error);
  return c.json({ error: "Internal server error" }, 500);
};

runsRouter.post("/:runId/pause", requireWorkspaceEditorRole(), async (c) => {
  try {
    const actor = actorFromContext(c);
    const result = await todoOrchestrationService.pauseRun(actor, c.req.param("runId")!);
    return c.json(result);
  } catch (error) {
    return handleTodoError(c, error);
  }
});

runsRouter.post("/:runId/resume", requireWorkspaceEditorRole(), async (c) => {
  try {
    const actor = actorFromContext(c);
    const result = await todoOrchestrationService.resumeRun(actor, c.req.param("runId")!);
    return c.json(result);
  } catch (error) {
    return handleTodoError(c, error);
  }
});
