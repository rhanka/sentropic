const encodePathSegment = (value: string): string => encodeURIComponent(value);

export const chatSessionsUrl = (): string => '/chat/sessions';

export const chatSessionUrl = (sessionId: string): string =>
  `/chat/sessions/${encodePathSegment(sessionId)}`;

export const chatSessionHistoryUrl = (
  sessionId: string,
  runtimeDetails: 'summary' | 'full',
): string =>
  `${chatSessionUrl(sessionId)}/history?runtimeDetails=${encodeURIComponent(runtimeDetails)}`;

export const chatSessionCheckpointsUrl = (
  sessionId: string,
  limit = 20,
): string => `${chatSessionUrl(sessionId)}/checkpoints?limit=${limit}`;

export const chatSessionCheckpointCreateUrl = (sessionId: string): string =>
  `${chatSessionUrl(sessionId)}/checkpoints`;

export const chatSessionCheckpointRestoreUrl = (
  sessionId: string,
  checkpointId: string,
): string =>
  `${chatSessionCheckpointCreateUrl(sessionId)}/${encodePathSegment(checkpointId)}/restore`;

export const chatMessagesUrl = (): string => '/chat/messages';

export const chatMessageUrl = (messageId: string): string =>
  `/chat/messages/${encodePathSegment(messageId)}`;

export const chatMessageRuntimeDetailsUrl = (messageId: string): string =>
  `${chatMessageUrl(messageId)}/runtime-details`;

export const chatMessageRetryUrl = (messageId: string): string =>
  `${chatMessageUrl(messageId)}/retry`;

export const chatMessageStopUrl = (messageId: string): string =>
  `${chatMessageUrl(messageId)}/stop`;

export const chatMessageFeedbackUrl = (messageId: string): string =>
  `${chatMessageUrl(messageId)}/feedback`;

export const chatMessageToolResultsUrl = (messageId: string): string =>
  `${chatMessageUrl(messageId)}/tool-results`;

export const formatChatApiError = (
  error: unknown,
  fallback: string,
): string => {
  if (!error || typeof error !== 'object') return fallback;
  const record = error as { status?: unknown; message?: unknown };
  const status =
    typeof record.status === 'number'
      ? record.status
      : typeof record.status === 'string'
        ? Number(record.status)
        : Number.NaN;
  const message =
    typeof record.message === 'string' && record.message.trim().length > 0
      ? record.message
      : '';
  if (!message || !Number.isFinite(status)) return fallback;
  return status > 0 ? `HTTP ${status}: ${message}` : message;
};
