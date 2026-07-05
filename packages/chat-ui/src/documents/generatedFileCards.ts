/**
 * @sentropic/chat-ui/documents — generated file card helpers.
 *
 * Moved from ui/src/lib/chat/document-adapter.ts.
 * All functions are parameterized so they contain ZERO sentropic domain strings
 * and ZERO google-drive code.
 *
 * The `toolName` parameter (default: 'document_generate') allows embedders
 * to override the tool name convention without forking this module.
 */

import type { ChatGeneratedFileCard, ChatRuntimeSummaryWithGeneratedFiles } from './types.js';

// ---------------------------------------------------------------------------
// normalizeGeneratedFileCard
// ---------------------------------------------------------------------------

/**
 * Normalize a partial card to a full ChatGeneratedFileCard.
 * Missing format defaults to 'docx'; missing mimeType/downloadUrl -> undefined.
 */
export function normalizeGeneratedFileCard(
  card: Partial<ChatGeneratedFileCard> & Pick<ChatGeneratedFileCard, 'jobId' | 'fileName'>,
): ChatGeneratedFileCard {
  return {
    jobId: card.jobId,
    fileName: card.fileName,
    format:
      typeof card.format === 'string' && card.format.trim().length > 0
        ? card.format.trim().toLowerCase()
        : 'docx',
    mimeType:
      typeof card.mimeType === 'string' && card.mimeType.trim().length > 0
        ? card.mimeType.trim()
        : undefined,
    downloadUrl:
      typeof card.downloadUrl === 'string' && card.downloadUrl.trim().length > 0
        ? card.downloadUrl.trim()
        : undefined,
  };
}

// ---------------------------------------------------------------------------
// extractFromRuntimeSummary
// ---------------------------------------------------------------------------

/**
 * Extract generated file cards from a runtime summary object.
 * Falls back to legacy docxCards field if generatedFileCards is absent.
 */
export function extractGeneratedFileCardsFromRuntimeSummary(
  summary: ChatRuntimeSummaryWithGeneratedFiles | undefined,
): ChatGeneratedFileCard[] {
  if (summary?.generatedFileCards && summary.generatedFileCards.length > 0) {
    return summary.generatedFileCards.map((card) => normalizeGeneratedFileCard(card));
  }
  if (!summary?.docxCards || summary.docxCards.length === 0) return [];
  return summary.docxCards.map((card) =>
    normalizeGeneratedFileCard({ ...card, format: 'docx' }),
  );
}

// ---------------------------------------------------------------------------
// extractFromEvents
// ---------------------------------------------------------------------------

/**
 * Scan a stream event array and extract generated file cards.
 *
 * @param events - Stream events to scan (eventType + data required).
 * @param opts.toolName - Tool name to match (default: 'document_generate').
 */
export function extractGeneratedFileCardsFromEvents(
  events: readonly { eventType: string; data: unknown }[],
  opts?: { toolName?: string },
): ChatGeneratedFileCard[] {
  const targetToolName = opts?.toolName ?? 'document_generate';
  const toolNames: Record<string, string> = {};
  const cards: ChatGeneratedFileCard[] = [];

  for (const event of events) {
    const data = event.data as Record<string, unknown> | null | undefined;

    if (
      event.eventType === 'tool_call_start' &&
      data?.tool_call_id &&
      data?.name
    ) {
      toolNames[String(data.tool_call_id)] = String(data.name);
    }

    if (event.eventType !== 'tool_call_result') continue;
    const toolId = String(data?.tool_call_id ?? '');
    if (toolNames[toolId] !== targetToolName) continue;

    const result = data?.result as Record<string, unknown> | null | undefined;
    if (
      result?.status !== 'completed' ||
      typeof result.jobId !== 'string' ||
      typeof result.fileName !== 'string'
    ) {
      continue;
    }
    cards.push(
      normalizeGeneratedFileCard({
        jobId: result.jobId as string,
        fileName: result.fileName as string,
        format: typeof result.format === 'string' ? result.format : 'docx',
        mimeType: typeof result.mimeType === 'string' ? result.mimeType : undefined,
        downloadUrl:
          typeof result.downloadUrl === 'string' ? result.downloadUrl : undefined,
      }),
    );
  }

  return cards;
}

// ---------------------------------------------------------------------------
// getFormatLabel
// ---------------------------------------------------------------------------

/**
 * Return a human-readable label for a generated file format.
 * Falls back to 'FILE' for missing or empty format strings.
 */
export function getGeneratedFileFormatLabel(
  format: ChatGeneratedFileCard['format'],
): string {
  return typeof format === 'string' && format.trim().length > 0
    ? format.trim().toUpperCase()
    : 'FILE';
}
