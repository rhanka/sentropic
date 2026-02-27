import { Hono, type Context } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { requireWorkspaceEditorRole } from "../../middleware/workspace-rbac";
import {
  TodoOrchestrationError,
  todoOrchestrationService,
  type TodoActor,
} from "../../services/todo-orchestration";

export const plansRouter = new Hono();

const metadataSchema = z.record(z.string(), z.unknown());

const createPlanSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional().nullable(),
  ownerUserId: z.string().optional().nullable(),
  metadata: metadataSchema.optional(),
});

const patchPlanSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional().nullable(),
  ownerUserId: z.string().optional().nullable(),
  metadata: metadataSchema.optional(),
});

const createTodoSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional().nullable(),
  position: z.number().int().optional(),
  ownerUserId: z.string().optional().nullable(),
  parentTodoId: z.string().optional().nullable(),
  metadata: metadataSchema.optional(),
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
  console.error("plans route error", error);
  return c.json({ error: "Internal server error" }, 500);
};

plansRouter.post("/", requireWorkspaceEditorRole(), zValidator("json", createPlanSchema), async (c) => {
  try {
    const actor = actorFromContext(c);
    const body = c.req.valid("json");
    const plan = await todoOrchestrationService.createPlan(actor, body);
    return c.json({ plan }, 201);
  } catch (error) {
    return handleTodoError(c, error);
  }
});

plansRouter.patch("/:planId", requireWorkspaceEditorRole(), zValidator("json", patchPlanSchema), async (c) => {
  try {
    const actor = actorFromContext(c);
    const body = c.req.valid("json");
    const plan = await todoOrchestrationService.patchPlan(actor, c.req.param("planId"), body);
    return c.json({ plan });
  } catch (error) {
    return handleTodoError(c, error);
  }
});

plansRouter.post(
  "/:planId/todos",
  requireWorkspaceEditorRole(),
  zValidator("json", createTodoSchema),
  async (c) => {
    try {
      const actor = actorFromContext(c);
      const body = c.req.valid("json");
      const todo = await todoOrchestrationService.createTodo(actor, {
        ...body,
        planId: c.req.param("planId"),
      });
      return c.json({ todo }, 201);
    } catch (error) {
      return handleTodoError(c, error);
    }
  },
);
