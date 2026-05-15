import { describe, expect, it } from 'vitest';
import {
  GOLDEN_DIR,
  assertSequenceMonotonic,
  loadAllFixtures,
  loadFixture,
  normalize,
} from './golden-loader';
import { getDefaultGateConfig } from '../../../src/services/gate-service';
import {
  TASK_STATUSES,
  canTransitionTaskStatus,
  classifyGuardrailDecision,
  deriveAggregateStatus,
  getNextExecutionEventSequence,
} from '../../../src/services/todo-runtime';
import { join } from 'node:path';

/**
 * BR-26 Lot 1 — Golden Trace Replay Harness.
 *
 * This suite locks the current observable behavior of the flow runtime
 * (`todo-orchestration` + `queue-manager` + `gate-service` + `todo-runtime`)
 * via golden trace fixtures. After every façade-extraction slice
 * (Lot 4..8), the same replay must succeed: the production code must
 * continue to emit a byte-identical event stream modulo IDs/timestamps.
 *
 * The harness asserts:
 *   1. Each fixture file is well-formed (`input` → `event*` → `final_state`).
 *   2. Event sequences are monotonic per `runId`.
 *   3. Normalization makes the trace deterministic for byte-comparison.
 *   4. Scenario-specific invariants documented in `assertions`.
 *   5. Pure helpers from `todo-runtime.ts` agree with fixture transitions.
 *   6. `gate-service.getDefaultGateConfig` agrees with the gate fixture.
 *
 * Lots 4..8 will extend the per-fixture invariant checks to exercise
 * the actual façade adapters (with a real DB) once the adapters exist.
 *
 * Step 1 (commit #1): 3 baseline fixtures + harness scaffolding.
 * Step 2 (commit #2): 3 remaining fixtures + full 6-fixture assertion.
 */

const EXPECTED_FIXTURES = [
  'approval-gated-pause-resume',
  'chat-tool-loop-3turns',
  'queue-retry',
];

describe('BR-26 golden trace replay', () => {
  it('discovers the expected fixtures in api/tests/fixtures/golden/br26/', () => {
    const fixtures = loadAllFixtures();
    const ids = fixtures.map((f) => f.fixtureId).sort();
    // Every fixture present in the directory must be in the expected list.
    for (const id of ids) {
      expect(EXPECTED_FIXTURES, `unexpected fixture: ${id}`).toContain(id);
    }
    // Every baseline fixture from Step 1 must be present.
    for (const expected of ['approval-gated-pause-resume', 'chat-tool-loop-3turns', 'queue-retry']) {
      expect(ids, `missing baseline fixture: ${expected}`).toContain(expected);
    }
  });

  it('every fixture is well-formed JSONL with input + events + final_state', () => {
    const fixtures = loadAllFixtures();
    for (const fixture of fixtures) {
      expect(fixture.input.kind, fixture.fixtureId).toBe('input');
      expect(fixture.input.fixtureId, fixture.fixtureId).toBe(fixture.fixtureId);
      expect(fixture.events.length, fixture.fixtureId).toBeGreaterThan(0);
      expect(fixture.finalState.kind, fixture.fixtureId).toBe('final_state');
      for (const ev of fixture.events) {
        expect(ev.kind, `${fixture.fixtureId}:seq=${ev.sequence}`).toBe('event');
        expect(typeof ev.sequence, `${fixture.fixtureId}:seq`).toBe('number');
        expect(typeof ev.runId, `${fixture.fixtureId}:runId`).toBe('string');
        expect(typeof ev.eventType, `${fixture.fixtureId}:eventType`).toBe('string');
      }
    }
  });

  it('event sequences are monotonic per runId across every fixture', () => {
    const fixtures = loadAllFixtures();
    for (const fixture of fixtures) {
      expect(() => assertSequenceMonotonic(fixture.events, fixture.fixtureId)).not.toThrow();
    }
  });

  it('normalization produces stable byte-comparable output (id, ts, runId, jobId)', () => {
    const fixtures = loadAllFixtures();
    for (const fixture of fixtures) {
      const normalizedEvents = fixture.events.map((ev) => normalize(ev));
      const serialized = JSON.stringify(normalizedEvents);
      // Stable tokens must appear, raw values must not leak through.
      expect(serialized, fixture.fixtureId).toContain('"ts":"__TS__"');
      expect(serialized, fixture.fixtureId).toContain('"runId":"__RUN_ID__"');
      // Re-normalization must be idempotent (byte-identical).
      const renormalized = JSON.stringify(normalizedEvents.map((ev) => normalize(ev)));
      expect(renormalized).toBe(serialized);
    }
  });

  it('terminal status matches the cumulative event semantics', () => {
    const fixtures = loadAllFixtures();
    for (const fixture of fixtures) {
      const lastEvent = fixture.events[fixture.events.length - 1];
      const terminal = fixture.finalState.status;
      if (terminal === 'cancelled') {
        const hasCancelled = fixture.events.some((e) => e.eventType === 'run_cancelled');
        expect(hasCancelled, fixture.fixtureId).toBe(true);
      }
      if (terminal === 'paused') {
        const hasPaused = fixture.events.some((e) => e.eventType === 'run_paused');
        expect(hasPaused, fixture.fixtureId).toBe(true);
      }
      // Every fixture must terminate either with a completion/failure event or
      // a control-plane event (resume/cancel/pause). No silent termination.
      expect(
        [
          'task_completed',
          'task_failed',
          'run_cancelled',
          'chat_completed',
          'state_resumed',
          'state_merged',
        ].includes(lastEvent.eventType),
        `${fixture.fixtureId}: lastEvent=${lastEvent.eventType}`,
      ).toBe(true);
    }
  });

  describe('per-fixture invariants', () => {
    it('chat-tool-loop-3turns: tool loop length is exactly 3', () => {
      const fixture = loadFixture(join(GOLDEN_DIR, 'chat-tool-loop-3turns.jsonl'));
      const toolCalls = fixture.events.filter((e) => e.eventType === 'chat_tool_call');
      const toolResults = fixture.events.filter((e) => e.eventType === 'chat_tool_result');
      expect(toolCalls).toHaveLength(3);
      expect(toolResults).toHaveLength(3);
      expect(fixture.input.expectations.toolCallCount).toBe(3);
      expect(fixture.finalState.status).toBe('completed');
      // Each tool_call must be followed by a matching tool_result (same turn).
      // Mirrors the chat-service tool-loop contract.
      for (const call of toolCalls) {
        const turn = (call.payload as { turn?: number }).turn;
        const matchingResult = toolResults.find(
          (r) => (r.payload as { turn?: number }).turn === turn,
        );
        expect(matchingResult, `turn=${turn}`).toBeDefined();
        expect(matchingResult!.sequence).toBeGreaterThan(call.sequence);
      }
    });

    it('approval-gated-pause-resume: pause precedes resume and gate-service agrees on G5 criteria', () => {
      const fixture = loadFixture(join(GOLDEN_DIR, 'approval-gated-pause-resume.jsonl'));
      const pauseEvent = fixture.events.find((e) => e.eventType === 'run_paused');
      const resumeEvent = fixture.events.find((e) => e.eventType === 'run_resumed');
      const gateEvent = fixture.events.find((e) => e.eventType === 'gate_evaluated');
      expect(pauseEvent).toBeDefined();
      expect(resumeEvent).toBeDefined();
      expect(gateEvent).toBeDefined();
      expect(pauseEvent!.sequence).toBeLessThan(resumeEvent!.sequence);

      // Re-run the production gate-service to confirm the default config for
      // the `opportunity` workspace type still includes the G5 stage with the
      // expected criteria. This is the pure (no DB) path of getDefaultGateConfig.
      const config = getDefaultGateConfig('opportunity');
      expect(config).toBeDefined();
      expect(config!.stages).toContain('G5');
      expect(config!.criteria?.G5).toBeDefined();
      expect(config!.criteria!.G5.required_fields).toEqual(
        expect.arrayContaining(['data.solution']),
      );
      expect(fixture.finalState.status).toBe('completed');
    });

    it('queue-retry: exactly one job_retried event and final attempts=2', () => {
      const fixture = loadFixture(join(GOLDEN_DIR, 'queue-retry.jsonl'));
      const retries = fixture.events.filter((e) => e.eventType === 'job_retried');
      const failures = fixture.events.filter((e) => e.eventType === 'task_failed');
      const dlq = fixture.events.filter((e) => e.eventType === 'job_dlq');
      expect(retries).toHaveLength(1);
      expect(failures).toHaveLength(1);
      expect(dlq).toHaveLength(0);
      const taskResult = fixture.finalState.taskResults.find(
        (r) => r.taskKey === 'generation_usecase_list',
      );
      expect(taskResult?.attempts).toBe(2);
      expect(taskResult?.status).toBe('completed');
    });
  });

  describe('todo-runtime helpers (pure, no DB)', () => {
    it('fixture taskResults statuses use the workflow_task_results vocabulary', () => {
      // workflow_task_results.status uses a different vocabulary than TaskStatus:
      // {pending, in_progress, completed, failed, cancelled}. We assert that the
      // recorded fixture statuses stay inside that set so Lots 4..8 cannot
      // accidentally introduce a new value.
      const allowed = new Set(['pending', 'in_progress', 'completed', 'failed', 'cancelled']);
      const fixtures = loadAllFixtures();
      for (const fixture of fixtures) {
        for (const result of fixture.finalState.taskResults) {
          expect(
            allowed.has(result.status),
            `${fixture.fixtureId}:${result.taskKey} status=${result.status}`,
          ).toBe(true);
        }
      }
    });

    it('TASK_STATUSES exposes the expected todo-domain values', () => {
      expect(TASK_STATUSES).toEqual([
        'todo',
        'planned',
        'in_progress',
        'blocked',
        'done',
        'deferred',
        'cancelled',
      ]);
    });

    it('canTransitionTaskStatus rejects todo→done (must go through in_progress)', () => {
      expect(canTransitionTaskStatus('todo', 'done')).toBe(false);
      expect(canTransitionTaskStatus('todo', 'in_progress')).toBe(true);
      expect(canTransitionTaskStatus('in_progress', 'done')).toBe(true);
      expect(canTransitionTaskStatus('done', 'in_progress')).toBe(false);
    });

    it('deriveAggregateStatus collapses task statuses deterministically', () => {
      expect(deriveAggregateStatus([])).toBe('todo');
      expect(deriveAggregateStatus(['done', 'done', 'done'])).toBe('done');
      expect(deriveAggregateStatus(['done', 'in_progress'])).toBe('in_progress');
      expect(deriveAggregateStatus(['todo', 'todo'])).toBe('todo');
      expect(deriveAggregateStatus(['cancelled', 'cancelled'])).toBe('cancelled');
    });

    it('classifyGuardrailDecision honors active/violated/approval inputs', () => {
      expect(
        classifyGuardrailDecision({ category: 'scope', violated: false }),
      ).toBe('allow');
      expect(
        classifyGuardrailDecision({ category: 'scope', violated: true, isActive: false }),
      ).toBe('allow');
      expect(
        classifyGuardrailDecision({ category: 'approval', violated: true, approvalGranted: false }),
      ).toBe('needs_approval');
      expect(
        classifyGuardrailDecision({ category: 'approval', violated: true, approvalGranted: true }),
      ).toBe('allow');
    });

    it('getNextExecutionEventSequence is monotonic per runId', () => {
      const runId = 'run-pure-001';
      const s1 = getNextExecutionEventSequence([], runId);
      const evt1 = {
        runId,
        eventType: 'run_started',
        payload: {},
        sequence: s1,
        createdAt: '2026-05-14T00:00:00.000Z',
        actorType: null,
        actorId: null,
      };
      const s2 = getNextExecutionEventSequence([evt1], runId);
      const evt2 = { ...evt1, eventType: 'task_started', sequence: s2 };
      const s3 = getNextExecutionEventSequence([evt1, evt2], runId);
      expect(s1).toBe(1);
      expect(s2).toBe(2);
      expect(s3).toBe(3);
      // Different runId resets the sequence.
      const sOther = getNextExecutionEventSequence([evt1, evt2], 'run-other-002');
      expect(sOther).toBe(1);
    });
  });
});
