/**
 * ChatSessionsBar — optional host-owned Back navigation DOM contract.
 *
 * Environment: jsdom via vitest.dom.config.ts (target: test-chat-ui-dom).
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

import ChatSessionsBar from '../src/components/ChatSessionsBar.svelte';

afterEach(cleanup);

const BAR_LABELS = {
  none: 'No conversation selected',
  loading: 'Loading',
  defaultTitle: (id: string) => `Conversation ${id}`,
};

const renderBar = (props: Record<string, unknown> = {}) =>
  render(ChatSessionsBar, {
    props: {
      barLabels: BAR_LABELS,
      labels: (key: string) => key,
      ...props,
    },
  });

describe('ChatSessionsBar — optional Back navigation', () => {
  it('renders no Back control when the host does not provide onBack', () => {
    renderBar({ backLabel: 'Back to conversations' });

    expect(screen.queryByRole('button', { name: 'Back to conversations' })).toBeNull();
  });

  it('renders Back as an accessible button with its visible host label', () => {
    renderBar({ onBack: vi.fn(), backLabel: 'Back to conversations' });

    const back = screen.getByRole('button', { name: 'Back to conversations' });
    expect(back.tagName).toBe('BUTTON');
    expect(back.textContent).toContain('Back to conversations');
  });

  it('calls the host Back callback when activated', async () => {
    const onBack = vi.fn();
    renderBar({ onBack, backLabel: 'Back to conversations' });

    await fireEvent.click(screen.getByRole('button', { name: 'Back to conversations' }));

    expect(onBack).toHaveBeenCalledOnce();
  });
});
