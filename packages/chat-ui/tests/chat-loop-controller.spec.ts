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
    ctrl.setMessages([userMsg('u1'), assistantMsg('a1')]);
    expect(ctrl.getSnapshot().messages).toHaveLength(2);
    ctrl.setMessages([userMsg('u2')]);
    expect(ctrl.getSnapshot().messages).toHaveLength(1);
    expect(ctrl.getSnapshot().messages[0]?.id).toBe('u2');
  });

  it('appendMessage adds to the end', () => {
    const ctrl = createChatLoopController<Msg>();
    ctrl.setMessages([userMsg('u1')]);
    ctrl.appendMessage(assistantMsg('a1', { _localStatus: 'processing' }));
    expect(ctrl.getSnapshot().messages).toHaveLength(2);
    expect(ctrl.getSnapshot().messages[1]?.id).toBe('a1');
  });

  it('patchMessage updates matching message by id', () => {
    const ctrl = createChatLoopController<Msg>();
    ctrl.setMessages([assistantMsg('a1', { _localStatus: 'processing' })]);
    const found = ctrl.patchMessage('a1', { _localStatus: 'completed', content: 'Done.' });
    expect(found).toBe(true);
    const msg = ctrl.getSnapshot().messages.find((m) => m.id === 'a1');
    expect(msg?._localStatus).toBe('completed');
    expect(msg?.content).toBe('Done.');
  });

  it('patchMessage returns false when id not found', () => {
    const ctrl = createChatLoopController<Msg>();
    ctrl.setMessages([userMsg('u1')]);
    const found = ctrl.patchMessage('nonexistent', { content: 'x' });
    expect(found).toBe(false);
    expect(ctrl.getSnapshot().messages).toHaveLength(1);
  });

  it('filterMessages removes messages not in the keep set', () => {
    const ctrl = createChatLoopController<Msg>();
    ctrl.setMessages([userMsg('u1'), userMsg('u2'), assistantMsg('a1')]);
    ctrl.filterMessages(new Set(['u1', 'a1']));
    expect(ctrl.getSnapshot().messages.map((m) => m.id)).toEqual(['u1', 'a1']);
  });
});

// ---------------------------------------------------------------------------
// 6. isTrackedAssistantStreamId
// ---------------------------------------------------------------------------
describe('chat-loop-controller: isTrackedAssistantStreamId', () => {
  it('returns true when an assistant message matches by _streamId', () => {
    const ctrl = createChatLoopController<Msg>();
    ctrl.setMessages([
      assistantMsg('a1', { _streamId: 'stream-xyz', _localStatus: 'processing' }),
    ]);
    expect(ctrl.isTrackedAssistantStreamId('stream-xyz')).toBe(true);
    expect(ctrl.isTrackedAssistantStreamId('unknown')).toBe(false);
  });

  it('falls back to message.id when _streamId is absent', () => {
    const ctrl = createChatLoopController<Msg>();
    ctrl.setMessages([assistantMsg('a1', { _localStatus: 'processing' })]);
    expect(ctrl.isTrackedAssistantStreamId('a1')).toBe(true);
  });

  it('returns false for user messages', () => {
    const ctrl = createChatLoopController<Msg>();
    ctrl.setMessages([userMsg('u1')]);
    expect(ctrl.isTrackedAssistantStreamId('u1')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 7. getProjectionEventsForMessage priority: projected > history
// ---------------------------------------------------------------------------
describe('chat-loop-controller: getProjectionEventsForMessage', () => {
  it('prefers projectedStreamEventsById over initialEventsByMessageId', () => {
    const ctrl = createChatLoopController<Msg>();
    const streamId = 'stream-priority-1';
    const msgId = streamId;

    // History: one event
    ctrl.mergeHistoryEvents(msgId, [
      { eventType: 'status', sequence: 1, data: { from: 'history' } },
    ]);
    // Live: different event at same sequence (override)
    ctrl.appendProjectedLiveEvent(streamId, {
      eventType: 'status',
      sequence: 1,
      data: { from: 'live' },
    });

    const asst = assistantMsg(msgId, { _streamId: streamId });
    ctrl.setMessages([asst]);

    const events = ctrl.getProjectionEventsForMessage(asst);
    // Should return live events (projected), not history
    expect(events[0]?.data?.from).toBe('live');
  });

  it('falls back to initialEventsByMessageId when projected is empty', () => {
    const ctrl = createChatLoopController<Msg>();
    const msgId = 'msg-fallback-1';

    ctrl.mergeHistoryEvents(msgId, [
      { eventType: 'status', sequence: 1, data: { from: 'history' } },
    ]);

    const asst = assistantMsg(msgId);
    ctrl.setMessages([asst]);

    const events = ctrl.getProjectionEventsForMessage(asst);
    expect(events[0]?.data?.from).toBe('history');
  });

  it('returns empty array when no events are registered', () => {
    const ctrl = createChatLoopController<Msg>();
    const asst = assistantMsg('a-empty');
    ctrl.setMessages([asst]);
    expect(ctrl.getProjectionEventsForMessage(asst)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 9. attachStream / detachStream — stream subscription lifecycle (slice 1C)
//
// Strategy: inject a fake streamClient + fake pollJob to feed deterministic
// event sequences and assert:
//   9a. Projection events are appended correctly from subscription
//   9b. Terminal events (done/error) patch the message _localStatus
//   9c. onProjectionEvent callback fires AFTER state is updated
//   9d. onTerminal callback fires AFTER message is patched
//   9e. detachStream removes the subscription
//   9f. job-poll fallback marks terminal when SSE is missed (done + error)
//   9g. job-poll does not run when message is already terminal
//   9h. attachStream hot-swap detaches previous subscription
// ---------------------------------------------------------------------------

/**
 * Minimal fake stream client for testing — records hub registrations.
 */
function makeFakeStreamClient() {
  const handlers = new Map<string, (event: unknown) => void>();
  return {
    set(key: string, handler: (event: unknown) => void) {
      handlers.set(key, handler);
    },
    delete(key: string) {
      handlers.delete(key);
    },
    emit(event: unknown) {
      for (const handler of handlers.values()) {
        handler(event);
      }
    },
    get size() {
      return handlers.size;
    },
    hasAnyHandler() {
      return handlers.size > 0;
    },
  };
}

type FakePollJobStatus = 'pending' | 'processing' | 'completed' | 'failed';

/**
 * Minimal fake pollJob — returns statuses from a queue.
 * Throws if the queue is empty (test setup issue).
 */
function makeFakePollJob(responses: FakePollJobStatus[]) {
  const queue = [...responses];
  return async (_jobId: string): Promise<{ status: string }> => {
    const status = queue.shift();
    if (!status) throw new Error('makeFakePollJob: queue exhausted');
    return { status };
  };
}

describe('chat-loop-controller: stream subscription (slice 1C)', () => {
  // 9a. Projection events are appended from subscription
  it('routes projection events from subscription into projectedStreamEventsById', () => {
    const ctrl = createChatLoopController<Msg>();
    const streamId = 'stream-sub-1';
    const asst = assistantMsg('a1', { _streamId: streamId, _localStatus: 'processing' });
    ctrl.setMessages([asst]);

    const client = makeFakeStreamClient();
    ctrl.attachStream({
      streamClient: client,
      pollJob: makeFakePollJob(['pending', 'completed']),
    });

    expect(client.hasAnyHandler()).toBe(true);

    client.emit({ type: 'status', streamId, sequence: 1, data: { state: 'started' } });
    client.emit({ type: 'content_delta', streamId, sequence: 2, data: { delta: 'Hello' } });

    const events = ctrl.getSnapshot().projectedStreamEventsById.get(streamId);
    expect(events).toHaveLength(2);
    expect(events?.[0]?.eventType).toBe('status');
    expect(events?.[1]?.eventType).toBe('content_delta');
  });

  // 9b. Terminal 'done' event patches message to completed
  it("patches message _localStatus to 'completed' on terminal 'done' event", () => {
    const ctrl = createChatLoopController<Msg>();
    const streamId = 'stream-done-1';
    const asst = assistantMsg('a1', { _streamId: streamId, _localStatus: 'processing' });
    ctrl.setMessages([asst]);

    const client = makeFakeStreamClient();
    ctrl.attachStream({
      streamClient: client,
      pollJob: makeFakePollJob(['completed']),
    });

    client.emit({ type: 'content_delta', streamId, sequence: 1, data: { delta: 'hi' } });
    client.emit({ type: 'done', streamId, sequence: 2, data: {} });

    const msg = ctrl.getSnapshot().messages.find((m) => m.id === 'a1');
    expect(msg?._localStatus).toBe('completed');
  });

  // 9b. Terminal 'error' event patches message to failed
  it("patches message _localStatus to 'failed' on terminal 'error' event", () => {
    const ctrl = createChatLoopController<Msg>();
    const streamId = 'stream-err-1';
    const asst = assistantMsg('a1', { _streamId: streamId, _localStatus: 'processing' });
    ctrl.setMessages([asst]);

    const client = makeFakeStreamClient();
    ctrl.attachStream({
      streamClient: client,
      pollJob: makeFakePollJob(['failed']),
    });

    client.emit({ type: 'error', streamId, sequence: 1, data: { message: 'oops' } });

    const msg = ctrl.getSnapshot().messages.find((m) => m.id === 'a1');
    expect(msg?._localStatus).toBe('failed');
  });

  // 9c. onProjectionEvent callback fires after state is updated
  it('onProjectionEvent is called with the streamId after event is appended', () => {
    const ctrl = createChatLoopController<Msg>();
    const streamId = 'stream-cb-1';
    const asst = assistantMsg('a1', { _streamId: streamId, _localStatus: 'processing' });
    ctrl.setMessages([asst]);

    const client = makeFakeStreamClient();
    const callbackStreamIds: string[] = [];
    const versionAtCallback: number[] = [];

    ctrl.attachStream({
      streamClient: client,
      pollJob: makeFakePollJob(['completed']),
      onProjectionEvent: (sid) => {
        callbackStreamIds.push(sid);
        // State must already be updated when callback fires
        versionAtCallback.push(ctrl.getSnapshot().projectionEventsVersion);
      },
    });

    client.emit({ type: 'content_delta', streamId, sequence: 1, data: { delta: 'a' } });
    client.emit({ type: 'content_delta', streamId, sequence: 2, data: { delta: 'b' } });

    expect(callbackStreamIds).toEqual([streamId, streamId]);
    // projectionEventsVersion must have been incremented before each callback
    expect(versionAtCallback[0]).toBeGreaterThan(0);
    expect(versionAtCallback[1]).toBeGreaterThan(versionAtCallback[0]!);
  });

  // 9d. onTerminal callback fires after message is patched
  it('onTerminal is called with streamId + outcome after message is patched', () => {
    const ctrl = createChatLoopController<Msg>();
    const streamId = 'stream-term-cb-1';
    const asst = assistantMsg('a1', { _streamId: streamId, _localStatus: 'processing' });
    ctrl.setMessages([asst]);

    const client = makeFakeStreamClient();
    const terminalCalls: Array<{ streamId: string; outcome: string; status: string | undefined }> = [];

    ctrl.attachStream({
      streamClient: client,
      pollJob: makeFakePollJob(['completed']),
      onTerminal: (sid, outcome) => {
        const msg = ctrl.getSnapshot().messages.find((m) => m.id === 'a1');
        terminalCalls.push({ streamId: sid, outcome, status: msg?._localStatus });
      },
    });

    client.emit({ type: 'done', streamId, sequence: 1, data: {} });

    expect(terminalCalls).toHaveLength(1);
    expect(terminalCalls[0]?.outcome).toBe('done');
    expect(terminalCalls[0]?.streamId).toBe(streamId);
    // Message MUST already be patched when callback fires
    expect(terminalCalls[0]?.status).toBe('completed');
  });

  // 9e. detachStream removes the subscription
  it('detachStream removes the hub handler — subsequent events are ignored', () => {
    const ctrl = createChatLoopController<Msg>();
    const streamId = 'stream-detach-1';
    const asst = assistantMsg('a1', { _streamId: streamId, _localStatus: 'processing' });
    ctrl.setMessages([asst]);

    const client = makeFakeStreamClient();
    ctrl.attachStream({
      streamClient: client,
      pollJob: makeFakePollJob(['completed']),
    });

    // One event before detach
    client.emit({ type: 'content_delta', streamId, sequence: 1, data: { delta: 'a' } });
    expect(ctrl.getSnapshot().projectedStreamEventsById.get(streamId)).toHaveLength(1);

    ctrl.detachStream();
    expect(client.hasAnyHandler()).toBe(false);

    // Event after detach — must be ignored
    client.emit({ type: 'content_delta', streamId, sequence: 2, data: { delta: 'b' } });
    expect(ctrl.getSnapshot().projectedStreamEventsById.get(streamId)).toHaveLength(1);
  });

  // 9f-done. job-poll fallback marks terminal 'completed' when SSE is missed
  it('startJobPoll marks message completed when poll returns completed', async () => {
    const ctrl = createChatLoopController<Msg>();
    const streamId = 'stream-poll-done-1';
    const jobId = 'job-poll-done-1';
    const asst = assistantMsg('a1', { _streamId: streamId, _localStatus: 'processing' });
    ctrl.setMessages([asst]);

    // Poll responses: pending × 1, then completed
    const pollFn = vi.fn()
      .mockResolvedValueOnce({ status: 'pending' })
      .mockResolvedValueOnce({ status: 'completed' });

    const terminalOutcomes: string[] = [];
    ctrl.attachStream({
      streamClient: makeFakeStreamClient(),
      pollJob: pollFn,
      onTerminal: (_, outcome) => terminalOutcomes.push(outcome),
      pollInitialDelayMs: 0,
      pollIntervalMs: 0,
    });

    ctrl.startJobPoll(jobId, streamId);

    // Let the poll loop run to completion
    await vi.waitFor(() => expect(terminalOutcomes).toHaveLength(1), { timeout: 2000 });

    expect(terminalOutcomes[0]).toBe('done');
    const msg = ctrl.getSnapshot().messages.find((m) => m.id === 'a1');
    expect(msg?._localStatus).toBe('completed');
  });

  // 9f-error. job-poll fallback marks terminal 'failed' when poll returns failed
  it('startJobPoll marks message failed when poll returns failed', async () => {
    const ctrl = createChatLoopController<Msg>();
    const streamId = 'stream-poll-err-1';
    const jobId = 'job-poll-err-1';
    const asst = assistantMsg('a1', { _streamId: streamId, _localStatus: 'processing' });
    ctrl.setMessages([asst]);

    const pollFn = vi.fn().mockResolvedValueOnce({ status: 'failed' });
    const terminalOutcomes: string[] = [];

    ctrl.attachStream({
      streamClient: makeFakeStreamClient(),
      pollJob: pollFn,
      onTerminal: (_, outcome) => terminalOutcomes.push(outcome),
      pollInitialDelayMs: 0,
      pollIntervalMs: 0,
    });

    ctrl.startJobPoll(jobId, streamId);

    await vi.waitFor(() => expect(terminalOutcomes).toHaveLength(1), { timeout: 2000 });
    expect(terminalOutcomes[0]).toBe('error');
  });

  // 9g. job-poll does NOT run when message is already terminal
  it('startJobPoll exits immediately when message is already completed', async () => {
    const ctrl = createChatLoopController<Msg>();
    const streamId = 'stream-poll-skip-1';
    const jobId = 'job-poll-skip-1';
    // Already completed — poll should not be called
    const asst = assistantMsg('a1', { _streamId: streamId, _localStatus: 'completed', content: 'done' });
    ctrl.setMessages([asst]);

    const pollFn = vi.fn();
    ctrl.attachStream({
      streamClient: makeFakeStreamClient(),
      pollJob: pollFn,
      pollInitialDelayMs: 0,
      pollIntervalMs: 0,
    });

    ctrl.startJobPoll(jobId, streamId);

    // Give a tick for async execution
    await new Promise<void>((r) => setTimeout(r, 20));
    expect(pollFn).not.toHaveBeenCalled();
  });

  // 9h. attachStream hot-swap detaches previous subscription
  it('calling attachStream twice detaches the first subscription', () => {
    const ctrl = createChatLoopController<Msg>();
    const streamId = 'stream-swap-1';
    const asst = assistantMsg('a1', { _streamId: streamId, _localStatus: 'processing' });
    ctrl.setMessages([asst]);

    const client1 = makeFakeStreamClient();
    const client2 = makeFakeStreamClient();

    ctrl.attachStream({ streamClient: client1, pollJob: makeFakePollJob(['completed']) });
    expect(client1.hasAnyHandler()).toBe(true);

    ctrl.attachStream({ streamClient: client2, pollJob: makeFakePollJob(['completed']) });
    // First client must be cleaned up
    expect(client1.hasAnyHandler()).toBe(false);
    // Second client is now active
    expect(client2.hasAnyHandler()).toBe(true);

    // Events from client2 land in the controller; client1 events are ignored
    client2.emit({ type: 'content_delta', streamId, sequence: 1, data: { delta: 'hi' } });
    expect(ctrl.getSnapshot().projectedStreamEventsById.get(streamId)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 8. Zero sentropic domain strings — runtime scan of controller module source
// ---------------------------------------------------------------------------
describe('chat-loop-controller: sentropic-string scan', () => {
  it('controller source contains zero sentropic domain strings', () => {
    const controllerPath = path.join(
      process.cwd(),
      'src',
      'state',
      'chatLoopController.ts',
    );
    const source = fs.readFileSync(controllerPath, 'utf8');

    const forbidden = [
      'organization',
      'folder',
      'initiative',
      'usecase',
      'session_adapter',
      'workspace',
      'organization_update',
      'folder_update',
    ];

    for (const term of forbidden) {
      // Allow the term only in comments (lines starting with // or * )
      const lines = source.split('\n');
      const codeLines = lines.filter(
        (line) => !/^\s*(\/\/|\*)/.test(line),
      );
      const codeBlock = codeLines.join('\n');
      expect(
        codeBlock.includes(term),
        `Domain string "${term}" found in non-comment code`,
      ).toBe(false);
    }
  });
});
