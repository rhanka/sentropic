/**
 * documents/generatedFileCards.test.ts
 *
 * Unit tests for the documents module generated file card helpers.
 */

import { describe, it, expect } from 'vitest';
import {
  normalizeGeneratedFileCard,
  extractGeneratedFileCardsFromRuntimeSummary,
  extractGeneratedFileCardsFromEvents,
  getGeneratedFileFormatLabel,
} from '../src/documents/generatedFileCards.js';
import type { ChatGeneratedFileCard } from '../src/documents/types.js';

// ---------------------------------------------------------------------------
// normalizeGeneratedFileCard
// ---------------------------------------------------------------------------

describe('normalizeGeneratedFileCard', () => {
  it('should default format to docx when missing', () => {
    const card = normalizeGeneratedFileCard({ jobId: 'j1', fileName: 'doc.docx' });
    expect(card.format).toBe('docx');
  });

  it('should lowercase the format', () => {
    const card = normalizeGeneratedFileCard({ jobId: 'j1', fileName: 'slides.pptx', format: 'PPTX' });
    expect(card.format).toBe('pptx');
  });

  it('should omit mimeType when missing', () => {
    const card = normalizeGeneratedFileCard({ jobId: 'j1', fileName: 'x.docx' });
    expect(card.mimeType).toBeUndefined();
  });

  it('should preserve downloadUrl', () => {
    const card = normalizeGeneratedFileCard({
      jobId: 'j1',
      fileName: 'x.docx',
      downloadUrl: 'https://example.com/dl',
    });
    expect(card.downloadUrl).toBe('https://example.com/dl');
  });

  it('should omit downloadUrl when empty string', () => {
    const card = normalizeGeneratedFileCard({ jobId: 'j1', fileName: 'x.docx', downloadUrl: '' });
    expect(card.downloadUrl).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// extractGeneratedFileCardsFromRuntimeSummary
// ---------------------------------------------------------------------------

describe('extractGeneratedFileCardsFromRuntimeSummary', () => {
  it('should return empty array for undefined summary', () => {
    expect(extractGeneratedFileCardsFromRuntimeSummary(undefined)).toHaveLength(0);
  });

  it('should extract from generatedFileCards field', () => {
    const result = extractGeneratedFileCardsFromRuntimeSummary({
      generatedFileCards: [
        { jobId: 'j1', fileName: 'report.docx', format: 'docx' },
      ],
    });
    expect(result).toHaveLength(1);
    expect(result[0].jobId).toBe('j1');
  });

  it('should fall back to docxCards with format=docx', () => {
    const result = extractGeneratedFileCardsFromRuntimeSummary({
      docxCards: [{ jobId: 'j2', fileName: 'old.docx' }],
    });
    expect(result).toHaveLength(1);
    expect(result[0].format).toBe('docx');
  });

  it('should prefer generatedFileCards over docxCards', () => {
    const result = extractGeneratedFileCardsFromRuntimeSummary({
      generatedFileCards: [{ jobId: 'j1', fileName: 'a.docx' }],
      docxCards: [{ jobId: 'j2', fileName: 'b.docx' }],
    });
    expect(result).toHaveLength(1);
    expect(result[0].jobId).toBe('j1');
  });
});

// ---------------------------------------------------------------------------
// extractGeneratedFileCardsFromEvents
// ---------------------------------------------------------------------------

const makeToolStartEvent = (toolCallId: string, name: string) => ({
  eventType: 'tool_call_start',
  data: { tool_call_id: toolCallId, name },
});

const makeToolResultEvent = (
  toolCallId: string,
  result: Record<string, unknown>,
) => ({
  eventType: 'tool_call_result',
  data: { tool_call_id: toolCallId, result },
});

describe('extractGeneratedFileCardsFromEvents', () => {
  it('should return empty array for empty events', () => {
    expect(extractGeneratedFileCardsFromEvents([])).toHaveLength(0);
  });

  it('should extract card from document_generate tool result', () => {
    const events = [
      makeToolStartEvent('tc1', 'document_generate'),
      makeToolResultEvent('tc1', {
        status: 'completed',
        jobId: 'job_abc',
        fileName: 'output.docx',
        format: 'docx',
      }),
    ];
    const result = extractGeneratedFileCardsFromEvents(events);
    expect(result).toHaveLength(1);
    expect(result[0].jobId).toBe('job_abc');
    expect(result[0].fileName).toBe('output.docx');
  });

  it('should ignore results from other tools', () => {
    const events = [
      makeToolStartEvent('tc1', 'web_search'),
      makeToolResultEvent('tc1', {
        status: 'completed',
        jobId: 'job_abc',
        fileName: 'output.docx',
      }),
    ];
    expect(extractGeneratedFileCardsFromEvents(events)).toHaveLength(0);
  });

  it('should ignore results with non-completed status', () => {
    const events = [
      makeToolStartEvent('tc1', 'document_generate'),
      makeToolResultEvent('tc1', {
        status: 'failed',
        jobId: 'job_abc',
        fileName: 'output.docx',
      }),
    ];
    expect(extractGeneratedFileCardsFromEvents(events)).toHaveLength(0);
  });

  it('should support parameterized toolName', () => {
    const events = [
      makeToolStartEvent('tc1', 'my_custom_doc_tool'),
      makeToolResultEvent('tc1', {
        status: 'completed',
        jobId: 'job_xyz',
        fileName: 'custom.pptx',
        format: 'pptx',
      }),
    ];
    const result = extractGeneratedFileCardsFromEvents(events, { toolName: 'my_custom_doc_tool' });
    expect(result).toHaveLength(1);
    expect(result[0].format).toBe('pptx');
  });

  it('should extract multiple cards from multiple tool calls', () => {
    const events = [
      makeToolStartEvent('tc1', 'document_generate'),
      makeToolStartEvent('tc2', 'document_generate'),
      makeToolResultEvent('tc1', { status: 'completed', jobId: 'j1', fileName: 'a.docx' }),
      makeToolResultEvent('tc2', { status: 'completed', jobId: 'j2', fileName: 'b.docx' }),
    ];
    const result = extractGeneratedFileCardsFromEvents(events);
    expect(result).toHaveLength(2);
    expect(result.map((c) => c.jobId)).toEqual(['j1', 'j2']);
  });
});

// ---------------------------------------------------------------------------
// getGeneratedFileFormatLabel
// ---------------------------------------------------------------------------

describe('getGeneratedFileFormatLabel', () => {
  it('should uppercase a format string', () => {
    expect(getGeneratedFileFormatLabel('docx')).toBe('DOCX');
    expect(getGeneratedFileFormatLabel('pptx')).toBe('PPTX');
  });

  it('should return FILE for undefined', () => {
    expect(getGeneratedFileFormatLabel(undefined)).toBe('FILE');
  });

  it('should return FILE for empty string', () => {
    expect(getGeneratedFileFormatLabel('')).toBe('FILE');
  });
});
