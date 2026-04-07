import { Hono, type Context } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { and, eq } from "drizzle-orm";
import { requireWorkspaceAccessRole, requireWorkspaceEditorRole } from "../../middleware/workspace-rbac";
import { requireAdmin } from "../../middleware/rbac";
import {
  TodoOrchestrationError,
  todoOrchestrationService,
  type TodoActor,
} from "../../services/todo-orchestration";
import { db } from "../../db/client";
import { workspaceTypeWorkflows, workflowDefinitions } from "../../db/schema";
import { createId } from "../../utils/id";

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

// Copy (new canonical endpoint)
workflowConfigRouter.post(
  "/:id/copy",
  requireWorkspaceEditorRole(),
  zValidator("json", forkWorkflowSchema),
  async (c) => {
    try {
      const actor = actorFromContext(c);
      const body = c.req.valid("json");
      const item = await todoOrchestrationService.forkWorkflowConfig(actor, c.req.param("id")!, body);
      return c.json({ item }, 201);
    } catch (error) {
      return handleTodoError(c, error);
    }
  },
);

// Fork (deprecated alias for copy)
workflowConfigRouter.post(
  "/:id/fork",
  requireWorkspaceEditorRole(),
  zValidator("json", forkWorkflowSchema),
  async (c) => {
    try {
      const actor = actorFromContext(c);
      const body = c.req.valid("json");
      const item = await todoOrchestrationService.forkWorkflowConfig(actor, c.req.param("id")!, body);
      return c.json({ item }, 201);
    } catch (error) {
      return handleTodoError(c, error);
    }
  },
);

// Reset — delete the copy and return system parent
workflowConfigRouter.post("/:id/reset", requireWorkspaceEditorRole(), async (c) => {
  try {
    const actor = actorFromContext(c);
    const item = await todoOrchestrationService.resetWorkflowConfig(actor, c.req.param("id")!);
    return c.json({ item });
  } catch (error) {
    return handleTodoError(c, error);
  }
});

// Delete — user-created only (sourceLevel='user' + parentId=null)
workflowConfigRouter.delete("/:id", requireWorkspaceEditorRole(), async (c) => {
  try {
    const actor = actorFromContext(c);
    await todoOrchestrationService.deleteWorkflowConfig(actor, c.req.param("id")!);
    return c.body(null, 204);
  } catch (error) {
    return handleTodoError(c, error);
  }
});

// Detach (deprecated — returns 410 Gone)
workflowConfigRouter.post("/:id/detach", requireWorkspaceEditorRole(), async (c) => {
  return c.json({ error: "Detach is no longer supported. Use reset instead." }, 410);
});

// ---------------------------------------------------------------------------
// Workspace type workflow registry endpoints (§11.5)
// ---------------------------------------------------------------------------

const workspaceTypeParam = z.enum(["ai-ideas", "opportunity", "code"]);

const registerWorkspaceTypeWorkflowSchema = z.object({
  workflowDefinitionId: z.string().min(1),
  isDefault: z.boolean().optional(),
  triggerStage: z.string().optional().nullable(),
  config: metadataSchema.optional(),
});

export const workspaceTypeWorkflowsRouter = new Hono();

// GET /api/v1/workspace-types/:type/workflows — list registered workflows for a type
workspaceTypeWorkflowsRouter.get("/:type/workflows", async (c) => {
  const typeRaw = c.req.param("type");
  const parsed = workspaceTypeParam.safeParse(typeRaw);
  if (!parsed.success) {
    return c.json({ error: `Invalid workspace type: ${typeRaw}` }, 400);
  }

  const rows = await db
    .select({
      id: workspaceTypeWorkflows.id,
      workspaceType: workspaceTypeWorkflows.workspaceType,
      workflowDefinitionId: workspaceTypeWorkflows.workflowDefinitionId,
      isDefault: workspaceTypeWorkflows.isDefault,
      triggerStage: workspaceTypeWorkflows.triggerStage,
      config: workspaceTypeWorkflows.config,
      createdAt: workspaceTypeWorkflows.createdAt,
      updatedAt: workspaceTypeWorkflows.updatedAt,
      workflowKey: workflowDefinitions.key,
      workflowName: workflowDefinitions.name,
    })
    .from(workspaceTypeWorkflows)
    .innerJoin(workflowDefinitions, eq(workspaceTypeWorkflows.workflowDefinitionId, workflowDefinitions.id))
    .where(eq(workspaceTypeWorkflows.workspaceType, parsed.data));

  return c.json({ items: rows });
});

// POST /api/v1/workspace-types/:type/workflows — register a workflow for a type (admin only)
workspaceTypeWorkflowsRouter.post(
  "/:type/workflows",
  requireAdmin,
  zValidator("json", registerWorkspaceTypeWorkflowSchema),
  async (c) => {
    const typeRaw = c.req.param("type");
    const parsed = workspaceTypeParam.safeParse(typeRaw);
    if (!parsed.success) {
      return c.json({ error: `Invalid workspace type: ${typeRaw}` }, 400);
    }

    const body = c.req.valid("json");

    // Verify the workflow definition exists
    const [wfDef] = await db
      .select({ id: workflowDefinitions.id })
      .from(workflowDefinitions)
      .where(eq(workflowDefinitions.id, body.workflowDefinitionId))
      .limit(1);

    if (!wfDef) {
      return c.json({ error: "Workflow definition not found" }, 404);
    }

    // If isDefault, unset other defaults for this type
    const now = new Date();
    if (body.isDefault) {
      await db
        .update(workspaceTypeWorkflows)
        .set({ isDefault: false, updatedAt: now })
        .where(
          and(
            eq(workspaceTypeWorkflows.workspaceType, parsed.data),
            eq(workspaceTypeWorkflows.isDefault, true),
          ),
        );
    }

    const id = createId();
    await db.insert(workspaceTypeWorkflows).values({
      id,
      workspaceType: parsed.data,
      workflowDefinitionId: body.workflowDefinitionId,
      isDefault: body.isDefault ?? false,
      triggerStage: body.triggerStage ?? null,
      config: body.config ?? {},
      createdAt: now,
      updatedAt: now,
    });

    const [created] = await db
      .select()
      .from(workspaceTypeWorkflows)
      .where(eq(workspaceTypeWorkflows.id, id))
      .limit(1);

    return c.json({ item: created }, 201);
  },
);

// DELETE /api/v1/workspace-types/:type/workflows/:id — unregister
workspaceTypeWorkflowsRouter.delete("/:type/workflows/:id", requireAdmin, async (c) => {
  const typeRaw = c.req.param("type");
  const parsed = workspaceTypeParam.safeParse(typeRaw);
  if (!parsed.success) {
    return c.json({ error: `Invalid workspace type: ${typeRaw}` }, 400);
  }

  const registrationId = c.req.param("id")!;
  const [existing] = await db
    .select({ id: workspaceTypeWorkflows.id })
    .from(workspaceTypeWorkflows)
    .where(
      and(
        eq(workspaceTypeWorkflows.id, registrationId),
        eq(workspaceTypeWorkflows.workspaceType, parsed.data),
      ),
    )
    .limit(1);

  if (!existing) {
    return c.json({ error: "Registration not found" }, 404);
  }

  await db.delete(workspaceTypeWorkflows).where(eq(workspaceTypeWorkflows.id, registrationId));
  return c.json({ success: true });
});
