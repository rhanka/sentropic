import { describe, expect, it } from 'vitest';
import { canPerformTodoAction, type TodoPermissionContext } from '../../src/services/todo-runtime';

function ctx(overrides: Partial<TodoPermissionContext> = {}): TodoPermissionContext {
  return {
    actorUserId: 'actor-user',
    todoCreatorUserId: 'todo-creator',
    todoOwnerUserId: 'todo-owner',
    taskAssigneeUserId: 'task-assignee',
    isAdmin: false,
    ...overrides,
  };
}

describe('todo ownership and assignment permissions', () => {
  it('allows creator and owner to edit/reassign TODO', () => {
    expect(canPerformTodoAction('todo_edit', ctx({ actorUserId: 'todo-creator' }))).toBe(true);
    expect(canPerformTodoAction('todo_reassign', ctx({ actorUserId: 'todo-creator' }))).toBe(true);

    expect(canPerformTodoAction('todo_edit', ctx({ actorUserId: 'todo-owner' }))).toBe(true);
    expect(canPerformTodoAction('todo_reassign', ctx({ actorUserId: 'todo-owner' }))).toBe(true);
  });

  it('allows TODO close to current owner only (admin override excluded)', () => {
    expect(canPerformTodoAction('todo_close', ctx({ actorUserId: 'todo-owner' }))).toBe(true);
    expect(canPerformTodoAction('todo_close', ctx({ actorUserId: 'todo-creator' }))).toBe(false);
    expect(canPerformTodoAction('todo_close', ctx({ actorUserId: 'task-assignee' }))).toBe(false);
  });

  it('allows assignee to update only assigned task and disallows task reassignment', () => {
    expect(canPerformTodoAction('task_update', ctx({ actorUserId: 'task-assignee' }))).toBe(true);
    expect(canPerformTodoAction('task_reassign', ctx({ actorUserId: 'task-assignee' }))).toBe(false);
  });

  it('allows admin override for all actions', () => {
    const adminContext = ctx({ actorUserId: 'random-user', isAdmin: true });
    expect(canPerformTodoAction('todo_edit', adminContext)).toBe(true);
    expect(canPerformTodoAction('todo_reassign', adminContext)).toBe(true);
    expect(canPerformTodoAction('todo_close', adminContext)).toBe(true);
    expect(canPerformTodoAction('task_update', adminContext)).toBe(true);
    expect(canPerformTodoAction('task_reassign', adminContext)).toBe(true);
  });

  it('denies non-creator/non-owner/non-assignee actor', () => {
    const other = ctx({ actorUserId: 'other-user' });
    expect(canPerformTodoAction('todo_edit', other)).toBe(false);
    expect(canPerformTodoAction('todo_reassign', other)).toBe(false);
    expect(canPerformTodoAction('todo_close', other)).toBe(false);
    expect(canPerformTodoAction('task_update', other)).toBe(false);
    expect(canPerformTodoAction('task_reassign', other)).toBe(false);
  });
});
