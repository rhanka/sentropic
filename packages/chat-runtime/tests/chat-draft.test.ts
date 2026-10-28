import { describe, expect, it } from 'vitest';
import {
  createComposerSteerAck,
  createOptimisticSteerMessage,
  resolveComposerHeightState,
  resolveComposerPrimaryAction,
  shouldClearComposerSteerAck,
  shouldShowSteerAction,
  syncDraftFromInput,
  isAssistantMessageInProgress,
  resolveComposerSteerState,
} from '../src/state/chatDraft.js';

describe('chat draft and composer state', () => {
  it('syncs external drafts into input and input edits back into draft', () => {
    expect(
      syncDraftFromInput({
        mode: 'ai',
        draft: 'external',
        input: 'old',
        lastDraftApplied: 'previous',
        direction: 'external',
      }),
    ).toEqual({
      draft: 'external',
      input: 'external',
      lastDraftApplied: 'external',
    });

    expect(
      syncDraftFromInput({
        mode: 'ai',
        draft: 'old',
        input: 'typed',
        lastDraftApplied: 'old',
        direction: 'input',
      }),
    ).toEqual({
      draft: 'typed',
      input: 'typed',
      lastDraftApplied: 'typed',
    });

    expect(
      syncDraftFromInput({
        mode: 'comments',
        draft: 'old',
        input: 'typed',
        lastDraftApplied: 'old',
        direction: 'input',
      }),
    ).toEqual({
      draft: 'old',
      input: 'typed',
      lastDraftApplied: 'old',
    });
  });

  it('selects the composer primary action and disabled state', () => {
    expect(
      resolveComposerPrimaryAction({
        mode: 'comments',
        input: 'ignored',
        commentInput: 'ok',
        commentContextType: 'initiative',
        commentContextId: 'i1',
        workspaceCanComment: true,
        commentThreadResolved: false,
        sending: false,
        composerRunInFlight: false,
        composerSteerReady: false,
        composerSteerInFlight: false,
      }),
    ).toEqual({ action: 'comment_send', disabled: false, displayMode: 'send' });

    expect(
      resolveComposerPrimaryAction({
        mode: 'ai',
        input: 'steer',
        commentInput: '',
        commentContextType: null,
        commentContextId: null,
        workspaceCanComment: true,
        commentThreadResolved: false,
        sending: false,
        composerRunInFlight: true,
        composerSteerReady: true,
        composerSteerInFlight: false,
      }),
    ).toEqual({ action: 'steer_send', disabled: false, displayMode: 'steer' });

    expect(
      resolveComposerPrimaryAction({
        mode: 'ai',
        input: ' ',
        commentInput: '',
        commentContextType: null,
        commentContextId: null,
        workspaceCanComment: true,
        commentThreadResolved: false,
        sending: false,
        composerRunInFlight: false,
        composerSteerReady: false,
        composerSteerInFlight: false,
      }),
    ).toEqual({ action: 'disabled', disabled: true, displayMode: 'send' });

    expect(
      resolveComposerPrimaryAction({
        mode: 'ai',
        input: ' ',
        commentInput: '',
        commentContextType: null,
        commentContextId: null,
        workspaceCanComment: true,
        commentThreadResolved: false,
        sending: false,
        composerRunInFlight: false,
        composerSteerReady: false,
        composerSteerInFlight: false,
        attachments: {
          total: 1,
          ready: 1,
          pending: 0,
          uploading: 0,
          failed: 0,
          images: 1,
        },
      }),
    ).toEqual({ action: 'chat_send', disabled: false, displayMode: 'send' });

    expect(
      resolveComposerPrimaryAction({
        mode: 'ai',
        input: ' ',
        commentInput: '',
        commentContextType: null,
        commentContextId: null,
        workspaceCanComment: true,
        commentThreadResolved: false,
        sending: false,
        composerRunInFlight: false,
        composerSteerReady: false,
        composerSteerInFlight: false,
        attachments: {
          total: 1,
          ready: 0,
          pending: 0,
          uploading: 1,
          failed: 0,
          images: 1,
        },
      }),
    ).toEqual({ action: 'disabled', disabled: true, displayMode: 'send' });
  });

  it('computes composer height state without reading the DOM', () => {
    expect(
      resolveComposerHeightState({
        baseHeight: 40,
        containerHeight: 300,
        contentHeight: 96,
        wasMultiline: false,
      }),
    ).toEqual({
      maxHeight: 90,
      isMultiline: true,
      shouldRemeasure: true,
    });

    expect(
      resolveComposerHeightState({
        baseHeight: 40,
        containerHeight: 0,
        contentHeight: 0,
        wasMultiline: false,
      }),
    ).toEqual({
      maxHeight: 40,
      isMultiline: false,
      shouldRemeasure: false,
    });
  });

  it('creates optimistic steer messages and acknowledgement timeout state', () => {
