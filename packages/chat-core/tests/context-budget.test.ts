/**
 * BR14b Lot 21a — pure helper (`context-budget.ts`) unit tests.
 *
 * Covers `writeContextBudgetStatus` extracted from `chat-service.ts`
 * (`runAssistantGeneration`). The closure pre-Lot 21a captured the
 * shared `streamSeq` cursor, the `lastBudgetAnnouncedPct` cursor, and
 * `options.assistantMessageId`. The pure helper now drives the
 * sequence cursor through the `StreamSequencer` port and returns the
 * advanced `lastBudgetAnnouncedPct` value so the caller can assign it
 * back.
 *
 * Tests use the `InMemoryStreamBuffer` + `InMemoryStreamSequencer`
 * reference adapters so behaviour is exercised end-to-end through the
 * ports.
 */
import { describe, expect, it } from 'vitest';

import {
  writeContextBudgetStatus,
  type ContextBudgetSnapshot,
} from '../src/context-budget.js';
import {
  InMemoryStreamBuffer,
  InMemoryStreamSequencer,
} from '../src/in-memory/index.js';

const normalSnapshot = (
  occupancyPct: number,
): ContextBudgetSnapshot => ({
  estimatedTokens: 1_000 * (occupancyPct / 10),
  maxTokens: 100_000,
  occupancyPct,
  zone: 'normal',
});

const softSnapshot = (occupancyPct: number): ContextBudgetSnapshot => ({
  estimatedTokens: 1_000 * (occupancyPct / 10),
  maxTokens: 100_000,
  occupancyPct,
  zone: 'soft',
});

describe('writeContextBudgetStatus', () => {
  it('appends a status event with the verbatim payload shape on first call', async () => {
    const streamBuffer = new InMemoryStreamBuffer();
    const streamSequencer = new InMemoryStreamSequencer();
    const streamId = 'msg-1';

    const result = await writeContextBudgetStatus({
      streamBuffer,
      streamSequencer,
      streamId,
      phase: 'pre_model',
      snapshot: normalSnapshot(40),
      lastBudgetAnnouncedPct: -1,
    });

    expect(result).toEqual({ appended: true, lastBudgetAnnouncedPct: 40 });
    const events = streamBuffer.snapshot(streamId);
    expect(events).toHaveLength(1);
    expect(events[0]?.sequence).toBe(1);
    expect(events[0]?.eventType).toBe('status');
    expect(events[0]?.messageId).toBe(streamId);
    expect(events[0]?.data).toEqual({
      state: 'context_budget_update',
      phase: 'pre_model',
      occupancy_pct: 40,
      estimated_tokens: 4000,
      max_tokens: 100_000,
      zone: 'normal',
    });
  });

  it('short-circuits when occupancy matches and zone is normal', async () => {
    const streamBuffer = new InMemoryStreamBuffer();
    const streamSequencer = new InMemoryStreamSequencer();
    const streamId = 'msg-1';

    const result = await writeContextBudgetStatus({
      streamBuffer,
      streamSequencer,
      streamId,
      phase: 'pre_model',
      snapshot: normalSnapshot(42),
      lastBudgetAnnouncedPct: 42,
    });

    expect(result).toEqual({ appended: false, lastBudgetAnnouncedPct: 42 });
    expect(streamBuffer.snapshot(streamId)).toHaveLength(0);
    expect(await streamSequencer.peek(streamId)).toBe(0);
  });

  it('appends when occupancy matches but zone is not normal', async () => {
    const streamBuffer = new InMemoryStreamBuffer();
    const streamSequencer = new InMemoryStreamSequencer();
    const streamId = 'msg-1';

    const result = await writeContextBudgetStatus({
      streamBuffer,
      streamSequencer,
      streamId,
      phase: 'pre_tool',
      snapshot: softSnapshot(78),
      lastBudgetAnnouncedPct: 78,
    });

    expect(result).toEqual({ appended: true, lastBudgetAnnouncedPct: 78 });
    const events = streamBuffer.snapshot(streamId);
    expect(events).toHaveLength(1);
    expect(events[0]?.data).toMatchObject({
      state: 'context_budget_update',
      phase: 'pre_tool',
      zone: 'soft',
      occupancy_pct: 78,
    });
  });

  it('merges extras into the payload (e.g. compaction source, tool_name)', async () => {
    const streamBuffer = new InMemoryStreamBuffer();
    const streamSequencer = new InMemoryStreamSequencer();
    const streamId = 'msg-1';

    await writeContextBudgetStatus({
      streamBuffer,
      streamSequencer,
      streamId,
      phase: 'pre_tool',
      snapshot: normalSnapshot(55),
      lastBudgetAnnouncedPct: -1,
      extras: { tool_name: 'read_initiative' },
    });

    const events = streamBuffer.snapshot(streamId);
    expect(events[0]?.data).toEqual({
      state: 'context_budget_update',
      phase: 'pre_tool',
      occupancy_pct: 55,
      estimated_tokens: 5500,
      max_tokens: 100_000,
      zone: 'normal',
      tool_name: 'read_initiative',
    });
  });

  it('allocates monotonic sequences across multiple non-short-circuit appends', async () => {
    const streamBuffer = new InMemoryStreamBuffer();
    const streamSequencer = new InMemoryStreamSequencer();
    const streamId = 'msg-1';

    let cursor = -1;
    for (const pct of [20, 30, 40]) {
      const result = await writeContextBudgetStatus({
        streamBuffer,
        streamSequencer,
        streamId,
        phase: 'pre_model',
        snapshot: normalSnapshot(pct),
        lastBudgetAnnouncedPct: cursor,
      });
      cursor = result.lastBudgetAnnouncedPct;
    }

    const events = streamBuffer.snapshot(streamId);
    expect(events.map((e) => e.sequence)).toEqual([1, 2, 3]);
    expect(events.map((e) => (e.data as Record<string, unknown>).occupancy_pct)).toEqual([
      20, 30, 40,
    ]);
    expect(await streamSequencer.peek(streamId)).toBe(3);
    expect(cursor).toBe(40);
  });

  it('isolates sequence allocation per streamId', async () => {
    const streamBuffer = new InMemoryStreamBuffer();
    const streamSequencer = new InMemoryStreamSequencer();

    await writeContextBudgetStatus({
      streamBuffer,
      streamSequencer,
      streamId: 'msg-a',
      phase: 'pre_model',
      snapshot: normalSnapshot(10),
      lastBudgetAnnouncedPct: -1,
    });
    await writeContextBudgetStatus({
      streamBuffer,
      streamSequencer,
      streamId: 'msg-b',
      phase: 'pre_model',
      snapshot: normalSnapshot(50),
      lastBudgetAnnouncedPct: -1,
    });
    await writeContextBudgetStatus({
      streamBuffer,
      streamSequencer,
      streamId: 'msg-a',
      phase: 'pre_tool',
      snapshot: normalSnapshot(20),
      lastBudgetAnnouncedPct: 10,
    });

    expect(await streamSequencer.peek('msg-a')).toBe(2);
    expect(await streamSequencer.peek('msg-b')).toBe(1);
    const eventsA = streamBuffer.snapshot('msg-a');
    expect(eventsA.map((e) => e.sequence)).toEqual([1, 2]);
    const eventsB = streamBuffer.snapshot('msg-b');
    expect(eventsB.map((e) => e.sequence)).toEqual([1]);
  });
});
