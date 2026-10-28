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
    const message = createOptimisticSteerMessage({
      sessionId: 's1',
      content: 'adjust',
      targetAssistantMessageId: 'a1',
      targetStreamId: 'stream1',
      nowMs: 123,
      nowIso: '2026-05-20T00:00:00.000Z',
    });

    expect(message).toEqual({
      id: 'local_steer_123',
      sessionId: 's1',
      role: 'user',
      content: 'adjust',
      createdAt: '2026-05-20T00:00:00.000Z',
      _localStatus: 'completed',
      _optimisticSteerTargetAssistantId: 'a1',
      _optimisticSteerSubmittedAtMs: 123,
    });

    const ack = createComposerSteerAck({
      streamId: 'stream1',
      message: 'Queued',
      createdAtMs: 123,
    });
    expect(shouldClearComposerSteerAck(ack, 123)).toBe(true);
    expect(shouldClearComposerSteerAck({ ...ack, createdAtMs: 124 }, 123)).toBe(false);
    expect(shouldShowSteerAction({ composerRunInFlight: true })).toBe(true);
  });
});

describe('resolveComposerSteerState (gold shell S3)', () => {
  it('targets the LAST in-progress assistant message (processing status)', () => {
    const state = resolveComposerSteerState(
      [
        { id: 'a1', role: 'assistant', _localStatus: 'processing', _streamId: 's1' },
        { id: 'u1', role: 'user', content: 'hi' },
        { id: 'a2', role: 'assistant', _localStatus: 'processing', _streamId: 's2' },
      ],
      false,
    );
    expect(state.activeAssistantIndex).toBe(2);
    expect(state.steerStreamId).toBe('s2');
    expect(state.steerReady).toBe(true);
    expect(state.runInFlight).toBe(true);
  });

  it('treats a status-less, content-less assistant message as in progress and falls back to its id', () => {
    const state = resolveComposerSteerState(
      [{ id: 'a1', role: 'assistant', content: null }],
      false,
    );
    expect(state.steerStreamId).toBe('a1');
    expect(state.steerReady).toBe(true);
  });

  it('ignores completed assistants and user messages; runInFlight follows sending', () => {
    const idle = resolveComposerSteerState(
      [
        { id: 'a1', role: 'assistant', content: 'done', _localStatus: 'completed' },
        { id: 'u1', role: 'user', content: 'hi' },
      ],
      false,
    );
    expect(idle.activeAssistantIndex).toBe(-1);
    expect(idle.steerStreamId).toBeNull();
    expect(idle.steerReady).toBe(false);
    expect(idle.runInFlight).toBe(false);
    expect(resolveComposerSteerState([], true).runInFlight).toBe(true);
  });

  it('is not steer-ready on a blank stream id', () => {
    const state = resolveComposerSteerState(
      [{ id: '  ', role: 'assistant', _localStatus: 'processing', _streamId: '  ' }],
      false,
    );
    expect(state.steerReady).toBe(false);
    expect(state.runInFlight).toBe(false);
  });

  it('isAssistantMessageInProgress: content without status means completed', () => {
    expect(
      isAssistantMessageInProgress({ id: 'a', role: 'assistant', content: 'x' }),
    ).toBe(false);
    expect(isAssistantMessageInProgress({ id: 'u', role: 'user' })).toBe(false);
  });
});
