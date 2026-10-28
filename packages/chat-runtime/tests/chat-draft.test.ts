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
