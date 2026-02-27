import { and, asc, desc, eq, inArray, or, sql } from "drizzle-orm";
import { db } from "../db/client";
import {
  agentDefinitions,
  executionEvents,
  executionRuns,
  guardrails,
  plans,
  tasks,
  todos,
  workflowDefinitionTasks,
  workflowDefinitions,
  workspaceMemberships,
} from "../db/schema";
import { createId } from "../utils/id";
import {
  assertTaskStatusTransition,
  canPerformTodoAction,
  classifyGuardrailDecision,
  deriveAggregateStatus,
  isTaskStatus,
  type GuardrailCategory,
  type TaskStatus,
} from "./todo-runtime";

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
const RUN_TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled"]);
const RUN_RESUMABLE_STATUSES = new Set(["paused", "blocked"]);
const GUARDRAIL_CATEGORIES = new Set<GuardrailCategory>(["scope", "quality", "safety", "approval"]);

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

  async steerRun(actor: TodoActor, runId: string, input: { message: string; metadata?: Record<string, unknown> }) {
    const run = await this.getRunOrThrow(runId, actor.workspaceId);
    if (RUN_TERMINAL_STATUSES.has(run.status)) {
      throw new TodoOrchestrationError(409, "Run is already completed");
    }

    const payload = {
      message: input.message,
      metadata: normalizeMetadata(input.metadata),
    };

    await this.appendExecutionEvent(db, {
      runId: run.id,
      workspaceId: run.workspaceId,
      eventType: "steer",
      actorType: "user",
      actorId: actor.userId,
      payload,
    });

    return {
      runId: run.id,
      status: run.status,
      steer: payload,
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

  async createTodoFromChat(
    actor: TodoActor,
    input: {
      title: string;
      description?: string;
      planId?: string;
      planTitle?: string;
      tasks?: Array<{ title: string; description?: string }>;
      metadata?: Record<string, unknown>;
    },
  ) {
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
}

export const todoOrchestrationService = new TodoOrchestrationService();
