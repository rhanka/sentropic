import { describe, expect, it, vi } from 'vitest';
import {
  isTodoRuntimeRunSteerable,
  normalizeTodoRuntimeRunState,
  postTodoRuntimeSteer,
  type TodoRuntimeRunState,
} from '../../src/lib/utils/todo-runtime-steer';

describe('todo runtime steer utils', () => {
  it('extracts active run state from runtime payload', () => {
    const run = normalizeTodoRuntimeRunState({
      activeRun: {
        id: 'run_1',
        status: 'in_progress',
        taskId: 'task_1',
      },
    });

    expect(run).toEqual({
      runId: 'run_1',
      runStatus: 'in_progress',
      runTaskId: 'task_1',
    });
  });

  it('keeps previous run state when runtime update has no run metadata', () => {
    const previous: TodoRuntimeRunState = {
      runId: 'run_prev',
      runStatus: 'paused',
      runTaskId: 'task_prev',
    };

    const run = normalizeTodoRuntimeRunState(
      {
        todoId: 'todo_1',
      },
      previous,
    );

    expect(run).toEqual(previous);
    expect(isTodoRuntimeRunSteerable(run)).toBe(true);
  });

  it('posts steer payload to run endpoint and normalizes feedback', async () => {
    const apiPost = vi.fn(async () => ({
      runId: 'run_2',
      status: 'in_progress',
      steer: {
        message: 'Refocus on acceptance criteria',
      },
    }));

    const feedback = await postTodoRuntimeSteer(
      apiPost,
      'run_2',
      'Refocus on acceptance criteria',
    );

    expect(apiPost).toHaveBeenCalledTimes(1);
    expect(apiPost).toHaveBeenCalledWith('/runs/run_2/steer', {
      message: 'Refocus on acceptance criteria',
    });
    expect(feedback.runId).toBe('run_2');
    expect(feedback.status).toBe('in_progress');
    expect(feedback.message).toBe('Refocus on acceptance criteria');
  });
});
