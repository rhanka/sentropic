import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// Pure-function extractions from ChatPanel.svelte generated-file card logic
// These mirror the component-internal helpers for unit testing without
// requiring Svelte component rendering (per project testing policy).
// ---------------------------------------------------------------------------

type GeneratedFileCard = {
  jobId: string;
  fileName: string;
  format: string;
  mimeType?: string;
  downloadUrl?: string;
};
type StreamEvent = { eventType: string; data: any };

/**
 * Scan stream events for document_generate tool calls that completed
 * successfully. Returns detected generated-file cards (mirrors scanEventsForGeneratedFileCards).
 */
function scanEventsForGeneratedFileCards(events: readonly StreamEvent[]): GeneratedFileCard[] {
  const cards: GeneratedFileCard[] = [];
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
        cards.push({
          jobId: ev.data.result.jobId,
          fileName: ev.data.result.fileName,
          format:
            typeof ev.data?.result?.format === 'string' && ev.data.result.format.trim().length > 0
              ? ev.data.result.format
              : 'docx',
          mimeType:
            typeof ev.data?.result?.mimeType === 'string' ? ev.data.result.mimeType : undefined,
          downloadUrl:
            typeof ev.data?.result?.downloadUrl === 'string'
              ? ev.data.result.downloadUrl
              : undefined,
        });
      }
    }
  }

  return cards;
}

/**
 * Dedup logic: add a card to a map only if the jobId is not already present.
 * Mirrors handleGeneratedFileCard dedup behavior.
 */
function addCardWithDedup(
  existing: Map<string, GeneratedFileCard[]>,
  messageId: string,
  card: GeneratedFileCard,
): Map<string, GeneratedFileCard[]> {
  const cards = existing.get(messageId) ?? [];
  if (cards.some((c) => c.jobId === card.jobId)) return existing;
  const updated = new Map(existing);
  updated.set(messageId, [...cards, card]);
  return updated;
}

/**
 * Extract generated-file cards from runtime summary (mirrors extractGeneratedFileCardsFromRuntimeSummary).
 */
function extractGeneratedFileCardsFromRuntimeSummary(
  summary:
    | {
        generatedFileCards?: GeneratedFileCard[];
        docxCards?: Array<{ jobId: string; fileName: string }>;
      }
    | undefined,
): GeneratedFileCard[] {
  if (summary?.generatedFileCards && summary.generatedFileCards.length > 0) {
    return [...summary.generatedFileCards];
  }
  if (!summary?.docxCards || summary.docxCards.length === 0) return [];
  return summary.docxCards.map((card) => ({ ...card, format: 'docx' }));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ChatPanel generated-file card detection', () => {
  describe('scanEventsForGeneratedFileCards', () => {
    it('should detect a completed document_generate tool call and default to docx', () => {
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

      const cards = scanEventsForGeneratedFileCards(events);
      expect(cards).toHaveLength(1);
      expect(cards[0]).toEqual({ jobId: 'job-abc', fileName: 'report.docx', format: 'docx' });
    });

    it('should preserve pptx metadata from completed tool results', () => {
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
              jobId: 'job-pptx',
              fileName: 'deck.pptx',
              format: 'pptx',
              mimeType:
                'application/vnd.openxmlformats-officedocument.presentationml.presentation',
              downloadUrl: '/pptx/jobs/job-pptx/download',
            },
          },
        },
      ];

      const cards = scanEventsForGeneratedFileCards(events);
      expect(cards).toHaveLength(1);
      expect(cards[0]).toEqual({
        jobId: 'job-pptx',
        fileName: 'deck.pptx',
        format: 'pptx',
        mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        downloadUrl: '/pptx/jobs/job-pptx/download',
      });
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

      const cards = scanEventsForGeneratedFileCards(events);
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

      const cards = scanEventsForGeneratedFileCards(events);
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
            result: {
              status: 'completed',
              jobId: 'job-2',
              fileName: 'second.pptx',
              format: 'pptx',
              downloadUrl: '/pptx/jobs/job-2/download',
            },
          },
        },
      ];

      const cards = scanEventsForGeneratedFileCards(events);
      expect(cards).toHaveLength(2);
      expect(cards[0]).toMatchObject({ jobId: 'job-1', format: 'docx' });
      expect(cards[1]).toMatchObject({
        jobId: 'job-2',
        format: 'pptx',
        downloadUrl: '/pptx/jobs/job-2/download',
      });
    });

    it('should return empty array when events is empty', () => {
      expect(scanEventsForGeneratedFileCards([])).toHaveLength(0);
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

      const cards = scanEventsForGeneratedFileCards(events);
      expect(cards).toHaveLength(0);
    });
  });

  describe('dedup logic (addCardWithDedup)', () => {
    it('should add a new card to an empty map', () => {
      const map = new Map<string, GeneratedFileCard[]>();
      const updated = addCardWithDedup(map, 'msg-1', {
        jobId: 'j1',
        fileName: 'a.docx',
        format: 'docx',
      });
      expect(updated.get('msg-1')).toHaveLength(1);
    });

    it('should not add a duplicate card with the same jobId', () => {
      const map = new Map<string, GeneratedFileCard[]>();
      const step1 = addCardWithDedup(map, 'msg-1', {
        jobId: 'j1',
        fileName: 'a.docx',
        format: 'docx',
      });
      const step2 = addCardWithDedup(step1, 'msg-1', {
        jobId: 'j1',
        fileName: 'a.pptx',
        format: 'pptx',
      });
      expect(step2.get('msg-1')).toHaveLength(1);
      // Should return same reference when no change
      expect(step2).toBe(step1);
    });

    it('should add different jobIds to the same message', () => {
      const map = new Map<string, GeneratedFileCard[]>();
      const step1 = addCardWithDedup(map, 'msg-1', {
        jobId: 'j1',
        fileName: 'a.docx',
        format: 'docx',
      });
      const step2 = addCardWithDedup(step1, 'msg-1', {
        jobId: 'j2',
        fileName: 'b.pptx',
        format: 'pptx',
      });
      expect(step2.get('msg-1')).toHaveLength(2);
    });

    it('should keep cards separate per messageId', () => {
      const map = new Map<string, GeneratedFileCard[]>();
      const step1 = addCardWithDedup(map, 'msg-1', {
        jobId: 'j1',
        fileName: 'a.docx',
        format: 'docx',
      });
      const step2 = addCardWithDedup(step1, 'msg-2', {
        jobId: 'j2',
        fileName: 'b.pptx',
        format: 'pptx',
      });
      expect(step2.get('msg-1')).toHaveLength(1);
      expect(step2.get('msg-2')).toHaveLength(1);
    });
  });

  describe('extractGeneratedFileCardsFromRuntimeSummary', () => {
    it('should extract generatedFileCards from runtimeSummary', () => {
      const summary = {
        generatedFileCards: [
          { jobId: 'j1', fileName: 'report.docx', format: 'docx' },
          { jobId: 'j2', fileName: 'summary.pptx', format: 'pptx' },
        ] satisfies GeneratedFileCard[],
      };
      const cards = extractGeneratedFileCardsFromRuntimeSummary(summary);
      expect(cards).toHaveLength(2);
      expect(cards[0]).toMatchObject({ jobId: 'j1', format: 'docx' });
      expect(cards[1]).toMatchObject({ jobId: 'j2', format: 'pptx' });
    });

    it('should return empty array when summary is undefined', () => {
      expect(extractGeneratedFileCardsFromRuntimeSummary(undefined)).toHaveLength(0);
    });

    it('should fall back to legacy docxCards when generatedFileCards are absent', () => {
      const cards = extractGeneratedFileCardsFromRuntimeSummary({
        docxCards: [{ jobId: 'j1', fileName: 'report.docx' }],
      });
      expect(cards).toEqual([{ jobId: 'j1', fileName: 'report.docx', format: 'docx' }]);
    });

    it('should return empty array when both card lists are empty', () => {
      expect(
        extractGeneratedFileCardsFromRuntimeSummary({ generatedFileCards: [], docxCards: [] })
      ).toHaveLength(0);
    });

    it('should return empty array when docxCards is absent', () => {
      expect(extractGeneratedFileCardsFromRuntimeSummary({})).toHaveLength(0);
    });
  });
});
