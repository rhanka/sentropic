import { Hono, type Context } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { requireWorkspaceEditorRole } from "../../middleware/workspace-rbac";
import {
  TodoOrchestrationError,
  todoOrchestrationService,
  type TodoActor,
} from "../../services/todo-orchestration";

export const tasksRouter = new Hono();

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
const runModeSchema = z.enum(["manual", "sub_agentic", "full_auto"]);

const patchTaskSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional().nullable(),
  position: z.number().int().optional(),
  status: taskStatusSchema.optional(),
  assigneeUserId: z.string().optional().nullable(),
  metadata: metadataSchema.optional(),
});

const assignTaskSchema = z.object({
  assigneeUserId: z.string().min(1),
});

const taskExecutionSchema = z.object({
  mode: runModeSchema.optional(),
  metadata: metadataSchema.optional(),
  violatedGuardrailIds: z.array(z.string()).optional(),
  approvalGrantedGuardrailIds: z.array(z.string()).optional(),
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
  console.error("tasks route error", error);
  return c.json({ error: "Internal server error" }, 500);
};

tasksRouter.patch("/:taskId", requireWorkspaceEditorRole(), zValidator("json", patchTaskSchema), async (c) => {
  try {
    const actor = actorFromContext(c);
    const body = c.req.valid("json");
    const result = await todoOrchestrationService.patchTask(actor, c.req.param("taskId"), body);
    return c.json(result);
  } catch (error) {
    return handleTodoError(c, error);
  }
});

tasksRouter.post(
  "/:taskId/assign",
  requireWorkspaceEditorRole(),
  zValidator("json", assignTaskSchema),
  async (c) => {
    try {
      const actor = actorFromContext(c);
      const body = c.req.valid("json");
      const task = await todoOrchestrationService.assignTask(actor, c.req.param("taskId"), body.assigneeUserId);
      return c.json({ task });
    } catch (error) {
      return handleTodoError(c, error);
    }
  },
);

tasksRouter.post(
  "/:taskId/start",
  requireWorkspaceEditorRole(),
  zValidator("json", taskExecutionSchema),
  async (c) => {
    try {
      const actor = actorFromContext(c);
      const body = c.req.valid("json");
      const result = await todoOrchestrationService.startTask(actor, c.req.param("taskId"), body);
      if (result.blocked) {
        return c.json({ error: "Guardrail blocked task start", ...result }, 409);
      }
      return c.json(result);
    } catch (error) {
      return handleTodoError(c, error);
    }
  },
);

tasksRouter.post(
  "/:taskId/complete",
  requireWorkspaceEditorRole(),
  zValidator("json", taskExecutionSchema),
  async (c) => {
    try {
      const actor = actorFromContext(c);
      const body = c.req.valid("json");
      const result = await todoOrchestrationService.completeTask(actor, c.req.param("taskId"), body);
      if (result.blocked) {
        return c.json({ error: "Guardrail blocked task completion", ...result }, 409);
      }
      return c.json(result);
    } catch (error) {
      return handleTodoError(c, error);
    }
  },
);
