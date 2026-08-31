import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '../../src/db/client';
import {
  agentDefinitions,
  executionEvents,
  executionRuns,
  plans,
  tasks,
  todos,
  users,
  workspaceMemberships,
  workspaces,
} from '../../src/db/schema';
import { createId } from '../../src/utils/id';
import { ensureWorkspaceForUser } from '../../src/services/workspace-service';
import { todoOrchestrationService } from '../../src/services/todo-orchestration';
import { PostgresAgentTemplate } from '../../src/services/flow/postgres-agent-template';

describe('TodoOrchestrationService chat progression', () => {
  let userId: string;
  let workspaceId: string;

  beforeEach(async () => {
    userId = createId();
    await db.insert(users).values({
      id: userId,
      email: `todo-progression-${userId}@example.com`,
      displayName: 'TODO Progression Tester',
      role: 'editor',
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    ({ workspaceId } = await ensureWorkspaceForUser(userId));
  });

  afterEach(async () => {
    await db.delete(executionEvents).where(eq(executionEvents.workspaceId, workspaceId));
    await db.delete(executionRuns).where(eq(executionRuns.workspaceId, workspaceId));
    await db.delete(tasks).where(eq(tasks.workspaceId, workspaceId));
    await db.delete(todos).where(eq(todos.workspaceId, workspaceId));
    await db.delete(plans).where(eq(plans.workspaceId, workspaceId));
    await db.delete(agentDefinitions).where(eq(agentDefinitions.workspaceId, workspaceId));
    await db.delete(workspaceMemberships).where(eq(workspaceMemberships.workspaceId, workspaceId));
    await db.delete(workspaces).where(eq(workspaces.ownerUserId, userId));
    await db.delete(users).where(eq(users.id, userId));
  });

  it('reuses the canonical agent definition table through the Flow port', async () => {
    const actor = { userId, role: 'editor', workspaceId };
    const port = new PostgresAgentTemplate();

    await port.upsertMany(actor, [{
      key: 'chat-progression-agent',
      name: 'Chat progression agent',
      config: { model: 'gpt-4.1-nano' },
      sourceLevel: 'user',
    }]);

    const listed = await port.list(actor);
    expect(listed).toEqual([
      expect.objectContaining({ key: 'chat-progression-agent', sourceLevel: 'user' }),
    ]);
    const [stored] = await db
      .select({ config: agentDefinitions.config })
      .from(agentDefinitions)
      .where(eq(agentDefinitions.workspaceId, workspaceId));
    expect(stored?.config).toEqual({ model: 'gpt-4.1-nano' });
  });

  it('progresses deferred tasks to done in one chat update call', async () => {
    const actor = { userId, role: 'editor', workspaceId };
    const plan = await todoOrchestrationService.createPlan(actor, { title: 'Chat progression plan' });
    const todo = await todoOrchestrationService.createTodo(actor, {
      planId: plan.id,
      title: 'Chat progression todo',
    });
    const taskResult = await todoOrchestrationService.createTask(actor, todo.id, {
      title: 'Deferred task to complete',
      status: 'deferred',
    });

    const update = await todoOrchestrationService.updateTaskFromChat(actor, {
      taskId: taskResult.task.id,
      status: 'done',
    });

    expect(update.task.status).toBe('done');
    expect(update.todoStatus).toBe('done');
    const [storedTask] = await db
      .select({ status: tasks.status, startedAt: tasks.startedAt, completedAt: tasks.completedAt })
      .from(tasks)
      .where(eq(tasks.id, taskResult.task.id))
      .limit(1);
    expect(storedTask?.status).toBe('done');
    expect(storedTask?.startedAt).toBeTruthy();
    expect(storedTask?.completedAt).toBeTruthy();
  });

  it('returns active_todo_exists conflict without user-facing message', async () => {
    const actor = { userId, role: 'editor', workspaceId };
    const sessionId = `session-${createId()}`;

    const first = await todoOrchestrationService.createTodoFromChat(actor, {
      title: 'First TODO',
      sessionId,
      tasks: [{ title: 'First task' }],
    });
    expect(first.status).toBe('completed');

    const second = await todoOrchestrationService.createTodoFromChat(actor, {
      title: 'Second TODO',
      sessionId,
      tasks: [{ title: 'Second task' }],
    });

    expect(second.status).toBe('conflict');
    expect(second.code).toBe('active_todo_exists');
    expect('message' in second).toBe(false);
    expect(second.activeTodo).toBeDefined();
  });
});
