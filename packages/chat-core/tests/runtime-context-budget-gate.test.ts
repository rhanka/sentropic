/**
 * BR14b Lot 21e-1 — `ChatRuntime.applyContextBudgetGate` unit tests.
 *
 * Exercises the verbatim port of the inline pre-tool context-budget
 * gate previously hosted in
 * `ChatService.runAssistantGeneration` (chat-service.ts lines 3534-3636
 * post-Lot 21d-3). The tests cover every branch of the gate:
 *
 *   1. Happy path — projected zone stays `normal`: no events emitted,
 *      `shouldContinue` is `false`, `contextBudgetReplanAttempts` is
 *      reset to 0, `preToolBudget` returned unchanged.
 *   2. Soft zone (first attempt) — projected zone is `soft`, replan
 *      counter increments to 1 (≤ max), a single `tool_call_result`
 *      event with `escalation_required: false` is appended.
 *   3. Hard zone with successful compaction — compaction lowers the
 *      snapshot to normal, gate passes, replan counter resets.
 *   4. Hard zone with failed compaction — compaction returns the same
 *      snapshot, gate still fires the deferred branch.
 *   5. Hard zone repeated → escalation — second hard attempt exceeds
 *      `maxReplanAttempts=1`, escalation event also appended.
 *   6. StreamSeq advancement — caller-supplied cursor advances by 2 on
 *      escalation, by 1 on plain deferred, by 0 on happy path.
 *   7. Deferred-accumulator payload — caller receives the three rows
 *      (toolResults / responseToolOutputs / executedTools) verbatim.
 *   8. Soft-zone error code — uses the api-side `softZoneCode` string.
 *   9. Hard-zone error code — uses the api-side `hardZoneCode` string.
 *  10. Toolname fallback — when `toolCall.name` is empty, the
 *      `deferredAccumulator.toolName` falls back to `unknown_tool`
 *      (mirrors the inline `toolCall.name || 'unknown_tool'`).
 */
import { describe, expect, it, vi } from 'vitest';

import { ChatRuntime } from '../src/runtime.js';
import type {
  ApplyContextBudgetGateInput,
  ChatRuntimeDeps,
} from '../src/runtime.js';
import type {
  ContextBudgetSnapshot,
  ContextBudgetZone,
} from '../src/context-budget.js';
import type { ChatState } from '../src/types.js';
import {
  InMemoryCheckpointStore,
  InMemoryMessageStore,
  InMemoryMeshDispatch,
  InMemorySessionStore,
  InMemoryStreamBuffer,
  InMemoryStreamSequencer,
} from '../src/in-memory/index.js';

// Mirrors the api-side `resolveBudgetZone` with thresholds 80% / 95%
// (matches `CONTEXT_BUDGET_SOFT_THRESHOLD` / `CONTEXT_BUDGET_HARD_THRESHOLD`
// at chat-service.ts line ~290 pre-Lot 21e-1).
const TEST_SOFT_THRESHOLD = 80;
const TEST_HARD_THRESHOLD = 95;

const testResolveBudgetZone = (occupancyPct: number): ContextBudgetZone => {
  if (occupancyPct >= TEST_HARD_THRESHOLD) return 'hard';
  if (occupancyPct >= TEST_SOFT_THRESHOLD) return 'soft';
  return 'normal';
};

const testEstimateTokenCountFromChars = (charCount: number): number =>
  Math.max(1, Math.ceil(charCount / 4));

const buildFixture = () => {
  const messageStore = new InMemoryMessageStore();
  const sessionStore = new InMemorySessionStore();
  const streamBuffer = new InMemoryStreamBuffer();
  const streamSequencer = new InMemoryStreamSequencer();
  const checkpointStore = new InMemoryCheckpointStore<ChatState>();
  const mesh = new InMemoryMeshDispatch();
  const deps: ChatRuntimeDeps = {
    messageStore,
    sessionStore,
    streamBuffer,
    streamSequencer,
    checkpointStore,
    mesh,
    normalizeVsCodeCodeAgent: () => null,
    resolveModelSelection: async () => ({
      provider_id: 'openai',
      model_id: 'gpt-test',
    }),
    normalizeMessageContexts: () => [],
    isChatContextType: () => false,
    resolveSessionWorkspaceId: async () => null,
    listSessionDocuments: async () => [],
    listAssistantDetailsByMessageId: async () => ({}),
    resolveWorkspaceAccess: async () => ({
      readOnly: false,
      canWrite: true,
      currentUserRole: 'editor',
    }),
  };
  return {
    runtime: new ChatRuntime(deps),
    streamBuffer,
    streamSequencer,
  };
};

const buildSnapshot = (
  occupancyPct: number,
  maxTokens = 100_000,
): ContextBudgetSnapshot => ({
  estimatedTokens: Math.round((occupancyPct / 100) * maxTokens),
  maxTokens,
  occupancyPct,
  zone: testResolveBudgetZone(occupancyPct),
});

const buildInput = (
  overrides: Partial<ApplyContextBudgetGateInput> = {},
): ApplyContextBudgetGateInput => ({
  streamId: 'msg-assistant-1',
  toolCall: { id: 'tc-1', name: 'web_search' },
  args: { query: 'hello' },
  preToolBudget: buildSnapshot(40),
  projectedResultChars: 8_000,
  streamSeq: 10,
  contextBudgetReplanAttempts: 0,
  maxReplanAttempts: 1,
  softZoneCode: 'context_budget_risk',
  hardZoneCode: 'context_budget_blocked',
  resolveBudgetZone: testResolveBudgetZone,
  estimateTokenCountFromChars: testEstimateTokenCountFromChars,
  compactContextIfNeeded: async (_reason, snapshot) => snapshot,
  ...overrides,
});

describe('ChatRuntime.applyContextBudgetGate (Lot 21e-1)', () => {
  it('happy path: returns shouldContinue=false and emits no events when projected zone is normal', async () => {
    const { runtime, streamBuffer } = buildFixture();
    const result = await runtime.applyContextBudgetGate(
      buildInput({
        preToolBudget: buildSnapshot(40),
        projectedResultChars: 1_000,
      }),
    );
    expect(result.shouldContinue).toBe(false);
    expect(result.deferredAccumulator).toBeUndefined();
    expect(result.contextBudgetReplanAttempts).toBe(0);
    expect(result.streamSeq).toBe(10);
    expect(streamBuffer.snapshot('msg-assistant-1')).toHaveLength(0);
  });

  it('happy path: resets contextBudgetReplanAttempts to 0 even when caller passed a non-zero counter', async () => {
    const { runtime } = buildFixture();
    const result = await runtime.applyContextBudgetGate(
      buildInput({
        preToolBudget: buildSnapshot(30),
        projectedResultChars: 500,
        contextBudgetReplanAttempts: 1,
      }),
    );
    expect(result.shouldContinue).toBe(false);
    expect(result.contextBudgetReplanAttempts).toBe(0);
  });

  it('soft zone: emits a single tool_call_result event with escalation_required=false on first attempt', async () => {
    const { runtime, streamBuffer } = buildFixture();
    // 78% snapshot + projected payload pushing past 80% but below 95%
    const result = await runtime.applyContextBudgetGate(
      buildInput({
        preToolBudget: buildSnapshot(78),
        projectedResultChars: 8_000,
        contextBudgetReplanAttempts: 0,
      }),
    );
    expect(result.shouldContinue).toBe(true);
    expect(result.contextBudgetReplanAttempts).toBe(1);
    // Sequencer allocates 1 → runtime returns seq+1 = 2. Same
    // convention as `consumeToolCalls` (Lot 21c) and
    // `writeContextBudgetStatus` (Lot 21a) — the caller re-syncs its
    // local `streamSeq` from this returned value; the input
    // `streamSeq: 10` is informational.
    expect(result.streamSeq).toBe(2);
    const events = streamBuffer.snapshot('msg-assistant-1');
    expect(events).toHaveLength(1);
    expect(events[0].eventType).toBe('tool_call_result');
    const payload = events[0].data as {
      tool_call_id: string;
      result: { code: string; escalation_required: boolean; status: string };
    };
    expect(payload.tool_call_id).toBe('tc-1');
    expect(payload.result.status).toBe('deferred');
    expect(payload.result.escalation_required).toBe(false);
    expect(payload.result.code).toBe('context_budget_risk');
  });

  it('soft zone: returns deferredAccumulator with all three accumulator rows for caller to push', async () => {
    const { runtime } = buildFixture();
    const result = await runtime.applyContextBudgetGate(
      buildInput({
        preToolBudget: buildSnapshot(78),
        projectedResultChars: 8_000,
        toolCall: { id: 'tc-42', name: 'documents' },
        args: { action: 'get_content', docId: 'd1' },
      }),
    );
    expect(result.shouldContinue).toBe(true);
    expect(result.deferredAccumulator).toBeDefined();
    expect(result.deferredAccumulator!.toolCallId).toBe('tc-42');
    expect(result.deferredAccumulator!.toolName).toBe('documents');
    expect(result.deferredAccumulator!.args).toEqual({
      action: 'get_content',
      docId: 'd1',
    });
    expect(result.deferredAccumulator!.deferredResult.status).toBe('deferred');
    expect(result.deferredAccumulator!.deferredResult.code).toBe(
      'context_budget_risk',
    );
    expect(result.deferredAccumulator!.deferredResult.replan_required).toBe(
      true,
    );
    expect(result.deferredAccumulator!.deferredResult.suggested_actions)
      .toHaveLength(2);
  });

  it('hard zone with successful compaction: gate passes, contextBudgetReplanAttempts resets to 0', async () => {
    const { runtime, streamBuffer } = buildFixture();
    const compactSpy = vi.fn(async () => buildSnapshot(50));
    const result = await runtime.applyContextBudgetGate(
      buildInput({
        // preToolBudget at 90 with 40_000 projected chars + 4 tokens/char
        // pushes the projected pct well over 95% → hard
        preToolBudget: buildSnapshot(90),
        projectedResultChars: 40_000,
        contextBudgetReplanAttempts: 0,
        compactContextIfNeeded: compactSpy,
      }),
    );
    expect(compactSpy).toHaveBeenCalledTimes(1);
    expect(compactSpy).toHaveBeenCalledWith(
      'pre_tool_hard_threshold',
      expect.objectContaining({ occupancyPct: 90 }),
    );
    expect(result.shouldContinue).toBe(false);
    expect(result.contextBudgetReplanAttempts).toBe(0);
    expect(result.preToolBudget.occupancyPct).toBe(50);
    expect(streamBuffer.snapshot('msg-assistant-1')).toHaveLength(0);
  });

  it('hard zone with failed compaction (snapshot unchanged): gate fires hard-zone deferred branch', async () => {
    const { runtime, streamBuffer } = buildFixture();
    const compactSpy = vi.fn(async (_reason, snapshot: ContextBudgetSnapshot) =>
      snapshot,
    );
    const result = await runtime.applyContextBudgetGate(
      buildInput({
        preToolBudget: buildSnapshot(94),
        projectedResultChars: 80_000,
        contextBudgetReplanAttempts: 0,
        compactContextIfNeeded: compactSpy,
      }),
    );
    expect(compactSpy).toHaveBeenCalledTimes(1);
    expect(result.shouldContinue).toBe(true);
    expect(result.contextBudgetReplanAttempts).toBe(1);
    const events = streamBuffer.snapshot('msg-assistant-1');
    expect(events).toHaveLength(1);
    const payload = events[0].data as {
      result: { code: string; message: string };
    };
    expect(payload.result.code).toBe('context_budget_blocked');
    expect(payload.result.message).toContain('blocked');
    expect(payload.result.message).toContain('hard threshold');
  });

  it('escalation: second hard attempt over maxReplanAttempts emits the escalation status event', async () => {
    const { runtime, streamBuffer } = buildFixture();
    const result = await runtime.applyContextBudgetGate(
      buildInput({
        preToolBudget: buildSnapshot(94),
        projectedResultChars: 80_000,
        contextBudgetReplanAttempts: 1, // already past first attempt
        maxReplanAttempts: 1,
        compactContextIfNeeded: async (_reason, snapshot) => snapshot,
      }),
    );
    expect(result.shouldContinue).toBe(true);
    expect(result.contextBudgetReplanAttempts).toBe(2);
    // Sequencer allocates 1 then 2 → runtime returns 2+1 = 3 after
    // emitting deferred + escalation events. Caller re-syncs.
    expect(result.streamSeq).toBe(3);
    const events = streamBuffer.snapshot('msg-assistant-1');
    expect(events).toHaveLength(2);
    expect(events[0].eventType).toBe('tool_call_result');
    expect(events[1].eventType).toBe('status');
    const escalationPayload = events[1].data as {
      state: string;
      code: string;
      occupancy_pct: number;
    };
    expect(escalationPayload.state).toBe(
      'context_budget_user_escalation_required',
    );
    expect(escalationPayload.code).toBe('context_budget_blocked');
    expect(escalationPayload.occupancy_pct).toBeGreaterThanOrEqual(95);
    const deferredPayload = events[0].data as {
      result: { escalation_required: boolean };
    };
    expect(deferredPayload.result.escalation_required).toBe(true);
  });

  it('streamSeq advances correctly per branch: untouched on happy path, +1 on soft deferred, +2 on hard escalation', async () => {
    const { runtime } = buildFixture();
    // case A: happy path — sequencer not touched, input streamSeq
    // forwarded unchanged.
    const r1 = await runtime.applyContextBudgetGate(
      buildInput({
        streamId: 'msg-a',
        preToolBudget: buildSnapshot(40),
        projectedResultChars: 1_000,
        streamSeq: 100,
      }),
    );
    expect(r1.streamSeq).toBe(100);
    // case B: soft zone (single allocate → seq=1, returns 2).
    const r2 = await runtime.applyContextBudgetGate(
      buildInput({
        streamId: 'msg-b',
        preToolBudget: buildSnapshot(78),
        projectedResultChars: 8_000,
        streamSeq: 100,
      }),
    );
    expect(r2.streamSeq).toBe(2);
    // case C: hard zone + escalation (two allocates → seq=1, seq=2,
    // returns 3).
    const r3 = await runtime.applyContextBudgetGate(
      buildInput({
        streamId: 'msg-c',
        preToolBudget: buildSnapshot(94),
        projectedResultChars: 80_000,
        contextBudgetReplanAttempts: 1,
        compactContextIfNeeded: async (_reason, snapshot) => snapshot,
        streamSeq: 100,
      }),
    );
    expect(r3.streamSeq).toBe(3);
  });

  it('soft and hard zone codes are routed verbatim from input (api-side constants)', async () => {
    const { runtime, streamBuffer } = buildFixture();
    // Hard zone uses hardZoneCode
    const rHard = await runtime.applyContextBudgetGate(
      buildInput({
        streamId: 'msg-hard',
        preToolBudget: buildSnapshot(94),
        projectedResultChars: 80_000,
        compactContextIfNeeded: async (_reason, snapshot) => snapshot,
        softZoneCode: 'CUSTOM_SOFT',
        hardZoneCode: 'CUSTOM_HARD',
      }),
    );
    expect(rHard.deferredAccumulator!.deferredResult.code).toBe('CUSTOM_HARD');
    // Soft zone uses softZoneCode
    const rSoft = await runtime.applyContextBudgetGate(
      buildInput({
        streamId: 'msg-soft',
        preToolBudget: buildSnapshot(78),
        projectedResultChars: 8_000,
        softZoneCode: 'CUSTOM_SOFT',
        hardZoneCode: 'CUSTOM_HARD',
      }),
    );
    expect(rSoft.deferredAccumulator!.deferredResult.code).toBe('CUSTOM_SOFT');
    // Verify events carry the correct codes too
    const hardEvents = streamBuffer.snapshot('msg-hard');
    const softEvents = streamBuffer.snapshot('msg-soft');
    expect((hardEvents[0].data as { result: { code: string } }).result.code)
      .toBe('CUSTOM_HARD');
    expect((softEvents[0].data as { result: { code: string } }).result.code)
      .toBe('CUSTOM_SOFT');
  });

  it('toolName fallback: empty toolCall.name produces deferredAccumulator.toolName = "unknown_tool"', async () => {
    const { runtime } = buildFixture();
    const result = await runtime.applyContextBudgetGate(
      buildInput({
        toolCall: { id: 'tc-empty', name: '' },
        preToolBudget: buildSnapshot(78),
        projectedResultChars: 8_000,
      }),
    );
    expect(result.shouldContinue).toBe(true);
    expect(result.deferredAccumulator!.toolName).toBe('unknown_tool');
    expect(result.deferredAccumulator!.toolCallId).toBe('tc-empty');
  });

  it('deferredResult payload contains projected occupancy + estimated_tokens + max_tokens from post-compaction snapshot', async () => {
    const { runtime } = buildFixture();
    const result = await runtime.applyContextBudgetGate(
      buildInput({
        preToolBudget: buildSnapshot(94, 200_000),
        projectedResultChars: 80_000,
        compactContextIfNeeded: async (_reason, snapshot) => snapshot,
      }),
    );
    expect(result.shouldContinue).toBe(true);
    const dr = result.deferredAccumulator!.deferredResult;
    expect(dr.max_tokens).toBe(200_000);
    expect(dr.occupancy_pct).toBeGreaterThanOrEqual(95);
    expect(dr.estimated_tokens).toBeGreaterThan(0);
    expect(dr.replan_required).toBe(true);
    expect(dr.suggested_actions).toEqual([
      'Narrow scope and retry tool with smaller payload.',
      'Use history_analyze for targeted extraction if needed.',
    ]);
  });
});
