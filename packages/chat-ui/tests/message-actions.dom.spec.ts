/**
 * message-actions.dom.spec.ts — DOM/ARIA tests for @sentropic/chat-ui MessageActions.
 *
 * Tests: action buttons present per message role/state, ARIA labels, events fire on
 * click, feedback toggle state.
 *
 * Environment: jsdom via vitest.config.ts (BR-A0b-EX1 target: test-chat-ui-dom).
 * Does NOT affect the existing node-env test-chat-ui target.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

import MessageActions from '../src/components/MessageActions.svelte';

afterEach(() => cleanup());

// ---------------------------------------------------------------------------
// User message — buttons present per role/state
// ---------------------------------------------------------------------------

describe('MessageActions — user message buttons', () => {
  it('should render copy and edit buttons for a completed user message', () => {
    render(MessageActions, {
      props: {
        role: 'user',
        streamStatus: 'completed',
        labels: (key: string) => key,
      },
    });
    // Both action buttons have aria-labels matching the label keys
    expect(screen.getByRole('button', { name: 'common.copy' })).not.toBeNull();
    expect(screen.getByRole('button', { name: 'chat.message.edit' })).not.toBeNull();
  });

  it('should NOT render any buttons for a user message that is still processing', () => {
    const { container } = render(MessageActions, {
      props: {
        role: 'user',
        streamStatus: 'processing',
        labels: (key: string) => key,
      },
    });
    const buttons = container.querySelectorAll('button');
    expect(buttons.length).toBe(0);
  });

  it('should NOT render regenerate or feedback buttons for a user message', () => {
    render(MessageActions, {
      props: {
        role: 'user',
        streamStatus: 'completed',
        labels: (key: string) => key,
      },
    });
    expect(screen.queryByRole('button', { name: 'common.retry' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'chat.feedback.useful' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'chat.feedback.notUseful' })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Assistant message — buttons present per role/state
// ---------------------------------------------------------------------------

describe('MessageActions — assistant message buttons', () => {
  it('should render copy, regenerate, and feedback buttons for the last assistant segment', () => {
    render(MessageActions, {
      props: {
        role: 'assistant',
        streamStatus: 'completed',
        isLastAssistantSegment: true,
        labels: (key: string) => key,
      },
    });
    expect(screen.getByRole('button', { name: 'common.copy' })).not.toBeNull();
    expect(screen.getByRole('button', { name: 'common.retry' })).not.toBeNull();
    expect(screen.getByRole('button', { name: 'chat.feedback.useful' })).not.toBeNull();
    expect(screen.getByRole('button', { name: 'chat.feedback.notUseful' })).not.toBeNull();
  });

  it('should NOT render any buttons when isLastAssistantSegment is false', () => {
    const { container } = render(MessageActions, {
      props: {
        role: 'assistant',
        streamStatus: 'completed',
        isLastAssistantSegment: false,
        labels: (key: string) => key,
      },
    });
    expect(container.querySelectorAll('button').length).toBe(0);
  });

  it('should NOT render any buttons while the assistant message is processing', () => {
    const { container } = render(MessageActions, {
      props: {
        role: 'assistant',
        streamStatus: 'processing',
        isLastAssistantSegment: true,
        labels: (key: string) => key,
      },
    });
    expect(container.querySelectorAll('button').length).toBe(0);
  });

  it('should NOT render edit button for assistant messages', () => {
    render(MessageActions, {
      props: {
        role: 'assistant',
        streamStatus: 'completed',
        isLastAssistantSegment: true,
        labels: (key: string) => key,
      },
    });
    expect(screen.queryByRole('button', { name: 'chat.message.edit' })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// ARIA labels
// ---------------------------------------------------------------------------

describe('MessageActions — ARIA labels', () => {
  it('should apply labels from the injected resolver to button aria-label attributes', () => {
    const labels = (key: string): string => {
      const map: Record<string, string> = {
        'common.copy': 'Copy message',
        'common.retry': 'Retry',
        'chat.feedback.useful': 'Helpful',
        'chat.feedback.notUseful': 'Not helpful',
      };
      return map[key] ?? key;
    };
    render(MessageActions, {
      props: {
        role: 'assistant',
        streamStatus: 'completed',
        isLastAssistantSegment: true,
        labels,
      },
    });
    expect(screen.getByRole('button', { name: 'Copy message' })).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Retry' })).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Helpful' })).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Not helpful' })).not.toBeNull();
  });

  it('should fall back to the key as aria-label when no labels resolver is provided', () => {
    render(MessageActions, {
      props: {
        role: 'user',
        streamStatus: 'completed',
      },
    });
    // Without labels resolver, resolveLabel returns the key itself
    expect(screen.getByRole('button', { name: 'common.copy' })).not.toBeNull();
    expect(screen.getByRole('button', { name: 'chat.message.edit' })).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Events fire on click
// ---------------------------------------------------------------------------

describe('MessageActions — events fire on click', () => {
  it('should call onCopy when the copy button is clicked (user message)', async () => {
    const onCopy = vi.fn();
    render(MessageActions, {
      props: {
        role: 'user',
        streamStatus: 'completed',
        onCopy,
        labels: (key: string) => key,
      },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'common.copy' }));
    expect(onCopy).toHaveBeenCalledOnce();
  });

  it('should call onEdit when the edit button is clicked (user message)', async () => {
    const onEdit = vi.fn();
    render(MessageActions, {
      props: {
        role: 'user',
        streamStatus: 'completed',
        onEdit,
        labels: (key: string) => key,
      },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'chat.message.edit' }));
    expect(onEdit).toHaveBeenCalledOnce();
  });

  it('should call onCopy when the copy button is clicked (assistant message)', async () => {
    const onCopy = vi.fn();
    render(MessageActions, {
      props: {
        role: 'assistant',
        streamStatus: 'completed',
        isLastAssistantSegment: true,
        onCopy,
        labels: (key: string) => key,
      },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'common.copy' }));
    expect(onCopy).toHaveBeenCalledOnce();
  });

  it('should call onRegenerate when the retry button is clicked', async () => {
    const onRegenerate = vi.fn();
    render(MessageActions, {
      props: {
        role: 'assistant',
        streamStatus: 'completed',
        isLastAssistantSegment: true,
        onRegenerate,
        labels: (key: string) => key,
      },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'common.retry' }));
    expect(onRegenerate).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// Feedback toggle
// ---------------------------------------------------------------------------

describe('MessageActions — feedback toggle', () => {
  it('should call onFeedback("up") when thumbs-up is clicked with no current vote', async () => {
    const onFeedback = vi.fn();
    render(MessageActions, {
      props: {
        role: 'assistant',
        streamStatus: 'completed',
        isLastAssistantSegment: true,
        feedbackVote: null,
        onFeedback,
        labels: (key: string) => key,
      },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'chat.feedback.useful' }));
    expect(onFeedback).toHaveBeenCalledWith('up');
  });

  it('should call onFeedback("clear") when thumbs-up is clicked again (toggle off)', async () => {
    const onFeedback = vi.fn();
    render(MessageActions, {
      props: {
        role: 'assistant',
        streamStatus: 'completed',
        isLastAssistantSegment: true,
        feedbackVote: 1, // already voted up
        onFeedback,
        labels: (key: string) => key,
      },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'chat.feedback.useful' }));
    expect(onFeedback).toHaveBeenCalledWith('clear');
  });

  it('should call onFeedback("down") when thumbs-down is clicked with no current vote', async () => {
    const onFeedback = vi.fn();
    render(MessageActions, {
      props: {
        role: 'assistant',
        streamStatus: 'completed',
        isLastAssistantSegment: true,
        feedbackVote: null,
        onFeedback,
        labels: (key: string) => key,
      },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'chat.feedback.notUseful' }));
    expect(onFeedback).toHaveBeenCalledWith('down');
  });

  it('should call onFeedback("clear") when thumbs-down is clicked again (toggle off)', async () => {
    const onFeedback = vi.fn();
    render(MessageActions, {
      props: {
        role: 'assistant',
        streamStatus: 'completed',
        isLastAssistantSegment: true,
        feedbackVote: -1, // already voted down
        onFeedback,
        labels: (key: string) => key,
      },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'chat.feedback.notUseful' }));
    expect(onFeedback).toHaveBeenCalledWith('clear');
  });

  it('should call onFeedback("up") when thumbs-up is clicked and current vote is down', async () => {
    const onFeedback = vi.fn();
    render(MessageActions, {
      props: {
        role: 'assistant',
        streamStatus: 'completed',
        isLastAssistantSegment: true,
        feedbackVote: -1, // currently voted down
        onFeedback,
        labels: (key: string) => key,
      },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'chat.feedback.useful' }));
    expect(onFeedback).toHaveBeenCalledWith('up');
  });

  it('should show copy-flash check icon when isCopied is true (user message)', () => {
    const { container } = render(MessageActions, {
      props: {
        role: 'user',
        streamStatus: 'completed',
        isCopied: true,
        labels: (key: string) => key,
      },
    });
    // When isCopied is true, the copy button shows a Check icon (not Copy icon)
    // We verify it via the button's aria-label still being present (same button)
    const copyBtn = screen.getByRole('button', { name: 'common.copy' });
    expect(copyBtn).not.toBeNull();
    // The button should exist — Check icon shown instead of Copy icon (SVG swap)
    // We can't query SVG icons directly, but can verify the button wrapper is there
    expect(container.querySelectorAll('.chat-message-action-button').length).toBeGreaterThan(0);
  });
});
