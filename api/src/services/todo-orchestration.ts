import { and, asc, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "../db/client";
import {
  agentDefinitions,
  entityLinks,
  executionEvents,
  executionRuns,
  guardrails,
  plans,
  tasks,
  todos,
  workflowDefinitionTasks,
  workflowDefinitions,
  workspaceMemberships,
  workspaces,
  workspaceTypeWorkflows,
} from "../db/schema";
import { createId } from "../utils/id";
import {
  DEFAULT_GENERATION_AGENTS,
  getAgentSeedsForType,
  type DefaultGenerationAgentDefinition,
} from "../config/default-agents";
import {
  DEFAULT_USE_CASE_GENERATION_WORKFLOW,
  getWorkflowSeedsForType,
  type DefaultWorkflowDefinition,
} from "../config/default-workflows";
import {
  assertTaskStatusTransition,
  canPerformTodoAction,
  classifyGuardrailDecision,
  deriveAggregateStatus,
  getAllowedTaskStatusTransitions,
  isTaskStatus,
  type GuardrailCategory,
  type TaskStatus,
} from "./todo-runtime";
import { queueManager, type GenerationWorkflowTaskKey } from "./queue-manager";

export interface TodoActor {
  userId: string;
  role: string;
  workspaceId: string;
}

export class TodoOrchestrationError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "TodoOrchestrationError";
    this.status = status;
  }
}

const RUN_MODES = new Set(["manual", "sub_agentic", "full_auto"]);
const RUN_RESUMABLE_STATUSES = new Set(["paused", "blocked"]);
const RUN_ACTIVE_STATUSES = ["pending", "in_progress", "paused", "blocked"] as const;
const CHAT_SESSION_LINK_SOURCE_ENTITY_TYPE = "plan";
const GUARDRAIL_CATEGORIES = new Set<GuardrailCategory>(["scope", "quality", "safety", "approval"]);

const computeTaskStatusPath = (fromStatus: TaskStatus, toStatus: TaskStatus): TaskStatus[] | null => {
  if (fromStatus === toStatus) {
    return [fromStatus];
  }

  const queue: TaskStatus[][] = [[fromStatus]];
  const visited = new Set<TaskStatus>([fromStatus]);

  while (queue.length > 0) {
    const path = queue.shift();
    if (!path) break;

    const current = path[path.length - 1];
    for (const next of getAllowedTaskStatusTransitions(current)) {
      if (visited.has(next)) continue;
      const nextPath = [...path, next];
      if (next === toStatus) {
        return nextPath;
      }
      visited.add(next);
      queue.push(nextPath);
    }
  }

  return null;
};


const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

const normalizeMetadata = (value: unknown): Record<string, unknown> =>
  isRecord(value) ? value : {};

const isAdminRole = (role: string): boolean => role === "admin_app" || role === "admin_org";

const mapTask = (row: typeof tasks.$inferSelect) => ({
  id: row.id,
  workspaceId: row.workspaceId,
  todoId: row.todoId,
  title: row.title,
  description: row.description,
  position: row.position,
  status: row.status,
  createdByUserId: row.createdByUserId,
  assigneeUserId: row.assigneeUserId,
  startedAt: row.startedAt,
  completedAt: row.completedAt,
  metadata: normalizeMetadata(row.metadata),
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

export interface CreatePlanInput {
  title: string;
  description?: string | null;
  ownerUserId?: string | null;
  metadata?: Record<string, unknown>;
}

export interface PatchPlanInput {
  title?: string;
  description?: string | null;
  ownerUserId?: string | null;
  metadata?: Record<string, unknown>;
}

export interface CreateTodoInput {
  title: string;
  description?: string | null;
  position?: number;
  ownerUserId?: string | null;
  parentTodoId?: string | null;
  sessionId?: string | null;
  metadata?: Record<string, unknown>;
}

export interface PatchTodoInput {
  title?: string;
  description?: string | null;
  position?: number;
  ownerUserId?: string | null;
  metadata?: Record<string, unknown>;
  closed?: boolean;
}

export interface CreateTaskInput {
  title: string;
  description?: string | null;
  position?: number;
  status?: TaskStatus;
  assigneeUserId?: string | null;
  metadata?: Record<string, unknown>;
}

export interface PatchTaskInput {
  title?: string;
  description?: string | null;
  position?: number;
  status?: TaskStatus;
  assigneeUserId?: string | null;
  metadata?: Record<string, unknown>;
}

export interface TaskExecutionInput {
  mode?: "manual" | "sub_agentic" | "full_auto";
  metadata?: Record<string, unknown>;
  violatedGuardrailIds?: string[];
  approvalGrantedGuardrailIds?: string[];
}

/**
 * Generic task-key → agentDefinitionId map for any workflow (§7.3).
 * Keys are free runtime strings (open task-key mapping).
 */
export type WorkflowTaskAssignments = Record<string, string | null>;

export interface InitiativeGenerationWorkflowRuntime {
  workflowRunId: string;
  workflowDefinitionId: string;
  agentMap: Record<string, string>; // task key → agent definition ID
}

export interface StartInitiativeGenerationWorkflowDispatchResult extends InitiativeGenerationWorkflowRuntime {
  jobId: string;
  matrixJobId?: string;
}

/**
 * Matrix source selection (C):
 * - "organization": reuse the org's existing matrixConfig
 * - "prompt": run the matrix_generation_agent to generate from prompt
 * - "default": use workspace type default matrix (defaultMatrixConfig or opportunityMatrixConfig)
 */
export type MatrixSource = "organization" | "prompt" | "default";

export interface StartInitiativeGenerationWorkflowInput {
  folderId: string;
  organizationId?: string;
  matrixMode: "organization" | "generate" | "default";
  input: string;
  model: string;
  initiativeCount?: number;
  locale: string;
  /** When true, the create_organizations task is dispatched before context_prepare (B) */
  autoCreateOrganizations?: boolean;
  /**
   * Matrix source selection (C):
   * - "organization": reuse the org's existing matrixConfig
   * - "prompt": run the matrix_generation_agent to generate from prompt
   * - "default": use workspace type default matrix
   * When provided, overrides the legacy matrixMode logic.
   */
  matrixSource?: MatrixSource;
  /** Selected organization IDs for multi-org initiative generation (Lot 12) */
  orgIds?: string[];
}

/**
 * A resolved workflow task with its associated agent definition config.
 * Used by the generic dispatch loop (§7.4) to determine queue job routing.
 */
interface ResolvedWorkflowTask {
  taskKey: string;
  orderIndex: number;
  agentDefinitionId: string | null;
  agentRole: string | null;
  agentPromptTemplate: string | null;
}


interface TaskBundle {
  task: typeof tasks.$inferSelect;
  todo: typeof todos.$inferSelect;
  planId: string | null;
}

interface GuardrailEvaluation {
  decision: "allow" | "block" | "needs_approval";
  matched: Array<{ id: string; category: GuardrailCategory; decision: "block" | "needs_approval" }>;
}

type EventDbExecutor = Pick<typeof db, "select" | "insert">;

export class TodoOrchestrationService {
  private async assertWorkspaceMember(workspaceId: string, userId: string): Promise<void> {
    const [membership] = await db
      .select({ userId: workspaceMemberships.userId })
      .from(workspaceMemberships)
      .where(and(eq(workspaceMemberships.workspaceId, workspaceId), eq(workspaceMemberships.userId, userId)))
      .limit(1);

    if (!membership) {
      throw new TodoOrchestrationError(400, "User is not a workspace member");
    }
  }

  private async getPlanOrThrow(planId: string, workspaceId: string): Promise<typeof plans.$inferSelect> {
    const [plan] = await db
      .select()
      .from(plans)
      .where(and(eq(plans.id, planId), eq(plans.workspaceId, workspaceId)))
      .limit(1);

    if (!plan) {
      throw new TodoOrchestrationError(404, "Plan not found");
    }
    return plan;
  }

  private async getTodoOrThrow(todoId: string, workspaceId: string): Promise<typeof todos.$inferSelect> {
    const [todo] = await db
      .select()
      .from(todos)
      .where(and(eq(todos.id, todoId), eq(todos.workspaceId, workspaceId)))
      .limit(1);

    if (!todo) {
      throw new TodoOrchestrationError(404, "Todo not found");
    }
    return todo;
  }

  private async getTaskBundleOrThrow(taskId: string, workspaceId: string): Promise<TaskBundle> {
    const [row] = await db
      .select({
        task: tasks,
        todo: todos,
        planId: todos.planId,
      })
      .from(tasks)
      .innerJoin(todos, eq(tasks.todoId, todos.id))
      .where(and(eq(tasks.id, taskId), eq(tasks.workspaceId, workspaceId), eq(todos.workspaceId, workspaceId)))
      .limit(1);

    if (!row) {
      throw new TodoOrchestrationError(404, "Task not found");
    }

    return {
      task: row.task,
      todo: row.todo,
      planId: row.planId,
    };
  }

  private async getActiveSessionTodo(
    workspaceId: string,
    sessionId: string,
  ): Promise<typeof todos.$inferSelect | null> {
    const [row] = await db
      .select({ todo: todos })
      .from(entityLinks)
      .innerJoin(
        todos,
        and(
          eq(entityLinks.targetObjectId, todos.id),
          eq(entityLinks.workspaceId, todos.workspaceId),
        ),
      )
      .where(
        and(
          eq(entityLinks.workspaceId, workspaceId),
          eq(entityLinks.sourceEntityType, CHAT_SESSION_LINK_SOURCE_ENTITY_TYPE),
          eq(entityLinks.sourceEntityId, sessionId),
          eq(entityLinks.targetObjectType, "todo"),
          eq(todos.workspaceId, workspaceId),
          isNull(todos.closedAt),
        ),
      )
      .orderBy(desc(todos.createdAt), desc(todos.updatedAt))
      .limit(1);

    return row?.todo ?? null;
  }

  private async getLatestSessionTodo(
    workspaceId: string,
    sessionId: string,
  ): Promise<typeof todos.$inferSelect | null> {
    const [row] = await db
      .select({ todo: todos })
      .from(entityLinks)
      .innerJoin(
        todos,
        and(
          eq(entityLinks.targetObjectId, todos.id),
          eq(entityLinks.workspaceId, todos.workspaceId),
        ),
      )
      .where(
        and(
          eq(entityLinks.workspaceId, workspaceId),
          eq(entityLinks.sourceEntityType, CHAT_SESSION_LINK_SOURCE_ENTITY_TYPE),
          eq(entityLinks.sourceEntityId, sessionId),
          eq(entityLinks.targetObjectType, "todo"),
          eq(todos.workspaceId, workspaceId),
        ),
      )
      .orderBy(
        sql<number>`CASE WHEN ${todos.closedAt} IS NULL THEN 0 ELSE 1 END`,
        desc(todos.updatedAt),
        desc(todos.createdAt),
      )
      .limit(1);

    return row?.todo ?? null;
  }

  private async linkTodoToSession(workspaceId: string, sessionId: string, todoId: string): Promise<void> {
    await db
      .insert(entityLinks)
      .values({
        id: createId(),
        workspaceId,
        // entity_links constraint currently accepts plan/todo/task only.
        sourceEntityType: CHAT_SESSION_LINK_SOURCE_ENTITY_TYPE,
        sourceEntityId: sessionId,
        targetObjectType: "todo",
        targetObjectId: todoId,
        createdAt: new Date(),
      })
      .onConflictDoNothing();
  }

  private async getLatestTodoRun(
    workspaceId: string,
    todoId: string,
  ): Promise<typeof executionRuns.$inferSelect | null> {
    const [run] = await db
      .select()
      .from(executionRuns)
      .where(
        and(
          eq(executionRuns.workspaceId, workspaceId),
          eq(executionRuns.todoId, todoId),
          inArray(executionRuns.status, [...RUN_ACTIVE_STATUSES]),
        ),
      )
      .orderBy(desc(executionRuns.updatedAt), desc(executionRuns.startedAt), desc(executionRuns.createdAt))
      .limit(1);

    return run ?? null;
  }

  private async getRunOrThrow(runId: string, workspaceId: string): Promise<typeof executionRuns.$inferSelect> {
    const [run] = await db
      .select()
      .from(executionRuns)
      .where(and(eq(executionRuns.id, runId), eq(executionRuns.workspaceId, workspaceId)))
      .limit(1);

    if (!run) {
      throw new TodoOrchestrationError(404, "Run not found");
    }

    return run;
  }

  private async deriveTodoStatus(workspaceId: string, todoId: string): Promise<TaskStatus> {
    const rows = await db
      .select({ status: tasks.status })
      .from(tasks)
      .where(and(eq(tasks.workspaceId, workspaceId), eq(tasks.todoId, todoId)));

    const statuses = rows.map((row) => row.status).filter(isTaskStatus);
    return deriveAggregateStatus(statuses);
  }

  private async derivePlanStatus(workspaceId: string, planId: string): Promise<TaskStatus> {
    const rows = await db
      .select({ status: tasks.status })
      .from(tasks)
      .innerJoin(todos, eq(tasks.todoId, todos.id))
      .where(and(eq(tasks.workspaceId, workspaceId), eq(todos.workspaceId, workspaceId), eq(todos.planId, planId)));

    const statuses = rows.map((row) => row.status).filter(isTaskStatus);
    return deriveAggregateStatus(statuses);
  }

  private async appendExecutionEvent(
    executor: EventDbExecutor,
    params: {
      runId: string;
      workspaceId: string;
      eventType: string;
      actorId: string | null;
      actorType: string;
      payload: Record<string, unknown>;
    },
  ): Promise<void> {
    const [seqRow] = await executor
      .select({ maxSequence: sql<number>`COALESCE(MAX(${executionEvents.sequence}), 0)` })
      .from(executionEvents)
      .where(eq(executionEvents.runId, params.runId));

    const nextSequence = Number(seqRow?.maxSequence ?? 0) + 1;

    await executor.insert(executionEvents).values({
      id: createId(),
      workspaceId: params.workspaceId,
      runId: params.runId,
      eventType: params.eventType,
      actorType: params.actorType,
      actorId: params.actorId,
      payload: params.payload,
      sequence: nextSequence,
      createdAt: new Date(),
    });
  }

  private ensureTodoPermission(
    actor: TodoActor,
    action: Parameters<typeof canPerformTodoAction>[0],
    context: {
      todoCreatorUserId?: string | null;
      todoOwnerUserId?: string | null;
      taskAssigneeUserId?: string | null;
    },
  ): void {
    const allowed = canPerformTodoAction(action, {
      actorUserId: actor.userId,
      todoCreatorUserId: context.todoCreatorUserId,
      todoOwnerUserId: context.todoOwnerUserId,
      taskAssigneeUserId: context.taskAssigneeUserId,
      isAdmin: isAdminRole(actor.role),
    });

    if (!allowed) {
      throw new TodoOrchestrationError(403, "Insufficient permissions");
    }
  }

  private async evaluateTaskGuardrails(
    bundle: TaskBundle,
    input: TaskExecutionInput,
  ): Promise<GuardrailEvaluation> {
    const entityFilters = [
      and(eq(guardrails.entityType, "task"), eq(guardrails.entityId, bundle.task.id)),
      and(eq(guardrails.entityType, "todo"), eq(guardrails.entityId, bundle.todo.id)),
    ];
    if (bundle.planId) {
      entityFilters.push(and(eq(guardrails.entityType, "plan"), eq(guardrails.entityId, bundle.planId)));
    }

    const guardrailRows = await db
      .select()
      .from(guardrails)
      .where(
        and(
          eq(guardrails.workspaceId, bundle.task.workspaceId),
          eq(guardrails.isActive, true),
          or(...entityFilters),
        ),
      );

    const violatedIds = new Set(input.violatedGuardrailIds ?? []);
    const approvalGrantedIds = new Set(input.approvalGrantedGuardrailIds ?? []);
    const matched: Array<{ id: string; category: GuardrailCategory; decision: "block" | "needs_approval" }> = [];

    for (const row of guardrailRows) {
      if (!GUARDRAIL_CATEGORIES.has(row.category as GuardrailCategory)) {
        continue;
      }
      const category = row.category as GuardrailCategory;
      const config = normalizeMetadata(row.config);
      const violated = violatedIds.has(row.id) || config.violated === true;
      const approvalGranted = approvalGrantedIds.has(row.id) || config.approvalGranted === true;
      const decision = classifyGuardrailDecision({
        category,
        violated,
        isActive: row.isActive,
        approvalGranted,
      });

      if (decision === "block" || decision === "needs_approval") {
        matched.push({
          id: row.id,
          category,
          decision,
        });
      }
    }

    if (matched.some((entry) => entry.decision === "block")) {
      return { decision: "block", matched };
    }
    if (matched.length > 0) {
      return { decision: "needs_approval", matched };
    }
    return { decision: "allow", matched: [] };
  }

  private toPlanPayload(plan: typeof plans.$inferSelect, derivedStatus: TaskStatus) {
    return {
      id: plan.id,
      workspaceId: plan.workspaceId,
      title: plan.title,
      description: plan.description,
      createdByUserId: plan.createdByUserId,
      ownerUserId: plan.ownerUserId,
      metadata: normalizeMetadata(plan.metadata),
      createdAt: plan.createdAt,
      updatedAt: plan.updatedAt,
      derivedStatus,
    };
  }

  private toTodoPayload(todo: typeof todos.$inferSelect, derivedStatus: TaskStatus) {
    return {
      id: todo.id,
      workspaceId: todo.workspaceId,
      planId: todo.planId,
      parentTodoId: todo.parentTodoId,
      title: todo.title,
      description: todo.description,
      position: todo.position,
      createdByUserId: todo.createdByUserId,
      ownerUserId: todo.ownerUserId,
      closedAt: todo.closedAt,
      metadata: normalizeMetadata(todo.metadata),
      createdAt: todo.createdAt,
      updatedAt: todo.updatedAt,
      derivedStatus,
    };
  }

  async createPlan(actor: TodoActor, input: CreatePlanInput) {
    if (input.ownerUserId) {
      await this.assertWorkspaceMember(actor.workspaceId, input.ownerUserId);
    }

    const id = createId();
    const now = new Date();

    await db.insert(plans).values({
      id,
      workspaceId: actor.workspaceId,
      title: input.title,
      description: input.description ?? null,
      createdByUserId: actor.userId,
      ownerUserId: input.ownerUserId ?? actor.userId,
      metadata: normalizeMetadata(input.metadata),
      createdAt: now,
      updatedAt: now,
    });

    const created = await this.getPlanOrThrow(id, actor.workspaceId);
    const derivedStatus = await this.derivePlanStatus(actor.workspaceId, id);
    return this.toPlanPayload(created, derivedStatus);
  }

  async patchPlan(actor: TodoActor, planId: string, input: PatchPlanInput) {
    const plan = await this.getPlanOrThrow(planId, actor.workspaceId);
    const canEdit =
      isAdminRole(actor.role) ||
      plan.createdByUserId === actor.userId ||
      plan.ownerUserId === actor.userId;

    if (!canEdit) {
      throw new TodoOrchestrationError(403, "Insufficient permissions");
    }

    if (input.ownerUserId) {
      await this.assertWorkspaceMember(actor.workspaceId, input.ownerUserId);
    }

    const updates: Partial<typeof plans.$inferInsert> = { updatedAt: new Date() };
    if (input.title !== undefined) updates.title = input.title;
    if (input.description !== undefined) updates.description = input.description;
    if (input.ownerUserId !== undefined) updates.ownerUserId = input.ownerUserId;
    if (input.metadata !== undefined) updates.metadata = normalizeMetadata(input.metadata);

    if (Object.keys(updates).length === 1) {
      throw new TodoOrchestrationError(400, "No updates provided");
    }

    await db.update(plans).set(updates).where(and(eq(plans.id, planId), eq(plans.workspaceId, actor.workspaceId)));

    const updated = await this.getPlanOrThrow(planId, actor.workspaceId);
    const derivedStatus = await this.derivePlanStatus(actor.workspaceId, planId);
    return this.toPlanPayload(updated, derivedStatus);
  }

  async createTodo(actor: TodoActor, input: CreateTodoInput & { planId?: string | null }) {
    if (input.planId) {
      await this.getPlanOrThrow(input.planId, actor.workspaceId);
    }
    if (input.parentTodoId) {
      await this.getTodoOrThrow(input.parentTodoId, actor.workspaceId);
    }
    if (input.ownerUserId) {
      await this.assertWorkspaceMember(actor.workspaceId, input.ownerUserId);
    }

    const id = createId();
    const now = new Date();

    await db.insert(todos).values({
      id,
      workspaceId: actor.workspaceId,
      planId: input.planId ?? null,
      parentTodoId: input.parentTodoId ?? null,
      title: input.title,
      description: input.description ?? null,
      position: input.position ?? 0,
      createdByUserId: actor.userId,
      ownerUserId: input.ownerUserId ?? actor.userId,
      metadata: normalizeMetadata(input.metadata),
      createdAt: now,
      updatedAt: now,
    });

    if (input.sessionId) {
      await this.linkTodoToSession(actor.workspaceId, input.sessionId, id);
    }

    const created = await this.getTodoOrThrow(id, actor.workspaceId);
    const derivedStatus = await this.deriveTodoStatus(actor.workspaceId, id);
    return this.toTodoPayload(created, derivedStatus);
  }

  async patchTodo(actor: TodoActor, todoId: string, input: PatchTodoInput) {
    const todo = await this.getTodoOrThrow(todoId, actor.workspaceId);

    this.ensureTodoPermission(actor, "todo_edit", {
      todoCreatorUserId: todo.createdByUserId,
      todoOwnerUserId: todo.ownerUserId,
    });

    if (input.ownerUserId !== undefined && input.ownerUserId !== todo.ownerUserId) {
      this.ensureTodoPermission(actor, "todo_reassign", {
        todoCreatorUserId: todo.createdByUserId,
        todoOwnerUserId: todo.ownerUserId,
      });
      if (input.ownerUserId) {
        await this.assertWorkspaceMember(actor.workspaceId, input.ownerUserId);
      }
    }

    if (input.closed !== undefined) {
      this.ensureTodoPermission(actor, "todo_close", {
        todoCreatorUserId: todo.createdByUserId,
        todoOwnerUserId: todo.ownerUserId,
      });
    }

    const updates: Partial<typeof todos.$inferInsert> = { updatedAt: new Date() };
    if (input.title !== undefined) updates.title = input.title;
    if (input.description !== undefined) updates.description = input.description;
    if (input.position !== undefined) updates.position = input.position;
    if (input.ownerUserId !== undefined) updates.ownerUserId = input.ownerUserId;
    if (input.metadata !== undefined) updates.metadata = normalizeMetadata(input.metadata);
    if (input.closed !== undefined) updates.closedAt = input.closed ? new Date() : null;

    if (Object.keys(updates).length === 1) {
      throw new TodoOrchestrationError(400, "No updates provided");
    }

    await db.update(todos).set(updates).where(and(eq(todos.id, todoId), eq(todos.workspaceId, actor.workspaceId)));

    const updated = await this.getTodoOrThrow(todoId, actor.workspaceId);
    const derivedStatus = await this.deriveTodoStatus(actor.workspaceId, todoId);
    return this.toTodoPayload(updated, derivedStatus);
  }

  async assignTodo(actor: TodoActor, todoId: string, ownerUserId: string) {
    return this.patchTodo(actor, todoId, { ownerUserId });
  }

  async createTask(actor: TodoActor, todoId: string, input: CreateTaskInput) {
    const todo = await this.getTodoOrThrow(todoId, actor.workspaceId);

    this.ensureTodoPermission(actor, "task_update", {
      todoCreatorUserId: todo.createdByUserId,
      todoOwnerUserId: todo.ownerUserId,
    });

    if (input.assigneeUserId) {
      await this.assertWorkspaceMember(actor.workspaceId, input.assigneeUserId);
    }

    const status = input.status ?? "todo";
    if (!isTaskStatus(status)) {
      throw new TodoOrchestrationError(400, "Invalid task status");
    }

    const now = new Date();
    const id = createId();
    const startedAt = status === "in_progress" || status === "done" ? now : null;
    const completedAt = status === "done" ? now : null;

    await db.insert(tasks).values({
      id,
      workspaceId: actor.workspaceId,
      todoId,
      title: input.title,
      description: input.description ?? null,
      position: input.position ?? 0,
      status,
      createdByUserId: actor.userId,
      assigneeUserId: input.assigneeUserId ?? null,
      startedAt,
      completedAt,
      metadata: normalizeMetadata(input.metadata),
      createdAt: now,
      updatedAt: now,
    });

    const [created] = await db
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, id), eq(tasks.workspaceId, actor.workspaceId)))
      .limit(1);

    if (!created) {
      throw new TodoOrchestrationError(500, "Task creation failed");
    }

    const todoStatus = await this.deriveTodoStatus(actor.workspaceId, todoId);
    const planStatus = todo.planId ? await this.derivePlanStatus(actor.workspaceId, todo.planId) : null;

    return {
      task: mapTask(created),
      todoStatus,
      planStatus,
    };
  }

  async patchTask(actor: TodoActor, taskId: string, input: PatchTaskInput) {
    const bundle = await this.getTaskBundleOrThrow(taskId, actor.workspaceId);

    this.ensureTodoPermission(actor, "task_update", {
      todoCreatorUserId: bundle.todo.createdByUserId,
      todoOwnerUserId: bundle.todo.ownerUserId,
      taskAssigneeUserId: bundle.task.assigneeUserId,
    });

    if (input.assigneeUserId !== undefined && input.assigneeUserId !== bundle.task.assigneeUserId) {
      this.ensureTodoPermission(actor, "task_reassign", {
        todoCreatorUserId: bundle.todo.createdByUserId,
        todoOwnerUserId: bundle.todo.ownerUserId,
        taskAssigneeUserId: bundle.task.assigneeUserId,
      });
      if (input.assigneeUserId) {
        await this.assertWorkspaceMember(actor.workspaceId, input.assigneeUserId);
      }
    }

    let nextStatus = bundle.task.status;
    if (input.status !== undefined) {
      if (!isTaskStatus(input.status)) {
        throw new TodoOrchestrationError(400, "Invalid task status");
      }
      assertTaskStatusTransition(bundle.task.status as TaskStatus, input.status);
      nextStatus = input.status;
    }

    const now = new Date();
    const updates: Partial<typeof tasks.$inferInsert> = { updatedAt: now };
    if (input.title !== undefined) updates.title = input.title;
    if (input.description !== undefined) updates.description = input.description;
    if (input.position !== undefined) updates.position = input.position;
    if (input.assigneeUserId !== undefined) updates.assigneeUserId = input.assigneeUserId;
    if (input.metadata !== undefined) updates.metadata = normalizeMetadata(input.metadata);
    if (input.status !== undefined) updates.status = input.status;

    if (input.status !== undefined) {
      if (nextStatus === "in_progress") {
        updates.startedAt = bundle.task.startedAt ?? now;
        updates.completedAt = null;
      } else if (nextStatus === "done") {
        updates.startedAt = bundle.task.startedAt ?? now;
        updates.completedAt = now;
      } else {
        updates.completedAt = null;
      }
    }

    if (Object.keys(updates).length === 1) {
      throw new TodoOrchestrationError(400, "No updates provided");
    }

    await db.update(tasks).set(updates).where(and(eq(tasks.id, taskId), eq(tasks.workspaceId, actor.workspaceId)));

    const [updated] = await db
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, taskId), eq(tasks.workspaceId, actor.workspaceId)))
      .limit(1);

    if (!updated) {
      throw new TodoOrchestrationError(500, "Task update failed");
    }

    const todoStatus = await this.deriveTodoStatus(actor.workspaceId, bundle.todo.id);
    const planStatus = bundle.planId ? await this.derivePlanStatus(actor.workspaceId, bundle.planId) : null;

    return {
      task: mapTask(updated),
      todoStatus,
      planStatus,
    };
  }

  async assignTask(actor: TodoActor, taskId: string, assigneeUserId: string) {
    const bundle = await this.getTaskBundleOrThrow(taskId, actor.workspaceId);

    this.ensureTodoPermission(actor, "task_reassign", {
      todoCreatorUserId: bundle.todo.createdByUserId,
      todoOwnerUserId: bundle.todo.ownerUserId,
      taskAssigneeUserId: bundle.task.assigneeUserId,
    });

    await this.assertWorkspaceMember(actor.workspaceId, assigneeUserId);

    await db
      .update(tasks)
      .set({ assigneeUserId, updatedAt: new Date() })
      .where(and(eq(tasks.id, taskId), eq(tasks.workspaceId, actor.workspaceId)));

    const [updated] = await db
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, taskId), eq(tasks.workspaceId, actor.workspaceId)))
      .limit(1);

    if (!updated) {
      throw new TodoOrchestrationError(500, "Task assignment failed");
    }

    return mapTask(updated);
  }

  async startTask(actor: TodoActor, taskId: string, input: TaskExecutionInput) {
    const bundle = await this.getTaskBundleOrThrow(taskId, actor.workspaceId);

    this.ensureTodoPermission(actor, "task_update", {
      todoCreatorUserId: bundle.todo.createdByUserId,
      todoOwnerUserId: bundle.todo.ownerUserId,
      taskAssigneeUserId: bundle.task.assigneeUserId,
    });

    assertTaskStatusTransition(bundle.task.status as TaskStatus, "in_progress");

    const mode = input.mode ?? "manual";
    if (!RUN_MODES.has(mode)) {
      throw new TodoOrchestrationError(400, "Invalid run mode");
    }

    const guardrailEvaluation = await this.evaluateTaskGuardrails(bundle, input);
    const now = new Date();

    const runSummary = await db.transaction(async (tx) => {
      const runId = createId();
      const blocked = guardrailEvaluation.decision !== "allow";
      const runStatus = blocked ? "blocked" : "in_progress";

      await tx.insert(executionRuns).values({
        id: runId,
        workspaceId: actor.workspaceId,
        planId: bundle.planId,
        todoId: bundle.todo.id,
        taskId: bundle.task.id,
        workflowDefinitionId: null,
        agentDefinitionId: null,
        mode,
        status: runStatus,
        startedByUserId: actor.userId,
        startedAt: now,
        completedAt: null,
        metadata: normalizeMetadata(input.metadata),
        createdAt: now,
        updatedAt: now,
      });

      if (!blocked) {
        await tx
          .update(tasks)
          .set({ status: "in_progress", startedAt: bundle.task.startedAt ?? now, completedAt: null, updatedAt: now })
          .where(and(eq(tasks.id, bundle.task.id), eq(tasks.workspaceId, actor.workspaceId)));

        await this.appendExecutionEvent(tx, {
          runId,
          workspaceId: actor.workspaceId,
          eventType: "task_started",
          actorType: "user",
          actorId: actor.userId,
          payload: {
            taskId: bundle.task.id,
            previousStatus: bundle.task.status,
            nextStatus: "in_progress",
          },
        });
      } else {
        await this.appendExecutionEvent(tx, {
          runId,
          workspaceId: actor.workspaceId,
          eventType: guardrailEvaluation.decision === "block" ? "guardrail_blocked" : "guardrail_needs_approval",
          actorType: "user",
          actorId: actor.userId,
          payload: {
            taskId: bundle.task.id,
            action: "task_start",
            guardrails: guardrailEvaluation.matched,
          },
        });
      }

      return {
        runId,
        blocked,
        runStatus,
      };
    });

    const [latestTask] = await db
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, bundle.task.id), eq(tasks.workspaceId, actor.workspaceId)))
      .limit(1);

    if (!latestTask) {
      throw new TodoOrchestrationError(500, "Task state unavailable after start");
    }

    return {
      runId: runSummary.runId,
      blocked: runSummary.blocked,
      runStatus: runSummary.runStatus,
      task: mapTask(latestTask),
      guardrailDecision: guardrailEvaluation.decision,
      guardrails: guardrailEvaluation.matched,
    };
  }

  async completeTask(actor: TodoActor, taskId: string, input: TaskExecutionInput) {
    const bundle = await this.getTaskBundleOrThrow(taskId, actor.workspaceId);

    this.ensureTodoPermission(actor, "task_update", {
      todoCreatorUserId: bundle.todo.createdByUserId,
      todoOwnerUserId: bundle.todo.ownerUserId,
      taskAssigneeUserId: bundle.task.assigneeUserId,
    });

    assertTaskStatusTransition(bundle.task.status as TaskStatus, "done");

    const guardrailEvaluation = await this.evaluateTaskGuardrails(bundle, input);
    const now = new Date();

    const [latestRun] = await db
      .select()
      .from(executionRuns)
      .where(and(eq(executionRuns.workspaceId, actor.workspaceId), eq(executionRuns.taskId, bundle.task.id)))
      .orderBy(desc(executionRuns.startedAt), desc(executionRuns.createdAt))
      .limit(1);

    const completionSummary = await db.transaction(async (tx) => {
      let runId = latestRun?.id;
      const blocked = guardrailEvaluation.decision !== "allow";

      if (!runId) {
        runId = createId();
        await tx.insert(executionRuns).values({
          id: runId,
          workspaceId: actor.workspaceId,
          planId: bundle.planId,
          todoId: bundle.todo.id,
          taskId: bundle.task.id,
          workflowDefinitionId: null,
          agentDefinitionId: null,
          mode: input.mode ?? "manual",
          status: blocked ? "blocked" : "completed",
          startedByUserId: actor.userId,
          startedAt: now,
          completedAt: blocked ? null : now,
          metadata: normalizeMetadata(input.metadata),
          createdAt: now,
          updatedAt: now,
        });
      } else {
        await tx
          .update(executionRuns)
          .set({
            status: blocked ? "blocked" : "completed",
            completedAt: blocked ? null : now,
            updatedAt: now,
          })
          .where(and(eq(executionRuns.id, runId), eq(executionRuns.workspaceId, actor.workspaceId)));
      }

      if (!blocked) {
        await tx
          .update(tasks)
          .set({ status: "done", completedAt: now, startedAt: bundle.task.startedAt ?? now, updatedAt: now })
          .where(and(eq(tasks.id, bundle.task.id), eq(tasks.workspaceId, actor.workspaceId)));

        await this.appendExecutionEvent(tx, {
          runId,
          workspaceId: actor.workspaceId,
          eventType: "task_completed",
          actorType: "user",
          actorId: actor.userId,
          payload: {
            taskId: bundle.task.id,
            previousStatus: bundle.task.status,
            nextStatus: "done",
          },
        });
      } else {
        await this.appendExecutionEvent(tx, {
          runId,
          workspaceId: actor.workspaceId,
          eventType: guardrailEvaluation.decision === "block" ? "guardrail_blocked" : "guardrail_needs_approval",
          actorType: "user",
          actorId: actor.userId,
          payload: {
            taskId: bundle.task.id,
            action: "task_complete",
            guardrails: guardrailEvaluation.matched,
          },
        });
      }

      return { runId, blocked };
    });

    const [latestTask] = await db
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, bundle.task.id), eq(tasks.workspaceId, actor.workspaceId)))
      .limit(1);

    if (!latestTask) {
      throw new TodoOrchestrationError(500, "Task state unavailable after completion");
    }

    return {
      runId: completionSummary.runId,
      blocked: completionSummary.blocked,
      task: mapTask(latestTask),
      guardrailDecision: guardrailEvaluation.decision,
      guardrails: guardrailEvaluation.matched,
    };
  }

  async pauseRun(actor: TodoActor, runId: string) {
    const run = await this.getRunOrThrow(runId, actor.workspaceId);
    if (run.status !== "in_progress") {
      throw new TodoOrchestrationError(409, "Run cannot be paused from current status");
    }

    const now = new Date();
    await db
      .update(executionRuns)
      .set({ status: "paused", updatedAt: now })
      .where(and(eq(executionRuns.id, run.id), eq(executionRuns.workspaceId, actor.workspaceId)));

    await this.appendExecutionEvent(db, {
      runId: run.id,
      workspaceId: run.workspaceId,
      eventType: "run_paused",
      actorType: "user",
      actorId: actor.userId,
      payload: { previousStatus: run.status, nextStatus: "paused" },
    });

    return {
      runId: run.id,
      status: "paused",
    };
  }

  async resumeRun(actor: TodoActor, runId: string) {
    const run = await this.getRunOrThrow(runId, actor.workspaceId);
    if (!RUN_RESUMABLE_STATUSES.has(run.status)) {
      throw new TodoOrchestrationError(409, "Run cannot be resumed from current status");
    }

    const now = new Date();
    await db
      .update(executionRuns)
      .set({ status: "in_progress", updatedAt: now })
      .where(and(eq(executionRuns.id, run.id), eq(executionRuns.workspaceId, actor.workspaceId)));

    await this.appendExecutionEvent(db, {
      runId: run.id,
      workspaceId: run.workspaceId,
      eventType: "run_resumed",
      actorType: "user",
      actorId: actor.userId,
      payload: { previousStatus: run.status, nextStatus: "in_progress" },
    });

    return {
      runId: run.id,
      status: "in_progress",
    };
  }

  async listAgentConfigs(actor: TodoActor) {
    const rows = await db
      .select()
      .from(agentDefinitions)
      .where(eq(agentDefinitions.workspaceId, actor.workspaceId))
      .orderBy(asc(agentDefinitions.createdAt));

    return rows.map((row) => ({
      id: row.id,
      workspaceId: row.workspaceId,
      key: row.key,
      name: row.name,
      description: row.description,
      config: normalizeMetadata(row.config),
      sourceLevel: row.sourceLevel,
      lineageRootId: row.lineageRootId,
      parentId: row.parentId,
      isDetached: row.isDetached,
      lastParentSyncAt: row.lastParentSyncAt,
      createdByUserId: row.createdByUserId,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));
  }

  async putAgentConfigs(
    actor: TodoActor,
    items: Array<{
      id?: string;
      key: string;
      name: string;
      description?: string | null;
      config?: Record<string, unknown>;
      sourceLevel?: "code" | "admin" | "user";
    }>,
  ) {
    const now = new Date();

    for (const item of items) {
      const [existing] = await db
        .select()
        .from(agentDefinitions)
        .where(
          and(
            eq(agentDefinitions.workspaceId, actor.workspaceId),
            item.id
              ? eq(agentDefinitions.id, item.id)
              : eq(agentDefinitions.key, item.key),
          ),
        )
        .limit(1);

      if (existing) {
        await db
          .update(agentDefinitions)
          .set({
            key: item.key,
            name: item.name,
            description: item.description ?? null,
            config: normalizeMetadata(item.config),
            sourceLevel: item.sourceLevel ?? existing.sourceLevel,
            updatedAt: now,
          })
          .where(and(eq(agentDefinitions.id, existing.id), eq(agentDefinitions.workspaceId, actor.workspaceId)));
      } else {
        const id = createId();
        await db.insert(agentDefinitions).values({
          id,
          workspaceId: actor.workspaceId,
          key: item.key,
          name: item.name,
          description: item.description ?? null,
          config: normalizeMetadata(item.config),
          sourceLevel: item.sourceLevel ?? "user",
          lineageRootId: id,
          parentId: null,
          isDetached: false,
          lastParentSyncAt: now,
          createdByUserId: actor.userId,
          createdAt: now,
          updatedAt: now,
        });
      }
    }

    return this.listAgentConfigs(actor);
  }

  async forkAgentConfig(actor: TodoActor, id: string, input: { key?: string; name?: string }) {
    const [source] = await db
      .select()
      .from(agentDefinitions)
      .where(and(eq(agentDefinitions.id, id), eq(agentDefinitions.workspaceId, actor.workspaceId)))
      .limit(1);

    if (!source) {
      throw new TodoOrchestrationError(404, "Agent config not found");
    }

    const now = new Date();
    const forkId = createId();
    const keyBase = (input.key ?? `${source.key}-fork`).trim();
    const name = (input.name ?? `${source.name} (fork)`).trim();

    let keyCandidate = keyBase;
    const [duplicate] = await db
      .select({ id: agentDefinitions.id })
      .from(agentDefinitions)
      .where(and(eq(agentDefinitions.workspaceId, actor.workspaceId), eq(agentDefinitions.key, keyCandidate)))
      .limit(1);

    if (duplicate) {
      keyCandidate = `${keyBase}-${Date.now()}`;
    }

    await db.insert(agentDefinitions).values({
      id: forkId,
      workspaceId: actor.workspaceId,
      key: keyCandidate,
      name,
      description: source.description,
      config: normalizeMetadata(source.config),
      sourceLevel: "user",
      lineageRootId: source.lineageRootId ?? source.id,
      parentId: source.id,
      isDetached: false,
      lastParentSyncAt: now,
      createdByUserId: actor.userId,
      createdAt: now,
      updatedAt: now,
    });

    const [created] = await db
      .select()
      .from(agentDefinitions)
      .where(and(eq(agentDefinitions.id, forkId), eq(agentDefinitions.workspaceId, actor.workspaceId)))
      .limit(1);

    return created;
  }

  async detachAgentConfig(actor: TodoActor, id: string) {
    const [source] = await db
      .select()
      .from(agentDefinitions)
      .where(and(eq(agentDefinitions.id, id), eq(agentDefinitions.workspaceId, actor.workspaceId)))
      .limit(1);

    if (!source) {
      throw new TodoOrchestrationError(404, "Agent config not found");
    }

    const now = new Date();
    await db
      .update(agentDefinitions)
      .set({ isDetached: true, lastParentSyncAt: now, updatedAt: now })
      .where(and(eq(agentDefinitions.id, source.id), eq(agentDefinitions.workspaceId, actor.workspaceId)));

    const [updated] = await db
      .select()
      .from(agentDefinitions)
      .where(and(eq(agentDefinitions.id, source.id), eq(agentDefinitions.workspaceId, actor.workspaceId)))
      .limit(1);

    return updated;
  }

  async listWorkflowConfigs(actor: TodoActor) {
    const defs = await db
      .select()
      .from(workflowDefinitions)
      .where(eq(workflowDefinitions.workspaceId, actor.workspaceId))
      .orderBy(asc(workflowDefinitions.createdAt));

    if (defs.length === 0) {
      return [];
    }

    const defIds = defs.map((row) => row.id);
    const steps = await db
      .select()
      .from(workflowDefinitionTasks)
      .where(
        and(
          eq(workflowDefinitionTasks.workspaceId, actor.workspaceId),
          inArray(workflowDefinitionTasks.workflowDefinitionId, defIds),
        ),
      )
      .orderBy(asc(workflowDefinitionTasks.orderIndex), asc(workflowDefinitionTasks.createdAt));

    const stepsByWorkflow = new Map<string, Array<typeof workflowDefinitionTasks.$inferSelect>>();
    for (const step of steps) {
      const list = stepsByWorkflow.get(step.workflowDefinitionId) ?? [];
      list.push(step);
      stepsByWorkflow.set(step.workflowDefinitionId, list);
    }

    return defs.map((def) => ({
      id: def.id,
      workspaceId: def.workspaceId,
      key: def.key,
      name: def.name,
      description: def.description,
      config: normalizeMetadata(def.config),
      sourceLevel: def.sourceLevel,
      lineageRootId: def.lineageRootId,
      parentId: def.parentId,
      isDetached: def.isDetached,
      lastParentSyncAt: def.lastParentSyncAt,
      createdByUserId: def.createdByUserId,
      createdAt: def.createdAt,
      updatedAt: def.updatedAt,
      tasks: (stepsByWorkflow.get(def.id) ?? []).map((step) => ({
        id: step.id,
        taskKey: step.taskKey,
        title: step.title,
        description: step.description,
        orderIndex: step.orderIndex,
        agentDefinitionId: step.agentDefinitionId,
        schemaFormat: step.schemaFormat,
        inputSchema: normalizeMetadata(step.inputSchema),
        outputSchema: normalizeMetadata(step.outputSchema),
        sectionKey: step.sectionKey,
        metadata: normalizeMetadata(step.metadata),
      })),
    }));
  }

  async putWorkflowConfigs(
    actor: TodoActor,
    items: Array<{
      id?: string;
      key: string;
      name: string;
      description?: string | null;
      config?: Record<string, unknown>;
      sourceLevel?: "code" | "admin" | "user";
      tasks?: Array<{
        taskKey: string;
        title: string;
        description?: string | null;
        orderIndex?: number;
        agentDefinitionId?: string | null;
        inputSchema?: Record<string, unknown>;
        outputSchema?: Record<string, unknown>;
        sectionKey?: string | null;
        metadata?: Record<string, unknown>;
      }>;
    }>,
  ) {
    const now = new Date();

    for (const item of items) {
      const [existing] = await db
        .select()
        .from(workflowDefinitions)
        .where(
          and(
            eq(workflowDefinitions.workspaceId, actor.workspaceId),
            item.id
              ? eq(workflowDefinitions.id, item.id)
              : eq(workflowDefinitions.key, item.key),
          ),
        )
        .limit(1);

      const workflowId = existing?.id ?? createId();

      if (existing) {
        await db
          .update(workflowDefinitions)
          .set({
            key: item.key,
            name: item.name,
            description: item.description ?? null,
            config: normalizeMetadata(item.config),
            sourceLevel: item.sourceLevel ?? existing.sourceLevel,
            updatedAt: now,
          })
          .where(and(eq(workflowDefinitions.id, existing.id), eq(workflowDefinitions.workspaceId, actor.workspaceId)));
      } else {
        await db.insert(workflowDefinitions).values({
          id: workflowId,
          workspaceId: actor.workspaceId,
          key: item.key,
          name: item.name,
          description: item.description ?? null,
          config: normalizeMetadata(item.config),
          sourceLevel: item.sourceLevel ?? "user",
          lineageRootId: workflowId,
          parentId: null,
          isDetached: false,
          lastParentSyncAt: now,
          createdByUserId: actor.userId,
          createdAt: now,
          updatedAt: now,
        });
      }

      const workflowTasks = item.tasks;
      if (Array.isArray(workflowTasks)) {
        await db.transaction(async (tx) => {
          await tx
            .delete(workflowDefinitionTasks)
            .where(
              and(
                eq(workflowDefinitionTasks.workspaceId, actor.workspaceId),
                eq(workflowDefinitionTasks.workflowDefinitionId, workflowId),
              ),
            );

          if (workflowTasks.length === 0) {
            return;
          }

          await tx.insert(workflowDefinitionTasks).values(
            workflowTasks.map((step, index) => ({
              id: createId(),
              workspaceId: actor.workspaceId,
              workflowDefinitionId: workflowId,
              taskKey: step.taskKey,
              title: step.title,
              description: step.description ?? null,
              orderIndex: step.orderIndex ?? index,
              agentDefinitionId: step.agentDefinitionId ?? null,
              schemaFormat: "json_schema",
              inputSchema: normalizeMetadata(step.inputSchema),
              outputSchema: normalizeMetadata(step.outputSchema),
              sectionKey: step.sectionKey ?? null,
              metadata: normalizeMetadata(step.metadata),
              createdAt: now,
              updatedAt: now,
            })),
          );
        });
      }
    }

    return this.listWorkflowConfigs(actor);
  }

  async forkWorkflowConfig(actor: TodoActor, id: string, input: { key?: string; name?: string }) {
    const [source] = await db
      .select()
      .from(workflowDefinitions)
      .where(and(eq(workflowDefinitions.id, id), eq(workflowDefinitions.workspaceId, actor.workspaceId)))
      .limit(1);

    if (!source) {
      throw new TodoOrchestrationError(404, "Workflow config not found");
    }

    const sourceTasks = await db
      .select()
      .from(workflowDefinitionTasks)
      .where(
        and(
          eq(workflowDefinitionTasks.workspaceId, actor.workspaceId),
          eq(workflowDefinitionTasks.workflowDefinitionId, source.id),
        ),
      )
      .orderBy(asc(workflowDefinitionTasks.orderIndex), asc(workflowDefinitionTasks.createdAt));

    const now = new Date();
    const forkId = createId();
    const keyBase = (input.key ?? `${source.key}-fork`).trim();
    const name = (input.name ?? `${source.name} (fork)`).trim();

    let keyCandidate = keyBase;
    const [duplicate] = await db
      .select({ id: workflowDefinitions.id })
      .from(workflowDefinitions)
      .where(and(eq(workflowDefinitions.workspaceId, actor.workspaceId), eq(workflowDefinitions.key, keyCandidate)))
      .limit(1);

    if (duplicate) {
      keyCandidate = `${keyBase}-${Date.now()}`;
    }

    await db.transaction(async (tx) => {
      await tx.insert(workflowDefinitions).values({
        id: forkId,
        workspaceId: actor.workspaceId,
        key: keyCandidate,
        name,
        description: source.description,
        config: normalizeMetadata(source.config),
        sourceLevel: "user",
        lineageRootId: source.lineageRootId ?? source.id,
        parentId: source.id,
        isDetached: false,
        lastParentSyncAt: now,
        createdByUserId: actor.userId,
        createdAt: now,
        updatedAt: now,
      });

      if (sourceTasks.length > 0) {
        await tx.insert(workflowDefinitionTasks).values(
          sourceTasks.map((step) => ({
            id: createId(),
            workspaceId: actor.workspaceId,
            workflowDefinitionId: forkId,
            taskKey: step.taskKey,
            title: step.title,
            description: step.description,
            orderIndex: step.orderIndex,
            agentDefinitionId: step.agentDefinitionId,
            schemaFormat: step.schemaFormat,
            inputSchema: normalizeMetadata(step.inputSchema),
            outputSchema: normalizeMetadata(step.outputSchema),
            sectionKey: step.sectionKey,
            metadata: normalizeMetadata(step.metadata),
            createdAt: now,
            updatedAt: now,
          })),
        );
      }
    });

    const [created] = await db
      .select()
      .from(workflowDefinitions)
      .where(and(eq(workflowDefinitions.id, forkId), eq(workflowDefinitions.workspaceId, actor.workspaceId)))
      .limit(1);

    return created;
  }

  async detachWorkflowConfig(actor: TodoActor, id: string) {
    const [source] = await db
      .select()
      .from(workflowDefinitions)
      .where(and(eq(workflowDefinitions.id, id), eq(workflowDefinitions.workspaceId, actor.workspaceId)))
      .limit(1);

    if (!source) {
      throw new TodoOrchestrationError(404, "Workflow config not found");
    }

    const now = new Date();
    await db
      .update(workflowDefinitions)
      .set({ isDetached: true, lastParentSyncAt: now, updatedAt: now })
      .where(and(eq(workflowDefinitions.id, source.id), eq(workflowDefinitions.workspaceId, actor.workspaceId)));

    const [updated] = await db
      .select()
      .from(workflowDefinitions)
      .where(and(eq(workflowDefinitions.id, source.id), eq(workflowDefinitions.workspaceId, actor.workspaceId)))
      .limit(1);

    return updated;
  }

  /**
   * Seed agents for a given workspace type (§8.1).
   * For backward compat, calling with no agentSeeds defaults to ai-ideas agents.
   */
  async seedAgentsForType(
    actor: TodoActor,
    agentSeeds?: ReadonlyArray<DefaultGenerationAgentDefinition>,
  ): Promise<Record<string, string>> {
    const seeds = agentSeeds ?? DEFAULT_GENERATION_AGENTS;
    if (seeds.length === 0) return {};

    const now = new Date();
    const requestedKeys = seeds.map((item) => item.key);

    const existingRows = await db
      .select()
      .from(agentDefinitions)
      .where(
        and(
          eq(agentDefinitions.workspaceId, actor.workspaceId),
          inArray(agentDefinitions.key, requestedKeys),
        ),
      );
    const existingByKey = new Map(existingRows.map((row) => [row.key, row]));

    for (const seed of seeds) {
      const existing = existingByKey.get(seed.key);
      if (!existing) {
        const id = createId();
        await db.insert(agentDefinitions).values({
          id,
          workspaceId: actor.workspaceId,
          key: seed.key,
          name: seed.name,
          description: seed.description,
          config: normalizeMetadata(seed.config),
          sourceLevel: seed.sourceLevel,
          lineageRootId: id,
          parentId: null,
          isDetached: false,
          lastParentSyncAt: now,
          createdByUserId: actor.userId,
          createdAt: now,
          updatedAt: now,
        });
        continue;
      }

      if (existing.sourceLevel !== "code" || existing.isDetached || existing.parentId) {
        continue;
      }

      const currentConfig = normalizeMetadata(existing.config);
      const nextConfig = normalizeMetadata(seed.config);
      const shouldSync =
        existing.name !== seed.name ||
        (existing.description ?? null) !== (seed.description ?? null) ||
        JSON.stringify(currentConfig) !== JSON.stringify(nextConfig);

      if (!shouldSync) {
        continue;
      }

      await db
        .update(agentDefinitions)
        .set({
          name: seed.name,
          description: seed.description,
          config: nextConfig,
          updatedAt: now,
          lastParentSyncAt: now,
        })
        .where(
          and(
            eq(agentDefinitions.id, existing.id),
            eq(agentDefinitions.workspaceId, actor.workspaceId),
          ),
        );
    }

    const syncedRows = await db
      .select({ id: agentDefinitions.id, key: agentDefinitions.key })
      .from(agentDefinitions)
      .where(
        and(
          eq(agentDefinitions.workspaceId, actor.workspaceId),
          inArray(agentDefinitions.key, requestedKeys),
        ),
      );
    const idsByKey = new Map(syncedRows.map((row) => [row.key, row.id]));

    const out: Record<string, string> = {};
    for (const seed of seeds) {
      const agentId = idsByKey.get(seed.key);
      if (!agentId) {
        throw new TodoOrchestrationError(
          500,
          `Missing generation agent definition for key ${seed.key}`,
        );
      }
      out[seed.key] = agentId;
    }

    return out;
  }

  /**
   * @deprecated Use seedAgentsForType() instead. Kept for backward compat.
   */
  private async ensureDefaultGenerationAgents(
    actor: TodoActor,
  ): Promise<Record<string, string>> {
    return this.seedAgentsForType(actor, DEFAULT_GENERATION_AGENTS);
  }

  /**
   * Seed workflows and register them in workspace_type_workflows for a given
   * workspace type (§7.6). Called on workspace creation.
   */
  async seedWorkflowsForType(
    actor: TodoActor,
    workspaceType: string,
  ): Promise<void> {
    const typeSeed = getWorkflowSeedsForType(workspaceType);
    if (!typeSeed) return; // neutral has no workflows

    // Seed agents for this type
    const agentSeed = getAgentSeedsForType(workspaceType);
    const agentIdsByKey = agentSeed
      ? await this.seedAgentsForType(actor, agentSeed.agents)
      : {};

    const now = new Date();

    for (const wfSeed of typeSeed.workflows) {
      await this.ensureWorkflowDefinition(actor, wfSeed, agentIdsByKey);
    }

    // Register in workspace_type_workflows if not already registered
    for (const wfSeed of typeSeed.workflows) {
      const [wfDef] = await db
        .select({ id: workflowDefinitions.id })
        .from(workflowDefinitions)
        .where(
          and(
            eq(workflowDefinitions.workspaceId, actor.workspaceId),
            eq(workflowDefinitions.key, wfSeed.key),
          ),
        )
        .limit(1);

      if (!wfDef) continue;

      const [existing] = await db
        .select({ id: workspaceTypeWorkflows.id })
        .from(workspaceTypeWorkflows)
        .where(
          and(
            eq(workspaceTypeWorkflows.workspaceType, workspaceType),
            eq(workspaceTypeWorkflows.workflowDefinitionId, wfDef.id),
          ),
        )
        .limit(1);

      if (!existing) {
        await db.insert(workspaceTypeWorkflows).values({
          id: createId(),
          workspaceType,
          workflowDefinitionId: wfDef.id,
          isDefault: wfSeed.key === typeSeed.defaultWorkflowKey,
          triggerStage: null,
          config: {},
          createdAt: now,
          updatedAt: now,
        });
      }
    }
  }

  /**
   * Ensure a workflow definition exists for the workspace (generic version of
   * ensureInitiativeGenerationWorkflowDefinition). Creates or syncs from seed.
   */
  private async ensureWorkflowDefinition(
    actor: TodoActor,
    seed: DefaultWorkflowDefinition,
    agentIdsByKey: Record<string, string>,
  ): Promise<string> {
    const now = new Date();
    const [existing] = await db
      .select()
      .from(workflowDefinitions)
      .where(
        and(
          eq(workflowDefinitions.workspaceId, actor.workspaceId),
          eq(workflowDefinitions.key, seed.key),
        ),
      )
      .limit(1);

    const workflowDefinitionId = existing?.id ?? createId();

    if (!existing) {
      await db.insert(workflowDefinitions).values({
        id: workflowDefinitionId,
        workspaceId: actor.workspaceId,
        key: seed.key,
        name: seed.name,
        description: seed.description,
        config: normalizeMetadata(seed.config),
        sourceLevel: "code",
        lineageRootId: workflowDefinitionId,
        parentId: null,
        isDetached: false,
        lastParentSyncAt: now,
        createdByUserId: actor.userId,
        createdAt: now,
        updatedAt: now,
      });
    } else if (
      existing.sourceLevel === "code" &&
      !existing.isDetached &&
      !existing.parentId
    ) {
      const currentConfig = normalizeMetadata(existing.config);
      const nextConfig = normalizeMetadata(seed.config);
      const shouldSync =
        existing.name !== seed.name ||
        (existing.description ?? null) !== (seed.description ?? null) ||
        JSON.stringify(currentConfig) !== JSON.stringify(nextConfig);
      if (shouldSync) {
        await db
          .update(workflowDefinitions)
          .set({
            name: seed.name,
            description: seed.description,
            config: nextConfig,
            updatedAt: now,
            lastParentSyncAt: now,
          })
          .where(
            and(
              eq(workflowDefinitions.id, existing.id),
              eq(workflowDefinitions.workspaceId, actor.workspaceId),
            ),
          );
      }
    }

    // Ensure workflow tasks
    const existingTasks = await db
      .select({ id: workflowDefinitionTasks.id, taskKey: workflowDefinitionTasks.taskKey, agentDefinitionId: workflowDefinitionTasks.agentDefinitionId })
      .from(workflowDefinitionTasks)
      .where(
        and(
          eq(workflowDefinitionTasks.workspaceId, actor.workspaceId),
          eq(workflowDefinitionTasks.workflowDefinitionId, workflowDefinitionId),
        ),
      );
    const existingTaskKeys = new Set(existingTasks.map((row) => row.taskKey));

    const missingTasks = seed.tasks.filter(
      (taskDef) => !existingTaskKeys.has(taskDef.taskKey),
    );

    if (missingTasks.length > 0) {
      await db.insert(workflowDefinitionTasks).values(
        missingTasks.map((taskDef) => ({
          id: createId(),
          workspaceId: actor.workspaceId,
          workflowDefinitionId,
          taskKey: taskDef.taskKey,
          title: taskDef.title,
          description: taskDef.description,
          orderIndex: taskDef.orderIndex,
          agentDefinitionId: agentIdsByKey[taskDef.agentKey] ?? null,
          schemaFormat: "json_schema",
          inputSchema: {},
          outputSchema: {},
          sectionKey: null,
          metadata: {},
          createdAt: now,
          updatedAt: now,
        })),
      );
    }

    // Backfill missing agent assignments
    for (const row of existingTasks) {
      if (row.agentDefinitionId) continue;
      // Find the matching seed task to get the agentKey
      const seedTask = seed.tasks.find((t) => t.taskKey === row.taskKey);
      if (!seedTask) continue;
      const agentId = agentIdsByKey[seedTask.agentKey];
      if (!agentId) continue;
      await db
        .update(workflowDefinitionTasks)
        .set({ agentDefinitionId: agentId, updatedAt: now })
        .where(
          and(
            eq(workflowDefinitionTasks.id, row.id),
            eq(workflowDefinitionTasks.workspaceId, actor.workspaceId),
          ),
        );
    }

    return workflowDefinitionId;
  }

  /**
   * Generic workflow dispatch (§7.4).
   * Resolves workflow from workspace_type_workflows → workflow_definitions → ordered tasks,
   * then creates an execution run and dispatches.
   */
  async startWorkflow(
    actor: TodoActor,
    workflowKey: string,
    metadata?: Record<string, unknown>,
  ): Promise<{ workflowRunId: string; workflowDefinitionId: string; taskAssignments: WorkflowTaskAssignments }> {
    // Resolve workflow definition for this workspace
    const [wfDef] = await db
      .select()
      .from(workflowDefinitions)
      .where(
        and(
          eq(workflowDefinitions.workspaceId, actor.workspaceId),
          eq(workflowDefinitions.key, workflowKey),
        ),
      )
      .limit(1);

    if (!wfDef) {
      throw new TodoOrchestrationError(404, `Workflow not found: ${workflowKey}`);
    }

    // Resolve task assignments
    const wfTasks = await db
      .select({
        taskKey: workflowDefinitionTasks.taskKey,
        agentDefinitionId: workflowDefinitionTasks.agentDefinitionId,
      })
      .from(workflowDefinitionTasks)
      .where(
        and(
          eq(workflowDefinitionTasks.workspaceId, actor.workspaceId),
          eq(workflowDefinitionTasks.workflowDefinitionId, wfDef.id),
        ),
      )
      .orderBy(asc(workflowDefinitionTasks.orderIndex), asc(workflowDefinitionTasks.createdAt));

    const taskAssignments: WorkflowTaskAssignments = {};
    for (const t of wfTasks) {
      taskAssignments[t.taskKey] = t.agentDefinitionId ?? null;
    }

    // Create execution run
    const workflowRunId = createId();
    const now = new Date();
    const firstAgentId = wfTasks.length > 0 ? (wfTasks[0].agentDefinitionId ?? null) : null;

    await db.insert(executionRuns).values({
      id: workflowRunId,
      workspaceId: actor.workspaceId,
      planId: null,
      todoId: null,
      taskId: null,
      workflowDefinitionId: wfDef.id,
      agentDefinitionId: firstAgentId,
      mode: "full_auto",
      status: "in_progress",
      startedByUserId: actor.userId,
      startedAt: now,
      completedAt: null,
      metadata: normalizeMetadata({
        workflowKey,
        ...metadata,
      }),
      createdAt: now,
      updatedAt: now,
    });

    await db.insert(executionEvents).values({
      id: createId(),
      workspaceId: actor.workspaceId,
      runId: workflowRunId,
      eventType: "workflow_started",
      actorType: "user",
      actorId: actor.userId,
      payload: {
        workflowKey,
        workflowDefinitionId: wfDef.id,
        ...metadata,
      },
      sequence: 1,
      createdAt: now,
    });

    return {
      workflowRunId,
      workflowDefinitionId: wfDef.id,
      taskAssignments,
    };
  }

  /**
   * Resolve workflow_definition_tasks from DB ordered by orderIndex, joining each task's
   * agent_definition to read config.role and config.promptTemplate (§7.4 generic dispatch).
   */
  private async resolveWorkflowTasksWithAgents(
    workspaceId: string,
    workflowDefinitionId: string,
  ): Promise<ResolvedWorkflowTask[]> {
    const rows = await db
      .select({
        taskKey: workflowDefinitionTasks.taskKey,
        orderIndex: workflowDefinitionTasks.orderIndex,
        agentDefinitionId: workflowDefinitionTasks.agentDefinitionId,
        agentConfig: agentDefinitions.config,
      })
      .from(workflowDefinitionTasks)
      .leftJoin(
        agentDefinitions,
        eq(workflowDefinitionTasks.agentDefinitionId, agentDefinitions.id),
      )
      .where(
        and(
          eq(workflowDefinitionTasks.workspaceId, workspaceId),
          eq(workflowDefinitionTasks.workflowDefinitionId, workflowDefinitionId),
        ),
      )
      .orderBy(asc(workflowDefinitionTasks.orderIndex), asc(workflowDefinitionTasks.createdAt));

    return rows.map((row) => {
      const config = row.agentConfig as Record<string, unknown> | null;
      return {
        taskKey: row.taskKey,
        orderIndex: row.orderIndex,
        agentDefinitionId: row.agentDefinitionId ?? null,
        agentRole: (config?.role as string) ?? null,
        agentPromptTemplate: (config?.promptTemplate as string) ?? null,
      };
    });
  }

  /**
   * Build agentMap from resolved tasks (§7.4).
   * Simply maps task.taskKey → task.agentDefinitionId for non-null agents.
   */
  private buildAgentMap(resolvedTasks: ResolvedWorkflowTask[]): Record<string, string> {
    const map: Record<string, string> = {};
    for (const task of resolvedTasks) {
      if (task.agentDefinitionId) {
        map[task.taskKey] = task.agentDefinitionId;
      }
    }
    return map;
  }

  /**
   * Resolve the correct workflow definition for the workspace type and ensure it exists.
   */
  private async ensureInitiativeGenerationWorkflowDefinition(
    actor: TodoActor,
  ): Promise<{ workflowDefinitionId: string; workflowKey: string; agentMap: Record<string, string>; resolvedTasks: ResolvedWorkflowTask[] }> {
    // Resolve workspace type to pick the correct workflow
    const [ws] = await db
      .select({ type: workspaces.type })
      .from(workspaces)
      .where(eq(workspaces.id, actor.workspaceId))
      .limit(1);
    const wsType = ws?.type ?? 'ai-ideas';
    const typeSeed = getWorkflowSeedsForType(wsType);
    const workflowSeed = typeSeed?.workflows[0] ?? DEFAULT_USE_CASE_GENERATION_WORKFLOW;

    const agentSeed = getAgentSeedsForType(wsType);
    const agentIds = agentSeed
      ? await this.seedAgentsForType(actor, agentSeed.agents)
      : await this.ensureDefaultGenerationAgents(actor);

    const workflowDefinitionId = await this.ensureWorkflowDefinition(
      actor,
      workflowSeed,
      agentIds,
    );

    // §7.4: resolve tasks from DB with agent definitions instead of hardcoded mapping
    const resolvedTasks = await this.resolveWorkflowTasksWithAgents(
      actor.workspaceId,
      workflowDefinitionId,
    );
    const agentMap = this.buildAgentMap(resolvedTasks);

    return { workflowDefinitionId, workflowKey: workflowSeed.key, agentMap, resolvedTasks };
  }

  async startInitiativeGenerationWorkflow(
    actor: TodoActor,
    input: StartInitiativeGenerationWorkflowInput,
  ): Promise<InitiativeGenerationWorkflowRuntime & { resolvedTasks: ResolvedWorkflowTask[] }> {
    const { workflowDefinitionId, workflowKey, agentMap, resolvedTasks } = await this.ensureInitiativeGenerationWorkflowDefinition(actor);

    // §7.4: resolve first agent from ordered tasks (typically the orchestrator)
    const firstAgent = resolvedTasks.length > 0 ? resolvedTasks[0] : null;

    const workflowRunId = createId();
    const now = new Date();
    await db.insert(executionRuns).values({
      id: workflowRunId,
      workspaceId: actor.workspaceId,
      planId: null,
      todoId: null,
      taskId: null,
      workflowDefinitionId,
      agentDefinitionId: firstAgent?.agentDefinitionId ?? null,
      mode: "full_auto",
      status: "in_progress",
      startedByUserId: actor.userId,
      startedAt: now,
      completedAt: null,
      metadata: normalizeMetadata({
        workflowKey,
        folderId: input.folderId,
        organizationId: input.organizationId ?? null,
        matrixMode: input.matrixMode,
        model: input.model,
        initiativeCount: input.initiativeCount,
        locale: input.locale,
        input: input.input,
        autoCreateOrganizations: input.autoCreateOrganizations ?? false,
        matrixSource: input.matrixSource ?? null,
        orgIds: input.orgIds ?? null,
      }),
      createdAt: now,
      updatedAt: now,
    });

    await db.insert(executionEvents).values({
      id: createId(),
      workspaceId: actor.workspaceId,
      runId: workflowRunId,
      eventType: "workflow_generation_started",
      actorType: "user",
      actorId: actor.userId,
      payload: {
        workflowKey,
        workflowDefinitionId,
        folderId: input.folderId,
        organizationId: input.organizationId ?? null,
        matrixMode: input.matrixMode,
        model: input.model,
        initiativeCount: input.initiativeCount,
        autoCreateOrganizations: input.autoCreateOrganizations ?? false,
        matrixSource: input.matrixSource ?? null,
      },
      sequence: 1,
      createdAt: now,
    });

    return {
      workflowRunId,
      workflowDefinitionId,
      agentMap,
      resolvedTasks,
    };
  }

  async startAndDispatchInitiativeGenerationWorkflow(
    actor: TodoActor,
    input: StartInitiativeGenerationWorkflowInput,
  ): Promise<StartInitiativeGenerationWorkflowDispatchResult> {
    const workflowRuntime = await this.startInitiativeGenerationWorkflow(actor, input);
    const { resolvedTasks } = workflowRuntime;

    // §7.4: dispatch queue jobs by iterating resolved tasks and matching agent config.role
    let matrixJobId: string | undefined;
    let jobId: string | undefined;

    for (const task of resolvedTasks) {
      switch (task.agentRole) {
        case "organization_batch": {
          // Organization batch creation is only dispatched when autoCreateOrganizations is true (B)
          if (input.autoCreateOrganizations) {
            await queueManager.addJob(
              "organization_batch_create",
              {
                folderId: input.folderId,
                input: input.input,
                model: input.model,
                initiatedByUserId: actor.userId,
                locale: input.locale,
                workflow: {
                  workflowRunId: workflowRuntime.workflowRunId,
                  workflowDefinitionId: workflowRuntime.workflowDefinitionId,
                  taskKey: task.taskKey as GenerationWorkflowTaskKey,
                  agentDefinitionId: task.agentDefinitionId,
                  agentMap: workflowRuntime.agentMap,
                },
              },
              { workspaceId: actor.workspaceId, maxRetries: 1 },
            );
          }
          break;
        }

        case "matrix_generation": {
          // Matrix generation dispatch (C): matrixSource=prompt or legacy matrixMode=generate
          const shouldGenerateMatrix =
            input.matrixSource === "prompt" ||
            (!input.matrixSource && input.matrixMode === "generate" && input.organizationId);
          if (shouldGenerateMatrix) {
            matrixJobId = await queueManager.addJob(
              "matrix_generate",
              {
                folderId: input.folderId,
                organizationId: input.organizationId,
                model: input.model,
                initiatedByUserId: actor.userId,
                locale: input.locale,
                workflow: {
                  workflowRunId: workflowRuntime.workflowRunId,
                  workflowDefinitionId: workflowRuntime.workflowDefinitionId,
                  taskKey: task.taskKey as GenerationWorkflowTaskKey,
                  agentDefinitionId: task.agentDefinitionId,
                  agentMap: workflowRuntime.agentMap,
                },
              },
              { workspaceId: actor.workspaceId, maxRetries: 1 },
            );
          }
          break;
        }

        case "usecase_list_generation":
        case "opportunity_list_generation": {
          // Initiative/opportunity list generation — the main entry point for the generation chain
          jobId = await queueManager.addJob(
            "initiative_list",
            {
              folderId: input.folderId,
              input: input.input,
              organizationId: input.organizationId,
              matrixMode: input.matrixMode,
              model: input.model,
              initiativeCount: input.initiativeCount,
              initiatedByUserId: actor.userId,
              locale: input.locale,
              orgIds: input.orgIds,
              workflow: {
                workflowRunId: workflowRuntime.workflowRunId,
                workflowDefinitionId: workflowRuntime.workflowDefinitionId,
                taskKey: task.taskKey as GenerationWorkflowTaskKey,
                agentDefinitionId: task.agentDefinitionId,
                agentMap: workflowRuntime.agentMap,
              },
            },
            { workspaceId: actor.workspaceId, maxRetries: 1 },
          );
          break;
        }

        // Other roles (orchestrator, todo_projection, detail, summary) are dispatched
        // downstream by the queue-manager chain, not at workflow start time.
        default:
          break;
      }
    }

    // Fallback: if no list generation task was found (should not happen with valid workflow),
    // enqueue with legacy task key to maintain backward compat
    if (!jobId) {
      jobId = await queueManager.addJob(
        "initiative_list",
        {
          folderId: input.folderId,
          input: input.input,
          organizationId: input.organizationId,
          matrixMode: input.matrixMode,
          model: input.model,
          initiativeCount: input.initiativeCount,
          initiatedByUserId: actor.userId,
          locale: input.locale,
          orgIds: input.orgIds,
          workflow: {
            workflowRunId: workflowRuntime.workflowRunId,
            workflowDefinitionId: workflowRuntime.workflowDefinitionId,
            taskKey: "generation_initiative_list",
            agentDefinitionId: workflowRuntime.agentMap["generation_initiative_list"] ?? null,
            agentMap: workflowRuntime.agentMap,
          },
        },
        { workspaceId: actor.workspaceId, maxRetries: 1 },
      );
    }

    return {
      workflowRunId: workflowRuntime.workflowRunId,
      workflowDefinitionId: workflowRuntime.workflowDefinitionId,
      agentMap: workflowRuntime.agentMap,
      jobId,
      matrixJobId,
    };
  }

  async getSessionTodoRuntime(actor: TodoActor, sessionId: string) {
    const todo = await this.getLatestSessionTodo(actor.workspaceId, sessionId);
    if (!todo) {
      return null;
    }

    const todoStatus = await this.deriveTodoStatus(actor.workspaceId, todo.id);
    const taskRows = await db
      .select()
      .from(tasks)
      .where(and(eq(tasks.workspaceId, actor.workspaceId), eq(tasks.todoId, todo.id)))
      .orderBy(asc(tasks.position), asc(tasks.createdAt));
    const activeRun = await this.getLatestTodoRun(actor.workspaceId, todo.id);

    return {
      status: todoStatus,
      todoId: todo.id,
      planId: todo.planId ?? null,
      todo: this.toTodoPayload(todo, todoStatus),
      tasks: taskRows.map((row) => mapTask(row)),
      taskCount: taskRows.length,
      activeRun: activeRun
        ? {
            id: activeRun.id,
            status: activeRun.status,
            taskId: activeRun.taskId ?? null,
          }
        : null,
      runId: activeRun?.id ?? null,
      runStatus: activeRun?.status ?? null,
      runTaskId: activeRun?.taskId ?? null,
    };
  }

  async createTodoFromChat(
    actor: TodoActor,
    input: {
      title: string;
      description?: string;
      planId?: string;
      planTitle?: string;
      tasks?: Array<{ title: string; description?: string }>;
      metadata?: Record<string, unknown>;
      sessionId?: string;
    },
  ) {
    if (input.sessionId) {
      const activeSessionTodo = await this.getActiveSessionTodo(actor.workspaceId, input.sessionId);
      if (activeSessionTodo) {
        const activeTodoStatus = await this.deriveTodoStatus(actor.workspaceId, activeSessionTodo.id);
        return {
          status: "conflict" as const,
          code: "active_todo_exists" as const,
          activeTodo: this.toTodoPayload(activeSessionTodo, activeTodoStatus),
        };
      }
    }

    let planId = input.planId ?? null;

    if (!planId && input.planTitle) {
      const plan = await this.createPlan(actor, {
        title: input.planTitle,
        description: "Created from chat tool orchestration",
      });
      planId = plan.id;
    }

    const todo = await this.createTodo(actor, {
      planId,
      title: input.title,
      description: input.description,
      metadata: input.metadata,
    });

    if (input.sessionId) {
      await this.linkTodoToSession(actor.workspaceId, input.sessionId, todo.id);
    }

    const createdTasks: Array<{ id: string; title: string }> = [];

    for (const taskDraft of input.tasks ?? []) {
      if (!taskDraft.title.trim()) {
        continue;
      }
      const taskResult = await this.createTask(actor, todo.id, {
        title: taskDraft.title,
        description: taskDraft.description,
      });
      createdTasks.push({ id: taskResult.task.id, title: taskResult.task.title });
    }

    return {
      status: "completed",
      planId,
      todoId: todo.id,
      taskCount: createdTasks.length,
      tasks: createdTasks,
    };
  }

  async updateTodoFromChat(
    actor: TodoActor,
    input: {
      todoId: string;
      title?: string;
      description?: string | null;
      ownerUserId?: string | null;
      status?: string;
      closed?: boolean;
      metadata?: Record<string, unknown>;
    },
  ) {
    const normalizedStatus = typeof input.status === "string" ? input.status.trim() : undefined;
    if (normalizedStatus !== undefined && !isTaskStatus(normalizedStatus)) {
      throw new TodoOrchestrationError(400, "Invalid todo status");
    }

    const closed =
      input.closed !== undefined
        ? input.closed
        : normalizedStatus !== undefined
          ? normalizedStatus === "done"
          : undefined;

    const todo = await this.patchTodo(actor, input.todoId, {
      title: input.title,
      description: input.description,
      ownerUserId: input.ownerUserId,
      metadata: input.metadata,
      closed,
    });

    return {
      status: "completed" as const,
      todo,
    };
  }

  async updateTaskFromChat(
    actor: TodoActor,
    input: {
      taskId: string;
      title?: string;
      description?: string | null;
      assigneeUserId?: string | null;
      status?: string;
      metadata?: Record<string, unknown>;
    },
  ) {
    const normalizedStatus = typeof input.status === "string" ? input.status.trim() : undefined;
    if (normalizedStatus !== undefined && !isTaskStatus(normalizedStatus)) {
      throw new TodoOrchestrationError(400, "Invalid task status");
    }

    let taskResult: Awaited<ReturnType<TodoOrchestrationService["patchTask"]>>;
    if (normalizedStatus !== undefined) {
      const bundle = await this.getTaskBundleOrThrow(input.taskId, actor.workspaceId);
      const currentStatus = bundle.task.status as TaskStatus;
      const targetStatus = normalizedStatus as TaskStatus;
      const path = computeTaskStatusPath(currentStatus, targetStatus);

      if (!path) {
        throw new TodoOrchestrationError(
          409,
          `Task status cannot transition from ${currentStatus} to ${targetStatus}`,
        );
      }

      if (path.length === 1) {
        taskResult = await this.patchTask(actor, input.taskId, {
          title: input.title,
          description: input.description,
          assigneeUserId: input.assigneeUserId,
          status: targetStatus,
          metadata: input.metadata,
        });
      } else {
        let isFirstStep = true;
        let rollingResult: Awaited<ReturnType<TodoOrchestrationService["patchTask"]>> | null = null;
        for (const stepStatus of path.slice(1)) {
          rollingResult = await this.patchTask(actor, input.taskId, {
            title: isFirstStep ? input.title : undefined,
            description: isFirstStep ? input.description : undefined,
            assigneeUserId: isFirstStep ? input.assigneeUserId : undefined,
            status: stepStatus,
            metadata: isFirstStep ? input.metadata : undefined,
          });
          isFirstStep = false;
        }
        if (!rollingResult) {
          throw new TodoOrchestrationError(500, "Task progression failed");
        }
        taskResult = rollingResult;
      }
    } else {
      taskResult = await this.patchTask(actor, input.taskId, {
        title: input.title,
        description: input.description,
        assigneeUserId: input.assigneeUserId,
        status: undefined,
        metadata: input.metadata,
      });
    }
    const [latestRun] = await db
      .select({
        id: executionRuns.id,
        status: executionRuns.status,
        taskId: executionRuns.taskId,
      })
      .from(executionRuns)
      .where(
        and(
          eq(executionRuns.workspaceId, actor.workspaceId),
          eq(executionRuns.taskId, taskResult.task.id),
        ),
      )
      .orderBy(desc(executionRuns.updatedAt), desc(executionRuns.startedAt), desc(executionRuns.createdAt))
      .limit(1);

    return {
      status: "completed" as const,
      task: taskResult.task,
      todoStatus: taskResult.todoStatus,
      planStatus: taskResult.planStatus,
      runId: latestRun?.id ?? null,
      runStatus: latestRun?.status ?? null,
      runTaskId: latestRun?.taskId ?? null,
    };
  }
}

export const todoOrchestrationService = new TodoOrchestrationService();
