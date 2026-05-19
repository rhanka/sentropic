export type ChatSteerFeedback = {
  assistantMessageId: string;
  status: string;
  message: string;
  metadata: Record<string, unknown>;
  submittedAtMs: number;
};

type ChatSteerApiResponse = {
  assistantMessageId?: string | null;
  status?: string | null;
  steer?: {
    message?: string | null;
    metadata?: Record<string, unknown> | null;
  } | null;
};

type ApiPostLike = <T = unknown>(endpoint: string, body?: unknown) => Promise<T>;

type TimelineMessageLike = {
  id: string;
};

const asRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
};

const asString = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
};

export const postChatSteer = async (
  apiPost: ApiPostLike,
  assistantMessageId: string,
  message: string,
): Promise<ChatSteerFeedback> => {
  const normalizedAssistantMessageId = assistantMessageId.trim();
  const normalizedMessage = message.trim();
  if (!normalizedAssistantMessageId) {
    throw new Error('Missing assistant message id');
  }
  if (!normalizedMessage) {
    throw new Error('Missing steer message');
  }

  const response = (await apiPost<ChatSteerApiResponse>(
    `/chat/messages/${encodeURIComponent(normalizedAssistantMessageId)}/steer`,
    {
      message: normalizedMessage,
    },
  )) as ChatSteerApiResponse;

  const responseSteer = asRecord(response?.steer);
  const responseMetadata = asRecord(responseSteer?.metadata) ?? {};

  return {
    assistantMessageId:
      asString(response?.assistantMessageId) ?? normalizedAssistantMessageId,
    status: asString(response?.status) ?? 'unknown',
    message: asString(responseSteer?.message) ?? normalizedMessage,
    metadata: responseMetadata,
    submittedAtMs: Date.now(),
  };
};

export const insertSteerMessageInTimeline = <T extends TimelineMessageLike>(
  timeline: readonly T[],
  steerMessage: T,
  activeAssistantMessageId: string | null,
): T[] => {
  if (!activeAssistantMessageId) {
    return [...timeline, steerMessage];
  }
  const assistantIndex = timeline.findIndex(
    (message) => message.id === activeAssistantMessageId,
  );
  if (assistantIndex === -1) {
    return [...timeline, steerMessage];
  }
  return [
    ...timeline.slice(0, assistantIndex + 1),
    steerMessage,
    ...timeline.slice(assistantIndex + 1),
  ];
};
