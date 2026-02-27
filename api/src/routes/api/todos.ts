import { Hono, type Context } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { requireWorkspaceEditorRole } from "../../middleware/workspace-rbac";
import {
  TodoOrchestrationError,
  todoOrchestrationService,
  type TodoActor,
} from "../../services/todo-orchestration";

export const todosRouter = new Hono();

const metadataSchema = z.record(z.string(), z.unknown());
const taskStatusSchema = z.enum([
  "todo",
  "planned",
  "in_progress",
  "blocked",
  "done",
  "deferred",
  "cancelled",
]);

const patchTodoSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional().nullable(),
  position: z.number().int().optional(),
  ownerUserId: z.string().optional().nullable(),
  metadata: metadataSchema.optional(),
  closed: z.boolean().optional(),
});

const createTaskSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional().nullable(),
  position: z.number().int().optional(),
  status: taskStatusSchema.optional(),
  assigneeUserId: z.string().optional().nullable(),
  metadata: metadataSchema.optional(),
});

const assignTodoSchema = z.object({
  ownerUserId: z.string().min(1),
});

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
  console.error("todos route error", error);
  return c.json({ error: "Internal server error" }, 500);
};

todosRouter.patch("/:todoId", requireWorkspaceEditorRole(), zValidator("json", patchTodoSchema), async (c) => {
  try {
    const actor = actorFromContext(c);
    const body = c.req.valid("json");
    const todo = await todoOrchestrationService.patchTodo(actor, c.req.param("todoId"), body);
    return c.json({ todo });
  } catch (error) {
    return handleTodoError(c, error);
  }
});

todosRouter.post(
  "/:todoId/tasks",
  requireWorkspaceEditorRole(),
  zValidator("json", createTaskSchema),
  async (c) => {
    try {
      const actor = actorFromContext(c);
      const body = c.req.valid("json");
      const result = await todoOrchestrationService.createTask(actor, c.req.param("todoId"), body);
      return c.json(result, 201);
    } catch (error) {
      return handleTodoError(c, error);
    }
  },
);

todosRouter.post(
  "/:todoId/assign",
  requireWorkspaceEditorRole(),
  zValidator("json", assignTodoSchema),
  async (c) => {
    try {
      const actor = actorFromContext(c);
      const body = c.req.valid("json");
      const todo = await todoOrchestrationService.assignTodo(actor, c.req.param("todoId"), body.ownerUserId);
      return c.json({ todo });
    } catch (error) {
      return handleTodoError(c, error);
    }
  },
);
