import type { ComposerAttachmentSummary } from './chatAttachments.js';

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
  attachments?: ComposerAttachmentSummary;
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
  attachments,
}: ResolveComposerPrimaryActionInput): ComposerPrimaryActionState => {
  if (mode === 'comments') {
    const disabled =
      !hasText(commentInput) ||
      !commentContextType ||
      !commentContextId ||
      !workspaceCanComment ||
      commentThreadResolved;
