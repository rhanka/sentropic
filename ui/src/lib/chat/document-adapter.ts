export type ChatGeneratedFileCard = {
  jobId: string;
  fileName: string;
  format?: string;
  mimeType?: string;
  downloadUrl?: string;
  kind?: 'file' | 'image';
  documentId?: string;
  previewUrl?: string;
  providerId?: string;
  modelId?: string;
  prompt?: string;
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
    card.kind === 'image'
      ? typeof card.format === 'string' && card.format.trim().length > 0
        ? card.format.trim().toLowerCase()
        : undefined
      : typeof card.format === 'string' && card.format.trim().length > 0
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
  kind: card.kind === 'image' ? 'image' : undefined,
  documentId:
    typeof card.documentId === 'string' && card.documentId.trim().length > 0
      ? card.documentId.trim()
      : undefined,
  previewUrl:
    typeof card.previewUrl === 'string' && card.previewUrl.trim().length > 0
      ? card.previewUrl.trim()
      : undefined,
  providerId:
    typeof card.providerId === 'string' && card.providerId.trim().length > 0
      ? card.providerId.trim()
      : undefined,
  modelId:
    typeof card.modelId === 'string' && card.modelId.trim().length > 0
      ? card.modelId.trim()
      : undefined,
  prompt:
    typeof card.prompt === 'string' && card.prompt.trim().length > 0
      ? card.prompt.trim()
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
  const trim = (value: unknown): string | undefined =>
    typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;

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
    const result = event.data?.result;
    const toolName = toolNames[toolId];
    if (toolName === 'document_generate') {
      if (
        result?.status !== 'completed' ||
        !trim(result.jobId) ||
        !trim(result.fileName)
      ) {
        continue;
      }
      cards.push(
        normalizeGeneratedFileCard({
          jobId: result.jobId,
          fileName: result.fileName,
          format: trim(result.format) ?? 'docx',
          mimeType: trim(result.mimeType),
          downloadUrl: trim(result.downloadUrl),
        }),
      );
      continue;
    }
    if (toolName === 'image_generate') {
      if (result?.status !== 'completed') continue;
      const media = Array.isArray(result.media) ? result.media : [];
      for (const rawItem of media) {
        if (!rawItem || typeof rawItem !== 'object') continue;
        const item = rawItem as Record<string, unknown>;
        const documentId = trim(item.documentId);
        const fileName = trim(item.fileName);
        const downloadUrl = trim(item.downloadUrl);
        if (!documentId || !fileName) continue;
        cards.push(
          normalizeGeneratedFileCard({
            kind: 'image',
            jobId: documentId,
            documentId,
            fileName,
            format: trim(item.format),
            mimeType: trim(item.mimeType),
            downloadUrl,
            previewUrl: downloadUrl,
            providerId: trim(item.providerId),
            modelId: trim(item.modelId),
            prompt: trim(item.prompt),
          }),
        );
      }
    }
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
