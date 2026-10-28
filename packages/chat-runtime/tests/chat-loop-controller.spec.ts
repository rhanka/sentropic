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
