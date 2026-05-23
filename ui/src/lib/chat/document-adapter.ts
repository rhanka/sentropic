export type ChatGeneratedFileCard = {
  jobId: string;
  fileName: string;
  format?: string;
  mimeType?: string;
  downloadUrl?: string;
};

export type ChatRuntimeSummaryWithGeneratedFiles = {
  generatedFileCards?: Array<
    Partial<ChatGeneratedFileCard> & Pick<ChatGeneratedFileCard, 'jobId' | 'fileName'>
  >;
  docxCards?: Array<Pick<ChatGeneratedFileCard, 'jobId' | 'fileName'>>;
};

export type ChatSessionDocumentContext = {
  contextType: 'chat_session';
  contextId: string;
  workspaceId?: string | null;
};

export const createChatSessionDocumentContext = (
  sessionId: string,
  workspaceId?: string | null,
): ChatSessionDocumentContext => ({
  contextType: 'chat_session',
  contextId: sessionId,
  workspaceId,
});

export const createChatSessionCreatePayload = (
  context:
    | { primaryContextType?: string | null; primaryContextId?: string | null }
    | null
    | undefined,
): { primaryContextType?: string | null; primaryContextId?: string | null } => ({
  primaryContextType: context?.primaryContextType,
  primaryContextId: context?.primaryContextId,
});

export const createGoogleDriveChatAttachInput = (
  sessionId: string,
  fileIds: readonly string[],
): {
  contextType: 'chat_session';
  contextId: string;
  fileIds: string[];
} => ({
  contextType: 'chat_session',
  contextId: sessionId,
  fileIds: [...fileIds],
});

export const normalizeGeneratedFileCard = (
  card: Partial<ChatGeneratedFileCard> & Pick<ChatGeneratedFileCard, 'jobId' | 'fileName'>,
): ChatGeneratedFileCard => ({
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
});

export const extractGeneratedFileCardsFromRuntimeSummary = (
  summary: ChatRuntimeSummaryWithGeneratedFiles | undefined,
): ChatGeneratedFileCard[] => {
  if (summary?.generatedFileCards && summary.generatedFileCards.length > 0) {
    return summary.generatedFileCards.map((card) => normalizeGeneratedFileCard(card));
  }
  if (!summary?.docxCards || summary.docxCards.length === 0) return [];
  return summary.docxCards.map((card) =>
    normalizeGeneratedFileCard({ ...card, format: 'docx' }),
  );
};

export const extractGeneratedFileCardsFromEvents = (
  events: readonly { eventType: string; data: any }[],
): ChatGeneratedFileCard[] => {
  const toolNames: Record<string, string> = {};
  const cards: ChatGeneratedFileCard[] = [];

  for (const event of events) {
    if (
      event.eventType === 'tool_call_start' &&
      event.data?.tool_call_id &&
      event.data?.name
    ) {
      toolNames[String(event.data.tool_call_id)] = String(event.data.name);
    }

    if (event.eventType !== 'tool_call_result') continue;
    const toolId = String(event.data?.tool_call_id ?? '');
    if (toolNames[toolId] !== 'document_generate') continue;
    const result = event.data?.result;
    if (
      result?.status !== 'completed' ||
      typeof result.jobId !== 'string' ||
      typeof result.fileName !== 'string'
    ) {
      continue;
    }
    cards.push(
      normalizeGeneratedFileCard({
        jobId: result.jobId,
        fileName: result.fileName,
        format: typeof result.format === 'string' ? result.format : 'docx',
        mimeType: typeof result.mimeType === 'string' ? result.mimeType : undefined,
        downloadUrl:
          typeof result.downloadUrl === 'string' ? result.downloadUrl : undefined,
      }),
    );
  }

  return cards;
};

export const getGeneratedFileFormatLabel = (
  format: ChatGeneratedFileCard['format'],
): string =>
  typeof format === 'string' && format.trim().length > 0
    ? format.trim().toUpperCase()
    : 'FILE';

export const getSessionDocumentStatusLabelKey = (status: string): string => {
  if (status === 'uploaded') return 'chat.documents.status.uploaded';
  if (status === 'processing') return 'chat.documents.status.processing';
  if (status === 'ready') return 'chat.documents.status.ready';
  if (status === 'failed') return 'chat.documents.status.failed';
  return 'chat.documents.status.unknown';
};
