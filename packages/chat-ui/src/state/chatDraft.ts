export type ChatDraftMode = 'ai' | 'comments';

export type ChatDraftState = {
  draft: string;
  input: string;
  lastDraftApplied: string;
};

export type SyncDraftInput = ChatDraftState & {
  mode: ChatDraftMode;
  direction: 'external' | 'input';
};

export type ComposerPrimaryAction =
  | 'comment_send'
  | 'chat_send'
  | 'steer_send'
  | 'disabled';

export type ComposerPrimaryActionState = {
  action: ComposerPrimaryAction;
  disabled: boolean;
  displayMode: 'send' | 'steer';
};

export type ResolveComposerPrimaryActionInput = {
  mode: ChatDraftMode;
  input: string;
  commentInput: string;
  commentContextType?: string | null;
  commentContextId?: string | null;
  workspaceCanComment: boolean;
  commentThreadResolved: boolean;
  sending: boolean;
  composerRunInFlight: boolean;
  composerSteerReady: boolean;
  composerSteerInFlight: boolean;
};

export type ComposerHeightInput = {
  baseHeight: number;
  containerHeight: number;
  contentHeight: number;
  wasMultiline: boolean;
};

export type ComposerHeightState = {
  maxHeight: number;
  isMultiline: boolean;
  shouldRemeasure: boolean;
};

export type OptimisticSteerMessage = {
  id: string;
  sessionId: string;
  role: 'user';
  content: string;
  createdAt: string;
  _localStatus: 'completed';
  _optimisticSteerTargetAssistantId: string;
  _optimisticSteerSubmittedAtMs: number;
};

export type CreateOptimisticSteerMessageInput = {
  sessionId: string;
  content: string;
  targetAssistantMessageId?: string | null;
  targetStreamId: string;
  nowMs: number;
  nowIso: string;
};

export type ComposerSteerAck = {
  streamId: string;
  message: string;
  createdAtMs: number;
};

const hasText = (value: string): boolean => value.trim().length > 0;

export const syncDraftFromInput = ({
  mode,
  direction,
  draft,
  input,
  lastDraftApplied,
}: SyncDraftInput): ChatDraftState => {
  if (direction === 'external') {
    if (draft !== lastDraftApplied && draft !== input) {
      return { draft, input: draft, lastDraftApplied: draft };
    }
    return { draft, input, lastDraftApplied };
  }

  if (mode !== 'ai' || draft === input) {
    return { draft, input, lastDraftApplied };
  }
  return { draft: input, input, lastDraftApplied: input };
};

export const shouldShowSteerAction = ({
  composerRunInFlight,
}: {
  composerRunInFlight: boolean;
}): boolean => composerRunInFlight;

export const resolveComposerPrimaryAction = ({
  mode,
  input,
  commentInput,
  commentContextType,
  commentContextId,
  workspaceCanComment,
  commentThreadResolved,
  sending,
  composerRunInFlight,
  composerSteerReady,
  composerSteerInFlight,
}: ResolveComposerPrimaryActionInput): ComposerPrimaryActionState => {
  if (mode === 'comments') {
    const disabled =
      !hasText(commentInput) ||
      !commentContextType ||
      !commentContextId ||
      !workspaceCanComment ||
      commentThreadResolved;
    return {
      action: disabled ? 'disabled' : 'comment_send',
      disabled,
      displayMode: 'send',
    };
  }

  const displayMode = shouldShowSteerAction({ composerRunInFlight })
    ? 'steer'
    : 'send';
  if (composerRunInFlight) {
    const disabled = !composerSteerReady || composerSteerInFlight || !hasText(input);
    return {
      action: disabled ? 'disabled' : 'steer_send',
      disabled,
      displayMode,
    };
  }

  const disabled = sending || !hasText(input);
  return {
    action: disabled ? 'disabled' : 'chat_send',
    disabled,
    displayMode,
  };
};

export const resolveComposerHeightState = ({
  baseHeight,
  containerHeight,
  contentHeight,
  wasMultiline,
}: ComposerHeightInput): ComposerHeightState => {
  const safeBaseHeight =
    Number.isFinite(baseHeight) && baseHeight > 0 ? baseHeight : 40;
  const safeContainerHeight =
    Number.isFinite(containerHeight) && containerHeight > 0
      ? containerHeight
      : 0;
  const safeContentHeight =
    Number.isFinite(contentHeight) && contentHeight > 0
      ? contentHeight
      : safeBaseHeight;
  const maxHeight = Math.max(
    safeBaseHeight,
    Math.floor(safeContainerHeight * 0.3),
  );
  const isMultiline = safeContentHeight > safeBaseHeight + 2;
  return {
    maxHeight,
    isMultiline,
    shouldRemeasure: isMultiline !== wasMultiline,
  };
};

export const createOptimisticSteerMessage = ({
  sessionId,
  content,
  targetAssistantMessageId,
  targetStreamId,
  nowMs,
  nowIso,
}: CreateOptimisticSteerMessageInput): OptimisticSteerMessage => ({
  id: `local_steer_${nowMs}`,
  sessionId,
  role: 'user',
  content,
  createdAt: nowIso,
  _localStatus: 'completed',
  _optimisticSteerTargetAssistantId: targetAssistantMessageId ?? targetStreamId,
  _optimisticSteerSubmittedAtMs: nowMs,
});

export const createComposerSteerAck = ({
  streamId,
  message,
  createdAtMs,
}: ComposerSteerAck): ComposerSteerAck => ({
  streamId,
  message,
  createdAtMs,
});

export const shouldClearComposerSteerAck = (
  current: ComposerSteerAck | null,
  expectedCreatedAtMs: number | null | undefined,
): boolean =>
  current !== null &&
  expectedCreatedAtMs !== null &&
  expectedCreatedAtMs !== undefined &&
  current.createdAtMs === expectedCreatedAtMs;
