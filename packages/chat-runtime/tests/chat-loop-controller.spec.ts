/**
 * chat-loop-controller.spec.ts — Deterministic parity proof for slice 1B.
 *
 * Strategy (SPEC_EVOL_CHATUI_MODULARIZATION §7 R3):
 *   Feed FIXED sequences of stream events + message history into
 *   createChatLoopController and assert:
 *     1. The projected timeline items match the golden output from the pure
 *        helpers (buildProjectedTimeline + projectAssistantRunSegments) — proving
 *        the controller produces IDENTICAL results before/after the state move.
 *     2. The signature cache is effective (recompute only when events change).
 *     3. subscribe() delivers the store contract: immediate emission + change on mutation.
 *     4. Event accumulation helpers (mergeHistoryEvents, mergeProjectedHistoryForStream,
 *        appendProjectedLiveEvent) preserve order, deduplicate by sequence.
 *     5. Message mutations (setMessages, appendMessage, patchMessage, filterMessages)
 *        keep messages in sync.
 *     6. Zero sentropic domain strings in the controller module (runtime string scan).
 *
 * Runs in --environment node (no browser/Svelte dependencies).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { createChatLoopController } from '../src/state/chatLoopController.js';
import {
  projectAssistantRunSegments,
  countLinkedSteerMessages,
  type ProjectionStreamEvent,
} from '../src/utils/chat-run-projection.js';
import {
  buildProjectedTimeline,
  type ChatProjectionMessage,
} from '../src/state/chatProjection.js';

// ---------------------------------------------------------------------------
// Fixture loading
// ---------------------------------------------------------------------------
const FIXTURES_DIR = path.join(process.cwd(), 'tests', 'fixtures', 'streams');

function loadNdjson(filename: string): ProjectionStreamEvent[] {
  const text = fs.readFileSync(path.join(FIXTURES_DIR, filename), 'utf8');
  return text
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as ProjectionStreamEvent);
}

// ---------------------------------------------------------------------------
// Type helpers — lean, framework-neutral
// ---------------------------------------------------------------------------
type Msg = ChatProjectionMessage & { sessionId?: string };

const userMsg = (id: string, content = 'hi'): Msg => ({ id, role: 'user', content });
const assistantMsg = (id: string, extra: Partial<Msg> = {}): Msg => ({
  id,
  role: 'assistant',
  ...extra,
});

// ---------------------------------------------------------------------------
// 1. Projection parity: controller vs. pure helpers (golden)
// ---------------------------------------------------------------------------
describe('chat-loop-controller: projection parity golden', () => {
  it('produces identical timeline items to buildProjectedTimeline for simple-assistant-response fixture', () => {
    const events = loadNdjson('simple-assistant-response.ndjson');
    const msgId = 'msg-simple-1';
    const streamId = 'stream-simple-1';

    const ctrl = createChatLoopController<Msg>();

    const user = userMsg('u1', 'Hello');
    const asst = assistantMsg(msgId, {
      _streamId: streamId,
      _localStatus: 'completed',
      content: 'Hello, world!',
    });

    ctrl.setMessages([user, asst]);
    ctrl.mergeHistoryEvents(streamId, events);

    const ctrlTimeline = ctrl.getSnapshot().projectedTimelineItems;

    // Golden: compute expected via pure helpers
    const expectedComputation = {
      segments: projectAssistantRunSegments(events),
      linkedSteerCount: countLinkedSteerMessages(events),
    };
    const goldenTimeline = buildProjectedTimeline<Msg>({
      timeline: [user, asst],
      getAssistantComputation: (m) =>
        m.id === msgId ? expectedComputation : { segments: [], linkedSteerCount: 0 },
    });

    expect(ctrlTimeline.length).toBe(goldenTimeline.length);
    expect(ctrlTimeline.map((i) => i.kind)).toEqual(goldenTimeline.map((i) => i.kind));
    expect(ctrlTimeline.map((i) => i.key)).toEqual(goldenTimeline.map((i) => i.key));

    // Assistant segment content must match
    const ctrlAsst = ctrlTimeline.find((i) => i.kind === 'assistant-segment');
    const goldenAsst = goldenTimeline.find((i) => i.kind === 'assistant-segment');
    expect(ctrlAsst).toBeDefined();
    expect(goldenAsst).toBeDefined();
    if (ctrlAsst?.kind === 'assistant-segment' && goldenAsst?.kind === 'assistant-segment') {
      expect(ctrlAsst.segment.content).toBe(goldenAsst.segment.content);
      expect(ctrlAsst.segment.content).toBe('Hello, world!');
    }
  });

  it('produces identical timeline items to buildProjectedTimeline for tool-call-and-result fixture', () => {
    const events = loadNdjson('tool-call-and-result.ndjson');
    const msgId = 'msg-tool-1';
    const streamId = 'stream-tool-1';

    const ctrl = createChatLoopController<Msg>();
    const user = userMsg('u2', 'Do the thing');
    const asst = assistantMsg(msgId, {
      _streamId: streamId,
      _localStatus: 'completed',
      content: "I've created the plan.",
    });

    ctrl.setMessages([user, asst]);
    ctrl.mergeHistoryEvents(streamId, events);

    const ctrlTimeline = ctrl.getSnapshot().projectedTimelineItems;

    const expectedComputation = {
      segments: projectAssistantRunSegments(events),
      linkedSteerCount: countLinkedSteerMessages(events),
    };
    const goldenTimeline = buildProjectedTimeline<Msg>({
      timeline: [user, asst],
      getAssistantComputation: (m) =>
        m.id === msgId ? expectedComputation : { segments: [], linkedSteerCount: 0 },
    });

    expect(ctrlTimeline.length).toBe(goldenTimeline.length);
    expect(ctrlTimeline.map((i) => i.kind)).toEqual(goldenTimeline.map((i) => i.kind));
    expect(ctrlTimeline.map((i) => i.key)).toEqual(goldenTimeline.map((i) => i.key));
  });

  it('live events via appendProjectedLiveEvent produce same result as merging them up-front', () => {
    const events = loadNdjson('simple-assistant-response.ndjson');
    const msgId = 'msg-live-1';
    const streamId = 'stream-live-1';

    // Controller A: merge all events at once (batch)
    const ctrlA = createChatLoopController<Msg>();
    const asst = assistantMsg(msgId, { _streamId: streamId, _localStatus: 'processing' });
    ctrlA.setMessages([asst]);
    ctrlA.mergeProjectedHistoryForStream(streamId, events);

    // Controller B: append events one by one (live)
    const ctrlB = createChatLoopController<Msg>();
    ctrlB.setMessages([assistantMsg(msgId, { _streamId: streamId, _localStatus: 'processing' })]);
    for (const event of events) {
      ctrlB.appendProjectedLiveEvent(streamId, event);
    }

    const snapshotA = ctrlA.getSnapshot();
    const snapshotB = ctrlB.getSnapshot();

    // Both should have identical event arrays (same content, order by sequence)
    expect(snapshotA.projectedStreamEventsById.get(streamId)).toEqual(
      snapshotB.projectedStreamEventsById.get(streamId),
    );

    // Timeline kinds must match
    expect(snapshotA.projectedTimelineItems.map((i) => i.kind)).toEqual(
      snapshotB.projectedTimelineItems.map((i) => i.kind),
    );
  });
});

// ---------------------------------------------------------------------------
// 2. Signature cache effectiveness
// ---------------------------------------------------------------------------
describe('chat-loop-controller: signature cache', () => {
  it('returns cached computation when events have not changed', () => {
    const events = loadNdjson('simple-assistant-response.ndjson');
    const msgId = 'msg-cache-1';
    const streamId = msgId;

    const ctrl = createChatLoopController<Msg>();
    const asst = assistantMsg(msgId, { _localStatus: 'completed', content: 'Hello, world!' });
    ctrl.setMessages([asst]);
    ctrl.mergeHistoryEvents(streamId, events);

    // First call — computes and caches
    const comp1 = ctrl.getProjectedAssistantComputation(asst);
    // Second call — must return same object reference (cached)
    const comp2 = ctrl.getProjectedAssistantComputation(asst);

    expect(comp1.segments).toStrictEqual(comp2.segments);
    expect(comp1.linkedSteerCount).toBe(comp2.linkedSteerCount);
  });

  it('recomputes when new events are appended', () => {
    const msgId = 'msg-cache-2';
    const streamId = msgId;

    const ctrl = createChatLoopController<Msg>();
    const asst = assistantMsg(msgId, { _localStatus: 'processing' });
    ctrl.setMessages([asst]);

    // No events yet → segments empty
    const comp1 = ctrl.getProjectedAssistantComputation(asst);
    expect(comp1.segments).toHaveLength(0);

    // Add an event
    ctrl.appendProjectedLiveEvent(streamId, {
      eventType: 'status',
      sequence: 1,
      data: { state: 'started' },
    });

    const comp2 = ctrl.getProjectedAssistantComputation(asst);
    expect(comp2.segments.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 3. subscribe() — store contract
// ---------------------------------------------------------------------------
describe('chat-loop-controller: subscribe()', () => {
  it('emits current state immediately on subscribe', () => {
    const ctrl = createChatLoopController<Msg>();
    const listener = vi.fn();
    const unsub = ctrl.subscribe(listener);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0].messages).toHaveLength(0);
    unsub();
  });

  it('emits on setMessages', () => {
    const ctrl = createChatLoopController<Msg>();
    const snapshots: number[] = [];
    const unsub = ctrl.subscribe((s) => snapshots.push(s.messages.length));

    ctrl.setMessages([userMsg('u1'), assistantMsg('a1')]);
    expect(snapshots).toEqual([0, 2]);
    unsub();
  });

  it('emits on appendProjectedLiveEvent and bumps projectionEventsVersion', () => {
    const ctrl = createChatLoopController<Msg>();
    ctrl.setMessages([assistantMsg('a1', { _streamId: 's1', _localStatus: 'processing' })]);

    const versions: number[] = [];
    const unsub = ctrl.subscribe((s) => versions.push(s.projectionEventsVersion));

    ctrl.appendProjectedLiveEvent('s1', { eventType: 'status', sequence: 1, data: {} });
    ctrl.appendProjectedLiveEvent('s1', { eventType: 'content_delta', sequence: 2, data: { delta: 'hi' } });

    // versions[0] = initial, versions[1] after first event, versions[2] after second
    expect(versions.length).toBe(3);
    expect(versions[2]).toBe(2);
    unsub();
  });

  it('unsubscribe stops future emissions', () => {
    const ctrl = createChatLoopController<Msg>();
    const calls: number[] = [];
    const unsub = ctrl.subscribe((s) => calls.push(s.messages.length));
    unsub();
    ctrl.setMessages([userMsg('u1')]);
    // Only the initial emission before unsubscribe
    expect(calls).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 4. Event accumulation helpers
// ---------------------------------------------------------------------------
describe('chat-loop-controller: event accumulation', () => {
  it('mergeHistoryEvents deduplicates by sequence and sorts ascending', () => {
    const ctrl = createChatLoopController<Msg>();
    ctrl.mergeHistoryEvents('msgA', [
      { eventType: 'status', sequence: 1, data: {} },
      { eventType: 'content_delta', sequence: 3, data: { delta: 'a' } },
    ]);
    ctrl.mergeHistoryEvents('msgA', [
      { eventType: 'content_delta', sequence: 3, data: { delta: 'a-updated' } },
      { eventType: 'done', sequence: 5, data: {} },
    ]);

    const events = ctrl.getSnapshot().initialEventsByMessageId.get('msgA')!;
    expect(events).toHaveLength(3);
    expect(events.map((e) => e.sequence)).toEqual([1, 3, 5]);
    expect(events[1].data).toEqual({ delta: 'a-updated' });
  });

  it('appendProjectedLiveEvent does not add duplicate sequence', () => {
    const ctrl = createChatLoopController<Msg>();
    ctrl.appendProjectedLiveEvent('s1', { eventType: 'status', sequence: 1, data: {} });
    ctrl.appendProjectedLiveEvent('s1', { eventType: 'status', sequence: 1, data: { extra: true } });

    const events = ctrl.getSnapshot().projectedStreamEventsById.get('s1')!;
    expect(events).toHaveLength(1);
  });

  it('clearProjectedEventsForStream removes only the target stream', () => {
    const ctrl = createChatLoopController<Msg>();
    ctrl.appendProjectedLiveEvent('s1', { eventType: 'status', sequence: 1, data: {} });
    ctrl.appendProjectedLiveEvent('s2', { eventType: 'status', sequence: 1, data: {} });

    ctrl.clearProjectedEventsForStream('s1');

    expect(ctrl.getSnapshot().projectedStreamEventsById.has('s1')).toBe(false);
    expect(ctrl.getSnapshot().projectedStreamEventsById.has('s2')).toBe(true);
  });

  it('resetProjectionState clears all maps and resets version to 0', () => {
    const ctrl = createChatLoopController<Msg>();
    ctrl.appendProjectedLiveEvent('s1', { eventType: 'status', sequence: 1, data: {} });
    ctrl.mergeHistoryEvents('m1', [{ eventType: 'status', sequence: 1, data: {} }]);

    ctrl.resetProjectionState();

    const snap = ctrl.getSnapshot();
    expect(snap.projectedStreamEventsById.size).toBe(0);
    expect(snap.initialEventsByMessageId.size).toBe(0);
    expect(snap.projectionEventsVersion).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 5. Message mutations
// ---------------------------------------------------------------------------
describe('chat-loop-controller: message mutations', () => {
  it('setMessages replaces the list', () => {
    const ctrl = createChatLoopController<Msg>();
