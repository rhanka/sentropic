import { Hono, type Context } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { requireWorkspaceAccessRole, requireWorkspaceEditorRole } from "../../middleware/workspace-rbac";
import {
  TodoOrchestrationError,
  todoOrchestrationService,
  type TodoActor,
} from "../../services/todo-orchestration";

export const workflowConfigRouter = new Hono();

const metadataSchema = z.record(z.string(), z.unknown());

const workflowTaskSchema = z.object({
  taskKey: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional().nullable(),
  orderIndex: z.number().int().optional(),
  agentDefinitionId: z.string().optional().nullable(),
  inputSchema: metadataSchema.optional(),
  outputSchema: metadataSchema.optional(),
  sectionKey: z.string().optional().nullable(),
  metadata: metadataSchema.optional(),
});

const putWorkflowConfigsSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.string().optional(),
        key: z.string().min(1),
        name: z.string().min(1),
        description: z.string().optional().nullable(),
        config: metadataSchema.optional(),
        sourceLevel: z.enum(["code", "admin", "user"]).optional(),
        tasks: z.array(workflowTaskSchema).optional(),
      }),
    )
    .min(1),
});

const forkWorkflowSchema = z.object({
  key: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
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
  console.error("workflow-config route error", error);
  return c.json({ error: "Internal server error" }, 500);
};

workflowConfigRouter.get("/", requireWorkspaceAccessRole(), async (c) => {
  try {
    const actor = actorFromContext(c);
    const items = await todoOrchestrationService.listWorkflowConfigs(actor);
    return c.json({ items });
  } catch (error) {
    return handleTodoError(c, error);
  }
});

workflowConfigRouter.put(
  "/",
  requireWorkspaceEditorRole(),
  zValidator("json", putWorkflowConfigsSchema),
  async (c) => {
    try {
      const actor = actorFromContext(c);
      const body = c.req.valid("json");
      const items = await todoOrchestrationService.putWorkflowConfigs(actor, body.items);
      return c.json({ items });
    } catch (error) {
      return handleTodoError(c, error);
    }
  },
);

workflowConfigRouter.post(
  "/:id/fork",
  requireWorkspaceEditorRole(),
  zValidator("json", forkWorkflowSchema),
  async (c) => {
    try {
      const actor = actorFromContext(c);
      const body = c.req.valid("json");
      const item = await todoOrchestrationService.forkWorkflowConfig(actor, c.req.param("id"), body);
      return c.json({ item }, 201);
    } catch (error) {
      return handleTodoError(c, error);
    }
  },
);

workflowConfigRouter.post("/:id/detach", requireWorkspaceEditorRole(), async (c) => {
  try {
    const actor = actorFromContext(c);
    const item = await todoOrchestrationService.detachWorkflowConfig(actor, c.req.param("id"));
    return c.json({ item });
  } catch (error) {
    return handleTodoError(c, error);
  }
});
