import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// Pure-function extractions from ChatPanel.svelte docx card logic
// These mirror the component-internal helpers for unit testing without
// requiring Svelte component rendering (per project testing policy).
// ---------------------------------------------------------------------------

type DocxCard = { jobId: string; fileName: string };
type StreamEvent = { eventType: string; data: any };

/**
 * Scan stream events for document_generate tool calls that completed
 * successfully. Returns detected docx cards (mirrors scanEventsForDocxCards).
 */
function scanEventsForDocxCards(events: readonly StreamEvent[]): DocxCard[] {
  const cards: DocxCard[] = [];
  const toolNames: Record<string, string> = {};

  for (const ev of events) {
    if (ev.eventType === 'tool_call_start' && ev.data?.tool_call_id && ev.data?.name) {
      toolNames[ev.data.tool_call_id] = ev.data.name;
    }
    if (ev.eventType === 'tool_call_result') {
      const toolId = String(ev.data?.tool_call_id ?? '');
      const toolName = toolNames[toolId];
      if (
        toolName === 'document_generate' &&
        ev.data?.result?.status === 'completed' &&
        typeof ev.data?.result?.jobId === 'string' &&
        typeof ev.data?.result?.fileName === 'string'
      ) {
        cards.push({ jobId: ev.data.result.jobId, fileName: ev.data.result.fileName });
      }
    }
  }

  return cards;
}

/**
 * Dedup logic: add a card to a map only if the jobId is not already present.
 * Mirrors handleDocxDownload dedup behavior.
 */
function addCardWithDedup(
  existing: Map<string, DocxCard[]>,
  messageId: string,
  card: DocxCard,
): Map<string, DocxCard[]> {
  const cards = existing.get(messageId) ?? [];
  if (cards.some((c) => c.jobId === card.jobId)) return existing;
  const updated = new Map(existing);
  updated.set(messageId, [...cards, card]);
  return updated;
}

/**
 * Extract docx cards from runtime summary (mirrors extractDocxCardsFromRuntimeSummary).
 */
function extractDocxCardsFromRuntimeSummary(
  summary: { docxCards?: DocxCard[] } | undefined,
): DocxCard[] {
  if (!summary?.docxCards || summary.docxCards.length === 0) return [];
  return [...summary.docxCards];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ChatPanel docx card detection', () => {
  describe('scanEventsForDocxCards', () => {
    it('should detect a completed document_generate tool call', () => {
      const events: StreamEvent[] = [
        {
          eventType: 'tool_call_start',
          data: { tool_call_id: 'tc-1', name: 'document_generate' },
        },
        {
          eventType: 'tool_call_result',
          data: {
            tool_call_id: 'tc-1',
            result: {
              status: 'completed',
              jobId: 'job-abc',
              fileName: 'report.docx',
            },
          },
        },
      ];

      const cards = scanEventsForDocxCards(events);
      expect(cards).toHaveLength(1);
      expect(cards[0]).toEqual({ jobId: 'job-abc', fileName: 'report.docx' });
    });

    it('should not detect non-document_generate tools', () => {
      const events: StreamEvent[] = [
        {
          eventType: 'tool_call_start',
          data: { tool_call_id: 'tc-1', name: 'web_search' },
        },
        {
          eventType: 'tool_call_result',
          data: {
            tool_call_id: 'tc-1',
            result: { status: 'completed', results: [] },
          },
        },
      ];

      const cards = scanEventsForDocxCards(events);
      expect(cards).toHaveLength(0);
    });

    it('should not detect document_generate with error status', () => {
      const events: StreamEvent[] = [
        {
          eventType: 'tool_call_start',
          data: { tool_call_id: 'tc-1', name: 'document_generate' },
        },
        {
          eventType: 'tool_call_result',
          data: {
            tool_call_id: 'tc-1',
            result: {
              status: 'error',
              code: 'code_syntax_error',
              error: 'SyntaxError',
            },
          },
        },
      ];

      const cards = scanEventsForDocxCards(events);
      expect(cards).toHaveLength(0);
    });

    it('should detect multiple document_generate calls in the same stream', () => {
      const events: StreamEvent[] = [
        {
          eventType: 'tool_call_start',
          data: { tool_call_id: 'tc-1', name: 'document_generate' },
        },
        {
          eventType: 'tool_call_result',
          data: {
            tool_call_id: 'tc-1',
            result: { status: 'completed', jobId: 'job-1', fileName: 'first.docx' },
          },
        },
        {
          eventType: 'tool_call_start',
          data: { tool_call_id: 'tc-2', name: 'document_generate' },
        },
        {
          eventType: 'tool_call_result',
          data: {
            tool_call_id: 'tc-2',
            result: { status: 'completed', jobId: 'job-2', fileName: 'second.docx' },
          },
        },
      ];

      const cards = scanEventsForDocxCards(events);
      expect(cards).toHaveLength(2);
      expect(cards[0].jobId).toBe('job-1');
      expect(cards[1].jobId).toBe('job-2');
    });

    it('should return empty array when events is empty', () => {
      expect(scanEventsForDocxCards([])).toHaveLength(0);
    });

    it('should skip result events with missing jobId or fileName', () => {
      const events: StreamEvent[] = [
        {
          eventType: 'tool_call_start',
          data: { tool_call_id: 'tc-1', name: 'document_generate' },
        },
        {
          eventType: 'tool_call_result',
          data: {
            tool_call_id: 'tc-1',
            result: { status: 'completed' },
          },
        },
      ];

      const cards = scanEventsForDocxCards(events);
      expect(cards).toHaveLength(0);
    });
  });

  describe('dedup logic (addCardWithDedup)', () => {
    it('should add a new card to an empty map', () => {
      const map = new Map<string, DocxCard[]>();
      const updated = addCardWithDedup(map, 'msg-1', { jobId: 'j1', fileName: 'a.docx' });
      expect(updated.get('msg-1')).toHaveLength(1);
    });

    it('should not add a duplicate card with the same jobId', () => {
      const map = new Map<string, DocxCard[]>();
      const step1 = addCardWithDedup(map, 'msg-1', { jobId: 'j1', fileName: 'a.docx' });
      const step2 = addCardWithDedup(step1, 'msg-1', { jobId: 'j1', fileName: 'a.docx' });
      expect(step2.get('msg-1')).toHaveLength(1);
      // Should return same reference when no change
      expect(step2).toBe(step1);
    });

    it('should add different jobIds to the same message', () => {
      const map = new Map<string, DocxCard[]>();
      const step1 = addCardWithDedup(map, 'msg-1', { jobId: 'j1', fileName: 'a.docx' });
      const step2 = addCardWithDedup(step1, 'msg-1', { jobId: 'j2', fileName: 'b.docx' });
      expect(step2.get('msg-1')).toHaveLength(2);
    });

    it('should keep cards separate per messageId', () => {
      const map = new Map<string, DocxCard[]>();
      const step1 = addCardWithDedup(map, 'msg-1', { jobId: 'j1', fileName: 'a.docx' });
      const step2 = addCardWithDedup(step1, 'msg-2', { jobId: 'j2', fileName: 'b.docx' });
      expect(step2.get('msg-1')).toHaveLength(1);
      expect(step2.get('msg-2')).toHaveLength(1);
    });
  });

  describe('extractDocxCardsFromRuntimeSummary', () => {
    it('should extract cards from runtimeSummary with docxCards', () => {
      const summary = {
        docxCards: [
          { jobId: 'j1', fileName: 'report.docx' },
          { jobId: 'j2', fileName: 'summary.docx' },
        ],
      };
      const cards = extractDocxCardsFromRuntimeSummary(summary);
      expect(cards).toHaveLength(2);
      expect(cards[0].jobId).toBe('j1');
    });

    it('should return empty array when summary is undefined', () => {
      expect(extractDocxCardsFromRuntimeSummary(undefined)).toHaveLength(0);
    });

    it('should return empty array when docxCards is empty', () => {
      expect(extractDocxCardsFromRuntimeSummary({ docxCards: [] })).toHaveLength(0);
    });

    it('should return empty array when docxCards is absent', () => {
      expect(extractDocxCardsFromRuntimeSummary({})).toHaveLength(0);
    });
  });
});
