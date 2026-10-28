/**
 * A0a rung-1 projection parity tests.
 *
 * Golden SSE event sequences are loaded from fixtures/streams/*.ndjson
 * and run through the published projection helpers:
 *   - projectAssistantRunSegments  (utils/chat-run-projection)
 *   - mergeProjectionHistoryEvents / appendLiveProjectionEvent
 *   - buildProjectedTimeline       (state/chatProjection)
 *   - buildFallbackProjectedSegments
 *
 * These tests are the regression oracle for the A1 extraction (WP-CHAT).
 * They run in --environment node with zero browser/Svelte dependencies.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  projectAssistantRunSegments,
  countLinkedSteerMessages,
  mergeProjectionHistoryEvents,
  appendLiveProjectionEvent,
  type ProjectionStreamEvent,
} from '../src/utils/chat-run-projection.js';

import {
  buildProjectedTimeline,
  buildFallbackProjectedSegments,
  type ChatProjectionMessage,
  type ChatProjectionComputation,
} from '../src/state/chatProjection.js';

// ---------------------------------------------------------------------------
// Fixture loading helpers
// The Makefile runs vitest from /workspace/packages/chat-ui (process.cwd()).
// ---------------------------------------------------------------------------
const FIXTURES_DIR = path.join(process.cwd(), 'tests', 'fixtures', 'streams');

function loadNdjson(filename: string): ProjectionStreamEvent[] {
  const text = fs.readFileSync(path.join(FIXTURES_DIR, filename), 'utf8');
  return text
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as ProjectionStreamEvent);
}

function makeComputation(events: readonly ProjectionStreamEvent[]): ChatProjectionComputation {
  return {
    segments: projectAssistantRunSegments(events),
    linkedSteerCount: countLinkedSteerMessages(events),
  };
}

// ---------------------------------------------------------------------------
// Fixture 1: simple-assistant-response
// status(seq=1) → content_delta(seq=2..4) → done(seq=5)
//
// Observed behavior (golden):
//   - status event → runtime segment
//   - content_delta events → assistant segment
//   - done: trailing runtime removal only fires if LAST segment is runtime
//     and there is at least one assistant segment — not applicable here
//     because the last segment is assistant, not runtime.
//   => 2 segments: [runtime:1, assistant:2]
// ---------------------------------------------------------------------------
describe('projection golden: simple-assistant-response', () => {
  const events = loadNdjson('simple-assistant-response.ndjson');

  it('produces a runtime segment followed by an assistant segment', () => {
    const segments = projectAssistantRunSegments(events);
    expect(segments).toHaveLength(2);
    expect(segments[0].kind).toBe('runtime');
    expect(segments[1].kind).toBe('assistant');
  });

  it('assembles content from content_delta events only', () => {
    const segments = projectAssistantRunSegments(events);
    const assistantSeg = segments.find((s) => s.kind === 'assistant');
    expect(assistantSeg).toBeDefined();
    expect(assistantSeg!.content).toBe('Hello, world!');
  });

  it('runtime segment contains the status event', () => {
    const segments = projectAssistantRunSegments(events);
    const runtimeSeg = segments.find((s) => s.kind === 'runtime');
    expect(runtimeSeg).toBeDefined();
    const eventTypes = runtimeSeg!.events.map((e) => e.eventType);
    expect(eventTypes).toContain('status');
  });

  it('buildProjectedTimeline maps assistant message to runtime-segment + assistant-segment items', () => {
    const msgId = 'msg-simple-1';
    const timeline: ChatProjectionMessage[] = [
      { id: 'msg-user-1', role: 'user', content: 'Hi' },
      {
        id: msgId,
        role: 'assistant',
        content: 'Hello, world!',
        _localStatus: 'completed',
      },
    ];

    const result = buildProjectedTimeline({
      timeline,
      getAssistantComputation: (msg) =>
        msg.id === msgId ? makeComputation(events) : { segments: [], linkedSteerCount: 0 },
    });

    const itemKinds = result.map((item) => item.kind);
    expect(itemKinds).toContain('runtime-segment');
    expect(itemKinds).toContain('assistant-segment');

    const assistantItem = result.find((item) => item.kind === 'assistant-segment');
    expect(assistantItem).toBeDefined();
    if (assistantItem?.kind === 'assistant-segment') {
      expect(assistantItem.segment.content).toBe('Hello, world!');
    }
  });
});

// ---------------------------------------------------------------------------
// Fixture 2: reasoning-then-content
// status(1) → reasoning_delta(2,3) → content_delta(4,5) → done(6)
//
// Observed behavior (golden):
//   - status → runtime segment
//   - reasoning_delta: NOT content_delta → stays in runtime segment
//   - content_delta → new assistant segment (kind changes)
//   - done: last segment is assistant → no trailing runtime removal
//   => 2 segments: [runtime(status+reasoning), assistant(content)]
// ---------------------------------------------------------------------------
describe('projection golden: reasoning-then-content', () => {
  const events = loadNdjson('reasoning-then-content.ndjson');

  it('produces a runtime segment for status+reasoning and an assistant segment for content', () => {
    const segments = projectAssistantRunSegments(events);
    expect(segments).toHaveLength(2);
    const kinds = segments.map((s) => s.kind);
    expect(kinds[0]).toBe('runtime');
    expect(kinds[1]).toBe('assistant');
  });

  it('assistant segment contains only content_delta text', () => {
    const segments = projectAssistantRunSegments(events);
    const assistantSeg = segments.find((s) => s.kind === 'assistant');
    expect(assistantSeg).toBeDefined();
    expect(assistantSeg!.content).toBe('The answer is 42. Here is the explanation.');
  });

  it('runtime segment captures reasoning_delta events', () => {
    const segments = projectAssistantRunSegments(events);
    const runtimeSeg = segments.find((s) => s.kind === 'runtime');
    expect(runtimeSeg).toBeDefined();
    const eventTypes = runtimeSeg!.events.map((e) => e.eventType);
    expect(eventTypes).toContain('reasoning_delta');
  });

  it('segment id encodes kind and start sequence', () => {
    const segments = projectAssistantRunSegments(events);
    for (const seg of segments) {
      expect(seg.id).toMatch(/^(runtime|assistant):\d+$/);
    }
  });

  it('buildProjectedTimeline with reasoning produces runtime-segment + assistant-segment items', () => {
    const msgId = 'msg-reasoning-1';
    const timeline: ChatProjectionMessage[] = [
      { id: 'msg-user-1', role: 'user', content: 'What is 6*7?' },
      {
        id: msgId,
        role: 'assistant',
        content: 'The answer is 42. Here is the explanation.',
        _localStatus: 'completed',
      },
    ];

    const result = buildProjectedTimeline({
      timeline,
      getAssistantComputation: (msg) =>
        msg.id === msgId ? makeComputation(events) : { segments: [], linkedSteerCount: 0 },
    });

    const itemKinds = result.map((item) => item.kind);
    expect(itemKinds).toContain('runtime-segment');
    expect(itemKinds).toContain('assistant-segment');
  });
});

// ---------------------------------------------------------------------------
// Fixture 3: tool-call-and-result
// status(1) → tool_call_start(2) → tool_call_delta(3) → tool_call_result(4) → content_delta(5) → done(6)
//
// Observed behavior (golden):
//   - status + tool events → runtime segment
//   - content_delta → new assistant segment
//   - done: last segment is assistant → no trailing removal
//   => 2 segments: [runtime(status+tool*), assistant(content)]
// ---------------------------------------------------------------------------
describe('projection golden: tool-call-and-result', () => {
  const events = loadNdjson('tool-call-and-result.ndjson');
