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

const trimNonEmpty = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;

const generatedImageDownloadUrl = (documentId: string | undefined): string | undefined =>
  documentId ? `/documents/${encodeURIComponent(documentId)}/content` : undefined;

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
): ChatGeneratedFileCard => {
  const kind = card.kind === 'image' ? 'image' : undefined;
  const documentId = kind === 'image'
    ? trimNonEmpty(card.documentId) ?? trimNonEmpty(card.jobId)
    : trimNonEmpty(card.documentId);
  const rawDownloadUrl = trimNonEmpty(card.downloadUrl);
  const downloadUrl = kind === 'image'
    ? generatedImageDownloadUrl(documentId)
    : rawDownloadUrl;
  const previewUrl = kind === 'image'
    ? downloadUrl
    : trimNonEmpty(card.previewUrl);

  return {
    jobId: card.jobId,
    fileName: card.fileName,
    format:
      kind === 'image'
        ? trimNonEmpty(card.format)?.toLowerCase()
        : trimNonEmpty(card.format)?.toLowerCase() ?? 'docx',
    mimeType: trimNonEmpty(card.mimeType),
    downloadUrl,
    kind,
    documentId,
    previewUrl,
    providerId: trimNonEmpty(card.providerId),
    modelId: trimNonEmpty(card.modelId),
    prompt: trimNonEmpty(card.prompt),
  };
};

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
    const result = event.data?.result;
    const toolName = toolNames[toolId];
    if (toolName === 'document_generate') {
      if (
        result?.status !== 'completed' ||
        !trimNonEmpty(result.jobId) ||
        !trimNonEmpty(result.fileName)
      ) {
        continue;
      }
      cards.push(
        normalizeGeneratedFileCard({
          jobId: result.jobId,
          fileName: result.fileName,
          format: trimNonEmpty(result.format) ?? 'docx',
          mimeType: trimNonEmpty(result.mimeType),
          downloadUrl: trimNonEmpty(result.downloadUrl),
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
        const documentId = trimNonEmpty(item.documentId);
        const fileName = trimNonEmpty(item.fileName);
        if (!documentId || !fileName) continue;
        cards.push(
          normalizeGeneratedFileCard({
            kind: 'image',
            jobId: documentId,
            documentId,
            fileName,
            format: trimNonEmpty(item.format),
            mimeType: trimNonEmpty(item.mimeType),
            providerId: trimNonEmpty(item.providerId),
            modelId: trimNonEmpty(item.modelId),
            prompt: trimNonEmpty(item.prompt),
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
