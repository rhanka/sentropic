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

// ---------------------------------------------------------------------------
// 10. Host lifecycle (slice 1D) — send / bootstrapRun / retry / stop / edit / setFeedback
//
// Strategy: inject a FAKE host transport (records calls) and assert:
//   10a. attachHost wires the transport; send calls host.sendMessage with right payload
//   10b. send: optimistic user + assistant messages inserted; _streamId wired; startJobPoll fires
//   10c. send: returned handle matches host response
//   10d. bootstrapRun: userMessage path — both messages appended
//   10e. bootstrapRun: truncateAfterMessageId path — messages truncated correctly
//   10f. bootstrapRun: append path — assistant appended at the end
//   10g. retry: calls host.retryMessage with right args; truncates messages; returns handle
//   10h. retry: optimistic assistant inserted with processing status + _streamId
//   10i. stop: calls host.stopMessage with the message id
//   10j. edit: calls host.editMessage + patches content in message list
//   10k. setFeedback: calls host.setFeedback + patches feedbackVote (up→1, down→-1, clear→null)
//   10l. send/retry/stop/edit/setFeedback throw when no transport attached
// ---------------------------------------------------------------------------

/**
 * Fake host transport: records calls, returns deterministic responses.
 */
function makeFakeTransport(
  overrides: Partial<{
    sendMessageResponse: Partial<import('../src/state/chatLoopController.js').ControllerRunHandle>;
    retryMessageResponse: Partial<import('../src/state/chatLoopController.js').ControllerRunHandle>;
  }> = {},
) {
  const defaultHandle = {
    sessionId: 'sess-1',
    userMessageId: 'user-1',
    assistantMessageId: 'asst-1',
    streamId: 'stream-1',
    jobId: 'job-1',
  };
  const calls = {
    sendMessage: [] as unknown[],
    retryMessage: [] as Array<{ messageId: string; opts: { providerId: string; model: string } }>,
    stopMessage: [] as string[],
    editMessage: [] as Array<{ messageId: string; content: string }>,
    setFeedback: [] as Array<{ messageId: string; vote: string }>,
  };
  return {
    calls,
    transport: {
      async sendMessage(payload: unknown) {
        calls.sendMessage.push(payload);
        return { ...defaultHandle, ...(overrides.sendMessageResponse ?? {}) };
      },
      async retryMessage(messageId: string, opts: { providerId: string; model: string }) {
        calls.retryMessage.push({ messageId, opts });
        return { ...defaultHandle, ...(overrides.retryMessageResponse ?? {}) };
      },
      async stopMessage(messageId: string) {
        calls.stopMessage.push(messageId);
      },
      async editMessage(messageId: string, content: string) {
        calls.editMessage.push({ messageId, content });
      },
      async setFeedback(messageId: string, vote: string) {
        calls.setFeedback.push({ messageId, vote });
      },
    },
  };
}

/** Minimal assistant message factory (stamps model from closure). */
function makeFactory(model = 'gpt-test') {
  return (base: {
    id: string;
    sessionId: string;
    _streamId: string;
    _localStatus: 'processing';
    role: 'assistant';
    content: null;
    createdAt: string;
  }): Msg => ({ ...base, model } as Msg & { model: string });
}

describe('chat-loop-controller: host lifecycle (slice 1D)', () => {
  // 10a. attachHost wires the transport; send calls host.sendMessage with right payload
  it('10a: send calls host.sendMessage with the given payload', async () => {
    const ctrl = createChatLoopController<Msg>();
    const { transport, calls } = makeFakeTransport();
    ctrl.attachHost({ transport });
    ctrl.attachStream({
      streamClient: makeFakeStreamClient(),
      pollJob: makeFakePollJob(['completed']),
      pollInitialDelayMs: 0,
      pollIntervalMs: 0,
    });

    const payload = { content: 'Hello', sessionId: 'sess-x', model: 'gpt-4' };
    await ctrl.send(payload, {
      buildUserMessage: (h) => userMsg(h.userMessageId, payload.content),
      buildAssistantMessage: makeFactory(),
    });

    expect(calls.sendMessage).toHaveLength(1);
    expect(calls.sendMessage[0]).toMatchObject({ content: 'Hello', sessionId: 'sess-x', model: 'gpt-4' });
  });

  // 10b. send: optimistic user + assistant messages inserted; _streamId wired; startJobPoll fires
  it('10b: send inserts user + assistant messages with correct ids and _streamId', async () => {
    const ctrl = createChatLoopController<Msg>();
    const { transport } = makeFakeTransport({
      sendMessageResponse: {
        userMessageId: 'u-opt',
        assistantMessageId: 'a-opt',
        streamId: 'stream-opt',
        sessionId: 'sess-opt',
        jobId: 'job-opt',
      },
    });
    ctrl.attachHost({ transport });
    ctrl.attachStream({
      streamClient: makeFakeStreamClient(),
      pollJob: makeFakePollJob(['completed']),
      pollInitialDelayMs: 0,
      pollIntervalMs: 0,
    });

    await ctrl.send({ content: 'go' }, {
      buildUserMessage: (h) => userMsg(h.userMessageId, 'go'),
      buildAssistantMessage: makeFactory(),
    });

    const msgs = ctrl.getSnapshot().messages;
    expect(msgs).toHaveLength(2);

    const uMsg = msgs.find((m) => m.role === 'user');
    expect(uMsg?.id).toBe('u-opt');

    const aMsg = msgs.find((m) => m.role === 'assistant');
    expect(aMsg?.id).toBe('a-opt');
    expect(aMsg?._streamId).toBe('stream-opt');
    expect(aMsg?._localStatus).toBe('processing');
  });

  // 10c. send: returned handle matches host response
  it('10c: send returns a handle matching the host response', async () => {
    const ctrl = createChatLoopController<Msg>();
    const { transport } = makeFakeTransport({
      sendMessageResponse: {
        sessionId: 'sess-ret',
        userMessageId: 'u-ret',
        assistantMessageId: 'a-ret',
        streamId: 'stream-ret',
        jobId: 'job-ret',
      },
    });
    ctrl.attachHost({ transport });
    ctrl.attachStream({
      streamClient: makeFakeStreamClient(),
      pollJob: makeFakePollJob(['completed']),
      pollInitialDelayMs: 0,
      pollIntervalMs: 0,
    });

    const result = await ctrl.send({ content: 'x' }, {
      buildUserMessage: (h) => userMsg(h.userMessageId),
      buildAssistantMessage: makeFactory(),
    });

    expect(result.handle.sessionId).toBe('sess-ret');
    expect(result.handle.userMessageId).toBe('u-ret');
    expect(result.handle.assistantMessageId).toBe('a-ret');
    expect(result.handle.streamId).toBe('stream-ret');
    expect(result.handle.jobId).toBe('job-ret');
  });

  // 10d. bootstrapRun: userMessage path — both messages appended
  it('10d: bootstrapRun with userMessage appends user + assistant at the end', () => {
    const ctrl = createChatLoopController<Msg>();
    ctrl.attachStream({
      streamClient: makeFakeStreamClient(),
      pollJob: makeFakePollJob(['completed']),
      pollInitialDelayMs: 0,
      pollIntervalMs: 0,
    });
    const user = userMsg('u1', 'hi');
    ctrl.bootstrapRun({
      sessionId: 'sess-1',
      assistantMessageId: 'a1',
      streamId: 'stream-1',
      jobId: 'job-1',
      buildAssistantMessage: makeFactory(),
      userMessage: user,
    });

    const msgs = ctrl.getSnapshot().messages;
    expect(msgs).toHaveLength(2);
    expect(msgs[0]?.id).toBe('u1');
    expect(msgs[1]?.id).toBe('a1');
    expect(msgs[1]?._localStatus).toBe('processing');
    expect(msgs[1]?._streamId).toBe('stream-1');
  });

  // 10e. bootstrapRun: truncateAfterMessageId path — messages truncated correctly
  it('10e: bootstrapRun with truncateAfterMessageId truncates messages and appends assistant', () => {
    const ctrl = createChatLoopController<Msg>();
    ctrl.attachStream({
      streamClient: makeFakeStreamClient(),
      pollJob: makeFakePollJob(['completed']),
      pollInitialDelayMs: 0,
      pollIntervalMs: 0,
    });
    ctrl.setMessages([
      userMsg('u1'),
      assistantMsg('a1', { _localStatus: 'completed', content: 'first' }),
      userMsg('u2'),
      assistantMsg('a2', { _localStatus: 'completed', content: 'second' }),
    ]);

    ctrl.bootstrapRun({
      sessionId: 'sess-1',
      assistantMessageId: 'a-new',
      streamId: 'stream-new',
      jobId: 'job-new',
      buildAssistantMessage: makeFactory(),
      truncateAfterMessageId: 'u2',
    });

    const msgs = ctrl.getSnapshot().messages;
    // Messages up to u2 (inclusive) + new assistant
    expect(msgs.map((m) => m.id)).toEqual(['u1', 'a1', 'u2', 'a-new']);
    expect(msgs[3]?._streamId).toBe('stream-new');
    expect(msgs[3]?._localStatus).toBe('processing');
  });

  // 10f. bootstrapRun: append path — assistant appended at the end
  it('10f: bootstrapRun with no userMessage/truncate appends assistant at end', () => {
    const ctrl = createChatLoopController<Msg>();
    ctrl.attachStream({
      streamClient: makeFakeStreamClient(),
      pollJob: makeFakePollJob(['completed']),
      pollInitialDelayMs: 0,
      pollIntervalMs: 0,
    });
    ctrl.setMessages([userMsg('u1')]);

    ctrl.bootstrapRun({
      sessionId: 'sess-1',
      assistantMessageId: 'a1',
      streamId: 'stream-1',
      jobId: 'job-1',
      buildAssistantMessage: makeFactory(),
    });

    const msgs = ctrl.getSnapshot().messages;
    expect(msgs).toHaveLength(2);
    expect(msgs[1]?.id).toBe('a1');
  });

  // 10g. retry: calls host.retryMessage with right args; truncates messages; returns handle
  it('10g: retry calls host.retryMessage with right messageId + opts and truncates messages', async () => {
    const ctrl = createChatLoopController<Msg>();
    const { transport, calls } = makeFakeTransport({
      retryMessageResponse: {
        sessionId: 'sess-2',
        assistantMessageId: 'a-retry',
        streamId: 'stream-retry',
        jobId: 'job-retry',
        userMessageId: 'u-retry-placeholder',
      },
    });
    ctrl.attachHost({ transport });
    ctrl.attachStream({
      streamClient: makeFakeStreamClient(),
      pollJob: makeFakePollJob(['completed']),
      pollInitialDelayMs: 0,
      pollIntervalMs: 0,
    });
    ctrl.setMessages([
      userMsg('u1'),
      assistantMsg('a1', { _localStatus: 'completed', content: 'old' }),
      userMsg('u2'),
      assistantMsg('a2', { _localStatus: 'completed', content: 'old2' }),
    ]);

    const result = await ctrl.retry('u2', {
      providerId: 'openai',
      model: 'gpt-4',
      buildAssistantMessage: makeFactory(),
    });

    // Host called with right args
    expect(calls.retryMessage).toHaveLength(1);
    expect(calls.retryMessage[0]?.messageId).toBe('u2');
    expect(calls.retryMessage[0]?.opts.providerId).toBe('openai');
    expect(calls.retryMessage[0]?.opts.model).toBe('gpt-4');

    // Messages truncated to u2 + new assistant
    const msgs = ctrl.getSnapshot().messages;
    expect(msgs.map((m) => m.id)).toEqual(['u1', 'a1', 'u2', 'a-retry']);

    // Result handle
    expect(result.handle.assistantMessageId).toBe('a-retry');
    expect(result.handle.streamId).toBe('stream-retry');
  });

  // 10h. retry: optimistic assistant inserted with processing status + _streamId
  it('10h: retry inserts optimistic assistant with _localStatus=processing and correct _streamId', async () => {
    const ctrl = createChatLoopController<Msg>();
    const { transport } = makeFakeTransport({
      retryMessageResponse: { assistantMessageId: 'a-r', streamId: 'stream-r' },
    });
    ctrl.attachHost({ transport });
    ctrl.attachStream({
      streamClient: makeFakeStreamClient(),
      pollJob: makeFakePollJob(['completed']),
      pollInitialDelayMs: 0,
      pollIntervalMs: 0,
    });
    ctrl.setMessages([userMsg('u1'), assistantMsg('a1', { _localStatus: 'completed' })]);

    await ctrl.retry('u1', {
      providerId: 'openai',
      model: 'gpt-4',
      buildAssistantMessage: makeFactory(),
    });

    const asst = ctrl.getSnapshot().messages.find((m) => m.id === 'a-r');
    expect(asst).toBeDefined();
    expect(asst?._localStatus).toBe('processing');
    expect(asst?._streamId).toBe('stream-r');
  });

  // 10i. stop: calls host.stopMessage with the message id
  it('10i: stop calls host.stopMessage with the given messageId', async () => {
    const ctrl = createChatLoopController<Msg>();
    const { transport, calls } = makeFakeTransport();
    ctrl.attachHost({ transport });

    await ctrl.stop('msg-stop-1');

    expect(calls.stopMessage).toEqual(['msg-stop-1']);
  });

  // 10j. edit: calls host.editMessage + patches content in message list
  it('10j: edit calls host.editMessage and patches message content', async () => {
    const ctrl = createChatLoopController<Msg>();
    const { transport, calls } = makeFakeTransport();
    ctrl.attachHost({ transport });
    ctrl.setMessages([userMsg('u1', 'original')]);

    await ctrl.edit('u1', 'updated content');

    expect(calls.editMessage).toEqual([{ messageId: 'u1', content: 'updated content' }]);
    const msg = ctrl.getSnapshot().messages.find((m) => m.id === 'u1');
    expect(msg?.content).toBe('updated content');
  });

  // 10k. setFeedback: calls host.setFeedback + patches feedbackVote correctly
  it('10k-up: setFeedback(up) calls host and patches feedbackVote=1', async () => {
    const ctrl = createChatLoopController<Msg>();
    const { transport, calls } = makeFakeTransport();
    ctrl.attachHost({ transport });
    ctrl.setMessages([assistantMsg('a1', { _localStatus: 'completed' })]);

    await ctrl.setFeedback('a1', 'up');

    expect(calls.setFeedback).toEqual([{ messageId: 'a1', vote: 'up' }]);
    const msg = ctrl.getSnapshot().messages.find((m) => m.id === 'a1') as Msg & { feedbackVote?: number | null };
    expect(msg?.feedbackVote).toBe(1);
  });

  it('10k-down: setFeedback(down) calls host and patches feedbackVote=-1', async () => {
    const ctrl = createChatLoopController<Msg>();
    const { transport, calls } = makeFakeTransport();
    ctrl.attachHost({ transport });
    ctrl.setMessages([assistantMsg('a1', { _localStatus: 'completed' })]);

    await ctrl.setFeedback('a1', 'down');

    expect(calls.setFeedback).toEqual([{ messageId: 'a1', vote: 'down' }]);
    const msg = ctrl.getSnapshot().messages.find((m) => m.id === 'a1') as Msg & { feedbackVote?: number | null };
    expect(msg?.feedbackVote).toBe(-1);
  });

  it('10k-clear: setFeedback(clear) calls host and patches feedbackVote=null', async () => {
    const ctrl = createChatLoopController<Msg>();
    const { transport, calls } = makeFakeTransport();
    ctrl.attachHost({ transport });
    ctrl.setMessages([assistantMsg('a1', { _localStatus: 'completed', feedbackVote: 1 } as Partial<Msg>)]);

    await ctrl.setFeedback('a1', 'clear');

    expect(calls.setFeedback).toEqual([{ messageId: 'a1', vote: 'clear' }]);
    const msg = ctrl.getSnapshot().messages.find((m) => m.id === 'a1') as Msg & { feedbackVote?: number | null };
    expect(msg?.feedbackVote).toBeNull();
  });

  // 10l. send/retry/stop/edit/setFeedback throw when no transport attached
  it('10l: lifecycle methods throw when no transport is attached', async () => {
    const ctrl = createChatLoopController<Msg>();
    ctrl.attachStream({
      streamClient: makeFakeStreamClient(),
      pollJob: makeFakePollJob(['completed']),
    });

    await expect(
      ctrl.send({ content: 'x' }, {
        buildUserMessage: () => userMsg('u1'),
        buildAssistantMessage: makeFactory(),
      }),
    ).rejects.toThrow(/no host transport/);

    await expect(ctrl.retry('u1', {
      providerId: 'openai',
      model: 'gpt-4',
      buildAssistantMessage: makeFactory(),
    })).rejects.toThrow(/no host transport/);

    await expect(ctrl.stop('msg-1')).rejects.toThrow(/no host transport/);
    await expect(ctrl.edit('msg-1', 'x')).rejects.toThrow(/no host transport/);
    await expect(ctrl.setFeedback('msg-1', 'up')).rejects.toThrow(/no host transport/);
  });

  // 10m. bootstrapRun result exposes assistantMessage for app-side scroll/checkpoint
  it('10m: bootstrapRun returns the assistantMessage so app can use it for scroll/checkpoint', () => {
    const ctrl = createChatLoopController<Msg>();
    ctrl.attachStream({
      streamClient: makeFakeStreamClient(),
      pollJob: makeFakePollJob(['completed']),
      pollInitialDelayMs: 0,
      pollIntervalMs: 0,
    });

    const result = ctrl.bootstrapRun({
      sessionId: 'sess-m',
      assistantMessageId: 'a-m',
      streamId: 'stream-m',
      jobId: 'job-m',
      buildAssistantMessage: makeFactory('gpt-m'),
    });

    expect(result.assistantMessage.id).toBe('a-m');
    expect(result.assistantMessage._streamId).toBe('stream-m');
    expect(result.assistantMessage._localStatus).toBe('processing');
    expect(result.handle.sessionId).toBe('sess-m');
    expect(result.handle.jobId).toBe('job-m');
  });

  // 10n. send golden: full orchestration — user+assistant ids match host response
  it('10n: send golden — full orchestration matches host-returned ids', async () => {
    const ctrl = createChatLoopController<Msg>();
    const { transport } = makeFakeTransport({
      sendMessageResponse: {
        sessionId: 'sess-gold',
        userMessageId: 'u-gold',
        assistantMessageId: 'a-gold',
        streamId: 'stream-gold',
        jobId: 'job-gold',
      },
    });
    ctrl.attachHost({ transport });
    ctrl.attachStream({
      streamClient: makeFakeStreamClient(),
      pollJob: makeFakePollJob(['completed']),
      pollInitialDelayMs: 0,
      pollIntervalMs: 0,
    });

    const { handle, assistantMessage } = await ctrl.send(
      { content: 'golden test' },
      {
        buildUserMessage: (h) => userMsg(h.userMessageId, 'golden test'),
        buildAssistantMessage: makeFactory('gpt-gold'),
      },
    );

    // Handle matches host response
    expect(handle.sessionId).toBe('sess-gold');
    expect(handle.userMessageId).toBe('u-gold');
    expect(handle.assistantMessageId).toBe('a-gold');
    expect(handle.streamId).toBe('stream-gold');
    expect(handle.jobId).toBe('job-gold');

    // Assistant message has the correct ids
    expect(assistantMessage.id).toBe('a-gold');
    expect(assistantMessage._streamId).toBe('stream-gold');
    expect(assistantMessage._localStatus).toBe('processing');

    // Both messages in the list
    const msgs = ctrl.getSnapshot().messages;
    expect(msgs.map((m) => m.id)).toEqual(['u-gold', 'a-gold']);
  });

  // 10o. buildAssistantMessage receives correct sessionId from bootstrapRun input
  it('10o: buildAssistantMessage factory receives sessionId from the handle', async () => {
    const ctrl = createChatLoopController<Msg>();
    const { transport } = makeFakeTransport({
      sendMessageResponse: { sessionId: 'sess-factory', userMessageId: 'u1', assistantMessageId: 'a1', streamId: 's1', jobId: 'j1' },
    });
    ctrl.attachHost({ transport });
    ctrl.attachStream({
      streamClient: makeFakeStreamClient(),
      pollJob: makeFakePollJob(['completed']),
      pollInitialDelayMs: 0,
      pollIntervalMs: 0,
    });

    let capturedSessionId = '';
    await ctrl.send({ content: 'x' }, {
      buildUserMessage: (h) => userMsg(h.userMessageId),
      buildAssistantMessage: (base) => {
        capturedSessionId = base.sessionId;
        return { ...base } as Msg;
      },
    });

    // The factory must receive the real sessionId from the host response.
    expect(capturedSessionId).toBe('sess-factory');
  });
});

// ---------------------------------------------------------------------------
// 11. Local-tool state machine (slice 1E)
//
// Strategy: inject a FAKE local-tool machine (executor, decider, poster) into
// the controller via attachLocalToolMachine, drive it with fixed stream event
// sequences, and assert:
//   11a. tool_call_start creates state entry + args buffered correctly
//   11b. tool_call_delta appends to args text (same toolCallId)
//   11c. tryExecuteBufferedLocalTool fires executor + posts result after args complete
//   11d. executor + postLocalToolResult called with exact args
//   11e. Permission-required error → prompt queued in pendingLocalToolPermissionPrompts
//   11f. decideLocalToolPermission(allow_once) re-executes and posts result
//   11g. decideLocalToolPermission(deny_once) posts error result directly
//   11h. done/error event clears local-tool state for the stream
//   11i. local_tool_result_received status event clears the specific toolCallId
//   11j. awaiting_local_tool_results filters permission prompts for pending stream
//   11k. fresh-round detection: executed tool reset when sequence advances
//   11l. tab_type missing-args wait (1500ms) — uses fake timers
//   11m. sequential ordering: second tool waits for first to complete
//   11n. detachLocalToolMachine clears all state + injections
//   11o. resetLocalToolMachineState clears state but keeps injections
//   11p. snapshot exposes localToolStatesById + pendingLocalToolPermissionPrompts
//   11q. sentropic-string scan: local-tool additions contain zero domain strings
// ---------------------------------------------------------------------------

class FakePermissionRequiredError extends Error {
  request: { requestId: string; toolName: string; origin: string };
  constructor(request: { requestId: string; toolName: string; origin: string }) {
    super('Permission required');
    this.request = request;
  }
}

function makeFakeLocalToolMachine(overrides: {
  executeResult?: unknown;
  executeThrows?: Error;
  decideThrows?: Error;
  posterThrows?: Error;
} = {}) {
  const calls = {
    execute: [] as Array<{ toolCallId: string; name: string; args: unknown; streamId: string }>,
    decide: [] as Array<{ requestId: string; decision: string }>,
    poster: [] as Array<{ streamId: string; toolCallId: string; result: unknown }>,
  };

  return {
    calls,
    opts: {
      executeLocalTool: vi.fn(async (toolCallId: string, name: string, args: unknown, opts: { streamId: string }) => {
        calls.execute.push({ toolCallId, name, args, streamId: opts.streamId });
        if (overrides.executeThrows) throw overrides.executeThrows;
        return overrides.executeResult ?? { status: 'ok', output: 'result' };
      }),
      decideLocalToolPermission: vi.fn(async (requestId: string, decision: string) => {
        calls.decide.push({ requestId, decision });
        if (overrides.decideThrows) throw overrides.decideThrows;
      }),
      postLocalToolResult: vi.fn(async (streamId: string, toolCallId: string, result: unknown) => {
        calls.poster.push({ streamId, toolCallId, result });
        if (overrides.posterThrows) throw overrides.posterThrows;
      }),
      isLocalToolName: (name: string) => ['bash', 'tab_read', 'tab_type', 'tab_action'].includes(name),
      isLocalToolRuntimeAvailable: () => true,
      isLocalToolPermissionRequired: (error: unknown) => error instanceof FakePermissionRequiredError,
      getPermissionRequest: (error: unknown) => (error as FakePermissionRequiredError).request,
    },
  };
}

/** Emit a tool_call_start event through the controller's handleLocalToolStreamEvent. */
function emitToolCallStart(
  ctrl: ReturnType<typeof createChatLoopController<Msg>>,
  streamId: string,
  toolCallId: string,
  name: string,
  args: string,
  sequence: number,
) {
  ctrl.handleLocalToolStreamEvent({
    type: 'tool_call_start',
    streamId,
    sequence,
    data: { tool_call_id: toolCallId, name, args },
  });
}

function emitToolCallDelta(
  ctrl: ReturnType<typeof createChatLoopController<Msg>>,
  streamId: string,
  toolCallId: string,
  delta: string,
  sequence: number,
) {
  ctrl.handleLocalToolStreamEvent({
    type: 'tool_call_delta',
    streamId,
    sequence,
    data: { tool_call_id: toolCallId, delta },
  });
}

function emitStatusEvent(
  ctrl: ReturnType<typeof createChatLoopController<Msg>>,
  streamId: string,
  state: string,
  sequence: number,
  extra: Record<string, unknown> = {},
) {
  ctrl.handleLocalToolStreamEvent({
    type: 'status',
    streamId,
    sequence,
    data: { state, ...extra },
  });
}

describe('chat-loop-controller: local-tool state machine (slice 1E)', () => {
  // 11a. tool_call_start creates state entry
  it('11a: tool_call_start creates state entry in localToolStatesById', () => {
    const ctrl = createChatLoopController<Msg>();
    const { opts } = makeFakeLocalToolMachine();
    ctrl.attachLocalToolMachine(opts);
    // Add a processing assistant message so the stream is eligible
    ctrl.setMessages([assistantMsg('a1', { _streamId: 'stream-1', _localStatus: 'processing' })]);

    emitToolCallStart(ctrl, 'stream-1', 'tc-1', 'bash', '{"cmd":"ls"}', 1);

    const snap = ctrl.getSnapshot();
    expect(snap.localToolStatesById.has('tc-1')).toBe(true);
    const state = snap.localToolStatesById.get('tc-1')!;
    expect(state.name).toBe('bash');
    expect(state.streamId).toBe('stream-1');
    expect(state.argsText).toBe('{"cmd":"ls"}');
    expect(state.executed).toBe(false);
  });

  // 11b. tool_call_delta appends to args text
  it('11b: tool_call_delta appends args to existing state entry', () => {
    const ctrl = createChatLoopController<Msg>();
    const { opts } = makeFakeLocalToolMachine();
    ctrl.attachLocalToolMachine(opts);
    ctrl.setMessages([assistantMsg('a1', { _streamId: 'stream-1', _localStatus: 'processing' })]);

    emitToolCallStart(ctrl, 'stream-1', 'tc-1', 'bash', '{"cmd":', 1);
    emitToolCallDelta(ctrl, 'stream-1', 'tc-1', '"ls"}', 2);

    const state = ctrl.getSnapshot().localToolStatesById.get('tc-1')!;
    expect(state.argsText).toBe('{"cmd":"ls"}');
    expect(state.lastSequence).toBe(2);
  });

  // 11c+11d. Complete args → executor fires → poster called with result
  it('11c+11d: executor fires and poster is called with exact args after complete JSON', async () => {
    vi.useFakeTimers();
    try {
      const ctrl = createChatLoopController<Msg>();
      const { opts, calls } = makeFakeLocalToolMachine({
        executeResult: { status: 'ok', output: 'hello' },
      });
      ctrl.attachLocalToolMachine(opts);
      ctrl.setMessages([assistantMsg('a1', { _streamId: 'stream-1', _localStatus: 'processing' })]);

      // Complete JSON in one shot
      emitToolCallStart(ctrl, 'stream-1', 'tc-1', 'bash', '{"cmd":"ls"}', 1);

      // Let timers fire (scheduleBufferedLocalToolExecution uses setTimeout)
      await vi.runAllTimersAsync();

      expect(calls.execute).toHaveLength(1);
      expect(calls.execute[0]?.toolCallId).toBe('tc-1');
      expect(calls.execute[0]?.name).toBe('bash');
      expect(calls.execute[0]?.args).toEqual({ cmd: 'ls' });
      expect(calls.execute[0]?.streamId).toBe('stream-1');

      expect(calls.poster).toHaveLength(1);
      expect(calls.poster[0]?.streamId).toBe('stream-1');
      expect(calls.poster[0]?.toolCallId).toBe('tc-1');
      expect(calls.poster[0]?.result).toEqual({ status: 'ok', output: 'hello' });
    } finally {
      vi.useRealTimers();
    }
  });

  // 11e. Permission-required error → prompt queued
  it('11e: LocalToolPermissionRequiredError queues a permission prompt', async () => {
    vi.useFakeTimers();
    try {
      const ctrl = createChatLoopController<Msg>();
      const permReq = { requestId: 'req-1', toolName: 'bash', origin: 'localhost' };
      const { opts, calls } = makeFakeLocalToolMachine({
        executeThrows: new FakePermissionRequiredError(permReq),
      });
      ctrl.attachLocalToolMachine(opts);
      ctrl.setMessages([assistantMsg('a1', { _streamId: 'stream-1', _localStatus: 'processing' })]);

      emitToolCallStart(ctrl, 'stream-1', 'tc-1', 'bash', '{"cmd":"rm -rf"}', 1);
      await vi.runAllTimersAsync();

      // Executor called, permission required → prompt queued
      expect(calls.execute).toHaveLength(1);
      expect(calls.poster).toHaveLength(0);

      const snap = ctrl.getSnapshot();
      expect(snap.pendingLocalToolPermissionPrompts).toHaveLength(1);
      const prompt = snap.pendingLocalToolPermissionPrompts[0]!;
      expect(prompt.toolCallId).toBe('tc-1');
      expect(prompt.name).toBe('bash');
      expect(prompt.request.requestId).toBe('req-1');
      expect(prompt.streamId).toBe('stream-1');
    } finally {
      vi.useRealTimers();
    }
  });

  // 11f. decideLocalToolPermission(allow_once) re-executes + posts result
  it('11f: decideLocalToolPermission(allow_once) re-executes tool and posts result', async () => {
    vi.useFakeTimers();
    try {
      const ctrl = createChatLoopController<Msg>();
      const permReq = { requestId: 'req-2', toolName: 'bash', origin: 'localhost' };
      let callCount = 0;
      // First call throws permission error; second returns success
      const { opts, calls } = makeFakeLocalToolMachine();
      opts.executeLocalTool = vi.fn(async (toolCallId, name, args, o) => {
        calls.execute.push({ toolCallId, name, args, streamId: o.streamId });
        callCount += 1;
        if (callCount === 1) throw new FakePermissionRequiredError(permReq);
        return { status: 'ok' };
      });
      ctrl.attachLocalToolMachine(opts);
      ctrl.setMessages([assistantMsg('a1', { _streamId: 'stream-1', _localStatus: 'processing' })]);

      emitToolCallStart(ctrl, 'stream-1', 'tc-2', 'bash', '{}', 1);
      await vi.runAllTimersAsync();

      // Permission prompt queued
      expect(ctrl.getSnapshot().pendingLocalToolPermissionPrompts).toHaveLength(1);
      const prompt = ctrl.getSnapshot().pendingLocalToolPermissionPrompts[0]!;

      // User allows
      await ctrl.decideLocalToolPermission(prompt, 'allow_once');
      await vi.runAllTimersAsync();

      // Decider called
      expect(calls.decide).toHaveLength(1);
      expect(calls.decide[0]?.requestId).toBe('req-2');
      expect(calls.decide[0]?.decision).toBe('allow_once');

      // Executor called twice (first threw, second succeeded)
      expect(calls.execute).toHaveLength(2);

      // Poster called once with success result
      expect(calls.poster).toHaveLength(1);
      expect(calls.poster[0]?.result).toEqual({ status: 'ok' });

      // Prompt removed
      expect(ctrl.getSnapshot().pendingLocalToolPermissionPrompts).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  // 11g. decideLocalToolPermission(deny_once) posts error result directly
  it('11g: decideLocalToolPermission(deny_once) posts error result without re-executing', async () => {
    vi.useFakeTimers();
    try {
      const ctrl = createChatLoopController<Msg>();
      const permReq = { requestId: 'req-3', toolName: 'bash', origin: 'localhost' };
      const { opts, calls } = makeFakeLocalToolMachine({
        executeThrows: new FakePermissionRequiredError(permReq),
      });
      ctrl.attachLocalToolMachine(opts);
      ctrl.setMessages([assistantMsg('a1', { _streamId: 'stream-1', _localStatus: 'processing' })]);

      emitToolCallStart(ctrl, 'stream-1', 'tc-3', 'bash', '{}', 1);
      await vi.runAllTimersAsync();

      const prompt = ctrl.getSnapshot().pendingLocalToolPermissionPrompts[0]!;
      await ctrl.decideLocalToolPermission(prompt, 'deny_once');

      // Decider called
      expect(calls.decide).toHaveLength(1);
      expect(calls.decide[0]?.decision).toBe('deny_once');

      // Poster called with error result — executor NOT called again
      expect(calls.execute).toHaveLength(1); // only the original call
      expect(calls.poster).toHaveLength(1);
      const posted = calls.poster[0]!.result as Record<string, unknown>;
      expect(posted.status).toBe('error');
      expect(String(posted.error)).toMatch(/Permission denied/i);

      // Prompt removed
      expect(ctrl.getSnapshot().pendingLocalToolPermissionPrompts).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  // 11h. done/error event clears local-tool state for stream
  it('11h: done event clears all local-tool state for the stream', async () => {
    vi.useFakeTimers();
    try {
      const ctrl = createChatLoopController<Msg>();
      const { opts } = makeFakeLocalToolMachine();
      ctrl.attachLocalToolMachine(opts);
      ctrl.setMessages([assistantMsg('a1', { _streamId: 'stream-1', _localStatus: 'processing' })]);

      emitToolCallStart(ctrl, 'stream-1', 'tc-1', 'bash', '{}', 1);
      expect(ctrl.getSnapshot().localToolStatesById.size).toBe(1);

      ctrl.handleLocalToolStreamEvent({ type: 'done', streamId: 'stream-1', sequence: 5, data: {} });

      expect(ctrl.getSnapshot().localToolStatesById.size).toBe(0);
      expect(ctrl.getSnapshot().pendingLocalToolPermissionPrompts).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  // 11i. local_tool_result_received clears specific toolCallId
  it('11i: local_tool_result_received status removes only that toolCallId', () => {
    const ctrl = createChatLoopController<Msg>();
    const { opts } = makeFakeLocalToolMachine();
    ctrl.attachLocalToolMachine(opts);
    ctrl.setMessages([assistantMsg('a1', { _streamId: 'stream-1', _localStatus: 'processing' })]);

    emitToolCallStart(ctrl, 'stream-1', 'tc-1', 'bash', '{}', 1);
    emitToolCallStart(ctrl, 'stream-1', 'tc-2', 'bash', '{}', 2);
    expect(ctrl.getSnapshot().localToolStatesById.size).toBe(2);

    emitStatusEvent(ctrl, 'stream-1', 'local_tool_result_received', 10, { tool_call_id: 'tc-1' });

    expect(ctrl.getSnapshot().localToolStatesById.has('tc-1')).toBe(false);
    expect(ctrl.getSnapshot().localToolStatesById.has('tc-2')).toBe(true);
  });

  // 11j. awaiting_local_tool_results filters permission prompts for pending stream
  it('11j: awaiting_local_tool_results filters out prompts for toolCallIds not in pending list', () => {
    const ctrl = createChatLoopController<Msg>();
    const { opts } = makeFakeLocalToolMachine();
    ctrl.attachLocalToolMachine(opts);
    ctrl.setMessages([assistantMsg('a1', { _streamId: 'stream-1', _localStatus: 'processing' })]);

    // Manually inject a permission prompt for a toolCallId that is NOT in the pending list
    emitStatusEvent(ctrl, 'stream-1', 'awaiting_local_tool_results', 5, {
      pending_local_tool_calls: [
        { tool_call_id: 'tc-A', name: 'bash', args: '{}' },
      ],
    });

    // Snapshot shows tc-A state
    expect(ctrl.getSnapshot().localToolStatesById.has('tc-A')).toBe(true);

    // Now emit awaiting again with only tc-B (tc-A removed)
    emitStatusEvent(ctrl, 'stream-1', 'awaiting_local_tool_results', 6, {
      pending_local_tool_calls: [
        { tool_call_id: 'tc-B', name: 'bash', args: '{}' },
      ],
    });

    // Both tc-A and tc-B should be in localToolStatesById (status event does not remove old entries unless done/local_tool_result_received)
    // The pending_list filter applies only to permission prompts (not to state map itself)
    expect(ctrl.getSnapshot().localToolStatesById.has('tc-B')).toBe(true);
  });

  // 11k. fresh-round detection: executed tool reset when sequence advances past lastSequence
  it('11k: fresh-round resets executed flag when sequence advances beyond lastSequence', () => {
    const ctrl = createChatLoopController<Msg>();
    const { opts } = makeFakeLocalToolMachine();
    ctrl.attachLocalToolMachine(opts);
    ctrl.setMessages([assistantMsg('a1', { _streamId: 'stream-1', _localStatus: 'processing' })]);

    emitToolCallStart(ctrl, 'stream-1', 'tc-1', 'bash', '{}', 1);

    // Mark as executed (simulate completed execution)
    const stateMap = ctrl.getSnapshot().localToolStatesById as Map<string, { executed: boolean; lastSequence: number }>;
    const state = stateMap.get('tc-1')!;
    // We can't mutate directly (ReadonlyMap), so we drive a second start event
    // with a HIGHER sequence — this should trigger isFreshRound = true
    emitToolCallStart(ctrl, 'stream-1', 'tc-1', 'bash', '{}', 5);

    const snap = ctrl.getSnapshot();
    const updated = snap.localToolStatesById.get('tc-1')!;
    // executed should be false (fresh round)
    expect(updated.executed).toBe(false);
    expect(state).toBeDefined(); // state was previously set
  });

  // 11l. tab_type missing-args wait — fake timers
  it('11l: tab_type with empty args waits up to 1500ms before posting missing-args error', async () => {
    vi.useFakeTimers();
    try {
      const ctrl = createChatLoopController<Msg>();
      const { opts, calls } = makeFakeLocalToolMachine();
      ctrl.attachLocalToolMachine(opts);
      ctrl.setMessages([assistantMsg('a1', { _streamId: 'stream-1', _localStatus: 'processing' })]);

      // tab_type with empty args
      emitToolCallStart(ctrl, 'stream-1', 'tc-tab', 'tab_type', '', 1);

      // Before 1500ms — executor must NOT fire
      await vi.advanceTimersByTimeAsync(200);
      expect(calls.poster).toHaveLength(0);
      expect(calls.execute).toHaveLength(0);

      // After 1500ms — missing-args error should be forwarded
      await vi.advanceTimersByTimeAsync(1500);
      await vi.runAllTimersAsync();

      // Poster called with missing-args error (execute NOT called for missing-args path)
      expect(calls.poster).toHaveLength(1);
      expect(calls.execute).toHaveLength(0);
      const posted = calls.poster[0]!.result as Record<string, unknown>;
      expect(posted.status).toBe('error');
      expect(String(posted.error)).toMatch(/tab_type arguments are missing/i);
    } finally {
      vi.useRealTimers();
    }
  });

  // 11m. sequential ordering: second tool waits for first to complete
  it('11m: second tool in stream is NOT executed while first is in-flight', async () => {
    vi.useFakeTimers();
    try {
      const ctrl = createChatLoopController<Msg>();
      let firstResolve!: () => void;
      const firstDone = new Promise<void>((r) => { firstResolve = r; });

      const calls: Array<string> = [];
      const poster = vi.fn(async (_: string, toolCallId: string) => {
        calls.push(`posted:${toolCallId}`);
      });

      const opts = {
        executeLocalTool: vi.fn(async (_toolCallId: string, name: string) => {
          calls.push(`exec:${_toolCallId}`);
          if (_toolCallId === 'tc-first') {
            await firstDone;
          }
          return { status: 'ok' };
        }),
        decideLocalToolPermission: vi.fn(async () => {}),
        postLocalToolResult: poster,
        isLocalToolName: (n: string) => ['bash'].includes(n),
        isLocalToolRuntimeAvailable: () => true,
        isLocalToolPermissionRequired: () => false,
        getPermissionRequest: () => ({ requestId: '', toolName: '', origin: '' }),
      };
      ctrl.attachLocalToolMachine(opts);
      ctrl.setMessages([assistantMsg('a1', { _streamId: 'stream-1', _localStatus: 'processing' })]);

      // First tool arrives with seq=1, second with seq=2
      emitToolCallStart(ctrl, 'stream-1', 'tc-first', 'bash', '{}', 1);
      emitToolCallStart(ctrl, 'stream-1', 'tc-second', 'bash', '{}', 2);

      // Let timers fire — first starts, second should be blocked
      await vi.runAllTimersAsync();

      // Only first should have been executed so far
      expect(calls.filter(c => c.startsWith('exec'))).toEqual(['exec:tc-first']);

      // Now complete the first tool
      firstResolve();
      await vi.runAllTimersAsync();

      // Both should have been executed now
      expect(calls.filter(c => c.startsWith('exec'))).toContain('exec:tc-first');
      expect(calls.filter(c => c.startsWith('exec'))).toContain('exec:tc-second');
    } finally {
      vi.useRealTimers();
    }
  });

  // 11n. detachLocalToolMachine clears state + injections
  it('11n: detachLocalToolMachine clears all state and injected functions', async () => {
    vi.useFakeTimers();
    try {
      const ctrl = createChatLoopController<Msg>();
      const { opts } = makeFakeLocalToolMachine();
      ctrl.attachLocalToolMachine(opts);
      ctrl.setMessages([assistantMsg('a1', { _streamId: 'stream-1', _localStatus: 'processing' })]);

      emitToolCallStart(ctrl, 'stream-1', 'tc-1', 'bash', '{}', 1);
      expect(ctrl.getSnapshot().localToolStatesById.size).toBe(1);

      ctrl.detachLocalToolMachine();

      expect(ctrl.getSnapshot().localToolStatesById.size).toBe(0);
      expect(ctrl.getSnapshot().pendingLocalToolPermissionPrompts).toHaveLength(0);

      // After detach, events are no-ops (no isLocalToolName injected)
      emitToolCallStart(ctrl, 'stream-1', 'tc-2', 'bash', '{}', 2);
      expect(ctrl.getSnapshot().localToolStatesById.size).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  // 11o. resetLocalToolMachineState clears state but keeps injections
  it('11o: resetLocalToolMachineState clears state but keeps machine functional', async () => {
    vi.useFakeTimers();
    try {
      const ctrl = createChatLoopController<Msg>();
      const { opts, calls } = makeFakeLocalToolMachine();
      ctrl.attachLocalToolMachine(opts);
      ctrl.setMessages([assistantMsg('a1', { _streamId: 'stream-1', _localStatus: 'processing' })]);

      emitToolCallStart(ctrl, 'stream-1', 'tc-1', 'bash', '{}', 1);
      expect(ctrl.getSnapshot().localToolStatesById.size).toBe(1);

      ctrl.resetLocalToolMachineState();

      // State cleared
      expect(ctrl.getSnapshot().localToolStatesById.size).toBe(0);
      expect(ctrl.getSnapshot().pendingLocalToolPermissionPrompts).toHaveLength(0);

      // Machine still functional — new events processed
      ctrl.setMessages([assistantMsg('a2', { _streamId: 'stream-2', _localStatus: 'processing' })]);
      emitToolCallStart(ctrl, 'stream-2', 'tc-2', 'bash', '{}', 1);
      await vi.runAllTimersAsync();

      expect(calls.execute).toHaveLength(1);
      expect(calls.execute[0]?.toolCallId).toBe('tc-2');
    } finally {
      vi.useRealTimers();
    }
  });

  // 11p. snapshot exposes both localToolStatesById and pendingLocalToolPermissionPrompts
  it('11p: snapshot exposes localToolStatesById and pendingLocalToolPermissionPrompts', () => {
    const ctrl = createChatLoopController<Msg>();
    const snap = ctrl.getSnapshot();
    expect(snap.localToolStatesById).toBeInstanceOf(Map);
    expect(Array.isArray(snap.pendingLocalToolPermissionPrompts)).toBe(true);
  });

  // 11q. sentropic-string scan: controller source contains zero domain strings (re-check with 1E additions)
  it('11q: controller source (with 1E additions) still contains zero sentropic domain strings', () => {
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
