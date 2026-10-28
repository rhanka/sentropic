import {
  summarizeComposerAttachments,
  type ChatComposerAttachmentDraft,
  type ComposerAttachmentSummary,
} from './chatAttachments.js';
import { syncDraftFromInput, type ChatDraftState } from './chatDraft.js';
import {
  createChatLoopController,
