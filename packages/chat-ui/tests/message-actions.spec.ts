import { describe, expect, it } from 'vitest';
import {
  applyFeedbackAction,
  buildFeedbackNextVote,
  formatCopyPayload,
  resolveAvailableActions,
  resolveFeedbackDisplayState,
} from '../src/utils/message-actions.js';

// ---------------------------------------------------------------------------
// resolveAvailableActions — user messages
// ---------------------------------------------------------------------------

describe('resolveAvailableActions (user)', () => {
  it('should show copy and edit when user message is completed', () => {
    const result = resolveAvailableActions({ role: 'user', streamStatus: 'completed' });
    expect(result.copy).toBe(true);
    expect(result.edit).toBe(true);
    expect(result.regenerate).toBe(false);
    expect(result.retry).toBe(false);
    expect(result.feedbackUp).toBe(false);
    expect(result.feedbackDown).toBe(false);
  });

  it('should hide copy and edit when user message is processing (streaming)', () => {
    const result = resolveAvailableActions({ role: 'user', streamStatus: 'processing' });
    expect(result.copy).toBe(false);
    expect(result.edit).toBe(false);
  });

  it('should never show regenerate/retry/feedback for user messages', () => {
    const completed = resolveAvailableActions({ role: 'user', streamStatus: 'completed' });
    expect(completed.regenerate).toBe(false);
    expect(completed.retry).toBe(false);
    expect(completed.feedbackUp).toBe(false);
    expect(completed.feedbackDown).toBe(false);

    const processing = resolveAvailableActions({ role: 'user', streamStatus: 'processing' });
    expect(processing.regenerate).toBe(false);
    expect(processing.retry).toBe(false);
    expect(processing.feedbackUp).toBe(false);
    expect(processing.feedbackDown).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// resolveAvailableActions — assistant messages
// ---------------------------------------------------------------------------

describe('resolveAvailableActions (assistant)', () => {
  it('should show all assistant actions when terminal and last assistant segment', () => {
    const result = resolveAvailableActions({
      role: 'assistant',
      streamStatus: 'completed',
      isLastAssistantSegment: true,
    });
    expect(result.copy).toBe(true);
    expect(result.regenerate).toBe(true);
    expect(result.retry).toBe(true);
    expect(result.feedbackUp).toBe(true);
    expect(result.feedbackDown).toBe(true);
    expect(result.edit).toBe(false);
  });

  it('should hide all assistant actions when streaming (not terminal)', () => {
    const result = resolveAvailableActions({
      role: 'assistant',
      streamStatus: 'processing',
      isLastAssistantSegment: true,
    });
    expect(result.copy).toBe(false);
    expect(result.regenerate).toBe(false);
    expect(result.retry).toBe(false);
    expect(result.feedbackUp).toBe(false);
    expect(result.feedbackDown).toBe(false);
  });

  it('should hide all assistant actions when terminal but NOT last assistant segment', () => {
    const result = resolveAvailableActions({
      role: 'assistant',
      streamStatus: 'completed',
      isLastAssistantSegment: false,
    });
    expect(result.copy).toBe(false);
    expect(result.regenerate).toBe(false);
    expect(result.feedbackUp).toBe(false);
  });

  it('should default isLastAssistantSegment to false when not provided', () => {
    const result = resolveAvailableActions({
      role: 'assistant',
      streamStatus: 'completed',
    });
    expect(result.copy).toBe(false);
    expect(result.regenerate).toBe(false);
  });

  it('should never show edit for assistant messages', () => {
    const result = resolveAvailableActions({
      role: 'assistant',
      streamStatus: 'completed',
      isLastAssistantSegment: true,
    });
    expect(result.edit).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// resolveFeedbackDisplayState
// ---------------------------------------------------------------------------

describe('resolveFeedbackDisplayState', () => {
  it('should set isUp=true when vote is 1', () => {
    const state = resolveFeedbackDisplayState(1);
    expect(state.isUp).toBe(true);
    expect(state.isDown).toBe(false);
  });

  it('should set isDown=true when vote is -1', () => {
    const state = resolveFeedbackDisplayState(-1);
    expect(state.isUp).toBe(false);
    expect(state.isDown).toBe(true);
  });

  it('should set both false when vote is null', () => {
    const state = resolveFeedbackDisplayState(null);
    expect(state.isUp).toBe(false);
    expect(state.isDown).toBe(false);
  });

  it('should set both false when vote is undefined', () => {
    const state = resolveFeedbackDisplayState(undefined);
    expect(state.isUp).toBe(false);
    expect(state.isDown).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// buildFeedbackNextVote
// ---------------------------------------------------------------------------

describe('buildFeedbackNextVote', () => {
  it('should return "up" when clicking up and current vote is null (no vote)', () => {
    expect(buildFeedbackNextVote(null, 'up')).toBe('up');
  });

  it('should return "clear" when clicking up and current vote is already up (1)', () => {
    expect(buildFeedbackNextVote(1, 'up')).toBe('clear');
  });

  it('should return "up" when clicking up and current vote is down (-1)', () => {
    expect(buildFeedbackNextVote(-1, 'up')).toBe('up');
  });

  it('should return "down" when clicking down and current vote is null (no vote)', () => {
    expect(buildFeedbackNextVote(null, 'down')).toBe('down');
  });

  it('should return "clear" when clicking down and current vote is already down (-1)', () => {
    expect(buildFeedbackNextVote(-1, 'down')).toBe('clear');
  });

  it('should return "down" when clicking down and current vote is up (1)', () => {
    expect(buildFeedbackNextVote(1, 'down')).toBe('down');
  });

  it('should return "up" when vote is undefined and clicking up', () => {
    expect(buildFeedbackNextVote(undefined, 'up')).toBe('up');
  });

  it('should return "down" when vote is undefined and clicking down', () => {
    expect(buildFeedbackNextVote(undefined, 'down')).toBe('down');
  });
});

// ---------------------------------------------------------------------------
// applyFeedbackAction
// ---------------------------------------------------------------------------

describe('applyFeedbackAction', () => {
  it('should return 1 for "up"', () => {
    expect(applyFeedbackAction('up')).toBe(1);
  });

  it('should return -1 for "down"', () => {
    expect(applyFeedbackAction('down')).toBe(-1);
  });

  it('should return null for "clear"', () => {
    expect(applyFeedbackAction('clear')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// formatCopyPayload
// ---------------------------------------------------------------------------

describe('formatCopyPayload', () => {
  it('should return the content string trimmed at the end', () => {
    expect(formatCopyPayload('hello world   ')).toBe('hello world');
  });

  it('should preserve leading whitespace', () => {
    expect(formatCopyPayload('  indented')).toBe('  indented');
  });

  it('should return empty string for null', () => {
    expect(formatCopyPayload(null)).toBe('');
  });

  it('should return empty string for undefined', () => {
    expect(formatCopyPayload(undefined)).toBe('');
  });

  it('should return empty string for an empty string', () => {
    expect(formatCopyPayload('')).toBe('');
  });

  it('should preserve multiline content', () => {
    const content = 'line 1\nline 2\nline 3';
    expect(formatCopyPayload(content)).toBe('line 1\nline 2\nline 3');
  });
});
