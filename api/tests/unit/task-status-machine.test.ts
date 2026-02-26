import { describe, expect, it } from 'vitest';
import {
  appendExecutionEvent,
  assertTaskStatusTransition,
  canTransitionTaskStatus,
  deriveAggregateStatus,
  getNextExecutionEventSequence,
  listExecutionEventsForRun,
  type ExecutionEventRecord,
  type TaskStatus,
} from '../../src/services/todo-runtime';

describe('task status machine', () => {
  it('allows only declared transitions and same-status idempotency', () => {
    const allStatuses: TaskStatus[] = [
      'todo',
      'planned',
      'in_progress',
      'blocked',
      'done',
      'deferred',
      'cancelled',
    ];

    expect(canTransitionTaskStatus('todo', 'planned')).toBe(true);
    expect(canTransitionTaskStatus('planned', 'in_progress')).toBe(true);
    expect(canTransitionTaskStatus('in_progress', 'done')).toBe(true);
    expect(canTransitionTaskStatus('blocked', 'planned')).toBe(true);
    expect(canTransitionTaskStatus('deferred', 'planned')).toBe(true);

    for (const status of allStatuses) {
      expect(canTransitionTaskStatus(status, status)).toBe(true);
    }

    expect(canTransitionTaskStatus('done', 'planned')).toBe(false);
    expect(canTransitionTaskStatus('cancelled', 'planned')).toBe(false);
    expect(canTransitionTaskStatus('todo', 'done')).toBe(false);
  });

  it('throws on invalid transition', () => {
    expect(() => assertTaskStatusTransition('todo', 'done')).toThrow(
      'Invalid task status transition: todo -> done',
    );
  });

  it('derives aggregate status from task status set', () => {
    expect(deriveAggregateStatus([])).toBe('todo');
    expect(deriveAggregateStatus(['done', 'done'])).toBe('done');
    expect(deriveAggregateStatus(['cancelled', 'cancelled'])).toBe('cancelled');
    expect(deriveAggregateStatus(['planned', 'deferred'])).toBe('planned');
    expect(deriveAggregateStatus(['blocked', 'done'])).toBe('blocked');
    expect(deriveAggregateStatus(['in_progress', 'planned'])).toBe('in_progress');
    expect(deriveAggregateStatus(['deferred', 'deferred'])).toBe('deferred');
    expect(deriveAggregateStatus(['done', 'cancelled'])).toBe('done');
  });
});

describe('execution event sequencing', () => {
  it('increments sequence per run and keeps deterministic ordering', () => {
    const existing: ExecutionEventRecord[] = [
      {
        runId: 'run-A',
        eventType: 'status_change',
        payload: {},
        sequence: 2,
        createdAt: '2026-02-26T10:00:00.000Z',
      },
      {
        runId: 'run-B',
        eventType: 'status_change',
        payload: {},
        sequence: 1,
        createdAt: '2026-02-26T10:00:00.000Z',
      },
      {
        runId: 'run-A',
        eventType: 'steer',
        payload: {},
        sequence: 1,
        createdAt: '2026-02-26T09:59:00.000Z',
      },
    ];

    expect(getNextExecutionEventSequence(existing, 'run-A')).toBe(3);
    expect(getNextExecutionEventSequence(existing, 'run-B')).toBe(2);
    expect(getNextExecutionEventSequence(existing, 'run-C')).toBe(1);

    const appended = appendExecutionEvent(existing, {
      runId: 'run-A',
      eventType: 'steer',
      payload: { message: 'prioritize task-2' },
    });

    expect(appended.sequence).toBe(3);

    const ordered = listExecutionEventsForRun([...existing, appended], 'run-A');
    expect(ordered.map((event) => event.sequence)).toEqual([1, 2, 3]);
  });
});
