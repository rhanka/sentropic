import { describe, it, expect } from 'vitest';
import {
  buildAssistantMessageHistoryDetails,
  type ChatHistoryMessage,
  type ChatHistoryStreamEvent,
} from '../../src/services/chat-session-history';

/**
 * Tests for docxCards extraction in chat-session-history runtimeSummary.
 *
 * The buildRuntimeSummary function (internal) scans events for
 * tool_call_start(document_generate) + tool_call_result(completed, jobId, fileName)
 * and populates runtimeSummary.docxCards. We test it via the exported
 * buildAssistantMessageHistoryDetails which applies buildRuntimeSummary
 * to runtime segments.
 */

function makeMessage(overrides: Partial<ChatHistoryMessage> = {}): ChatHistoryMessage {
  return {
    id: 'msg-1',
    sessionId: 'sess-1',
    role: 'assistant',
    content: 'some content',
    ...overrides,
  };
}

function makeToolCallStartEvent(
  seq: number,
  toolCallId: string,
  name: string,
): ChatHistoryStreamEvent {
  return {
    eventType: 'tool_call_start',
    sequence: seq,
    data: { tool_call_id: toolCallId, name },
  };
}

function makeToolCallResultEvent(
  seq: number,
  toolCallId: string,
  result: Record<string, unknown>,
): ChatHistoryStreamEvent {
  return {
    eventType: 'tool_call_result',
    sequence: seq,
    data: { tool_call_id: toolCallId, result },
  };
}

function makeContentDelta(seq: number, delta: string): ChatHistoryStreamEvent {
  return { eventType: 'content_delta', sequence: seq, data: { delta } };
}

function makeDoneEvent(seq: number): ChatHistoryStreamEvent {
  return { eventType: 'done', sequence: seq, data: {} };
}

describe('chat-session-history docxCards extraction', () => {
  it('should extract docxCards when events contain document_generate tool_call_start + completed result', () => {
    const events: ChatHistoryStreamEvent[] = [
      makeToolCallStartEvent(1, 'tc-1', 'document_generate'),
      makeToolCallResultEvent(2, 'tc-1', {
        status: 'completed',
        jobId: 'job-abc',
        fileName: 'report.docx',
        mode: 'freeform',
      }),
      makeContentDelta(3, 'Here is your document.'),
      makeDoneEvent(4),
    ];

    const message = makeMessage();
    const items = buildAssistantMessageHistoryDetails(message, events);

    // Find the runtime segment that should have runtimeSummary with docxCards
    const runtimeSegments = items.filter((item) => item.kind === 'runtime-segment');
    expect(runtimeSegments.length).toBeGreaterThanOrEqual(1);

    const runtimeItem = runtimeSegments[0];
    if (runtimeItem.kind !== 'runtime-segment') throw new Error('unexpected kind');
    const summary = runtimeItem.segment.runtimeSummary;
    expect(summary).toBeDefined();
    expect(summary!.docxCards).toBeDefined();
    expect(summary!.docxCards).toHaveLength(1);
    expect(summary!.docxCards![0]).toEqual({ jobId: 'job-abc', fileName: 'report.docx' });
  });

  it('should return empty/undefined docxCards when no document_generate events exist', () => {
    const events: ChatHistoryStreamEvent[] = [
      makeToolCallStartEvent(1, 'tc-1', 'web_search'),
      makeToolCallResultEvent(2, 'tc-1', {
        status: 'completed',
        results: [],
      }),
      makeContentDelta(3, 'No docs here.'),
      makeDoneEvent(4),
    ];

    const message = makeMessage();
    const items = buildAssistantMessageHistoryDetails(message, events);

    const runtimeSegments = items.filter((item) => item.kind === 'runtime-segment');
    for (const item of runtimeSegments) {
      if (item.kind !== 'runtime-segment') continue;
      const summary = item.segment.runtimeSummary;
      // docxCards should be absent or empty
      if (summary?.docxCards) {
        expect(summary.docxCards).toHaveLength(0);
      }
    }
  });

  it('should extract multiple docxCards from multiple document_generate results', () => {
    const events: ChatHistoryStreamEvent[] = [
      makeToolCallStartEvent(1, 'tc-1', 'document_generate'),
      makeToolCallResultEvent(2, 'tc-1', {
        status: 'completed',
        jobId: 'job-1',
        fileName: 'first.docx',
      }),
      makeToolCallStartEvent(3, 'tc-2', 'document_generate'),
      makeToolCallResultEvent(4, 'tc-2', {
        status: 'completed',
        jobId: 'job-2',
        fileName: 'second.docx',
      }),
      makeContentDelta(5, 'Both documents ready.'),
      makeDoneEvent(6),
    ];

    const message = makeMessage();
    const items = buildAssistantMessageHistoryDetails(message, events);

    // Collect all docxCards across all runtime segments
    const allCards: Array<{ jobId: string; fileName: string }> = [];
    for (const item of items) {
      if (item.kind === 'runtime-segment' && item.segment.runtimeSummary?.docxCards) {
        allCards.push(...item.segment.runtimeSummary.docxCards);
      }
    }

    expect(allCards).toHaveLength(2);
    expect(allCards).toContainEqual({ jobId: 'job-1', fileName: 'first.docx' });
    expect(allCards).toContainEqual({ jobId: 'job-2', fileName: 'second.docx' });
  });

  it('should not extract docxCards for document_generate with error status', () => {
    const events: ChatHistoryStreamEvent[] = [
      makeToolCallStartEvent(1, 'tc-1', 'document_generate'),
      makeToolCallResultEvent(2, 'tc-1', {
        status: 'error',
        code: 'code_syntax_error',
        error: 'SyntaxError: Unexpected token',
      }),
      makeContentDelta(3, 'Generation failed.'),
      makeDoneEvent(4),
    ];

    const message = makeMessage();
    const items = buildAssistantMessageHistoryDetails(message, events);

    const allCards: Array<{ jobId: string; fileName: string }> = [];
    for (const item of items) {
      if (item.kind === 'runtime-segment' && item.segment.runtimeSummary?.docxCards) {
        allCards.push(...item.segment.runtimeSummary.docxCards);
      }
    }

    expect(allCards).toHaveLength(0);
  });
});
