/**
 * ChatWidgetTabBar — package-owned tab bar DOM contract (L-C-shell S1).
 *
 * Environment: jsdom via vitest.dom.config.ts (target: test-chat-ui-dom).
 * Locks the three-role order, the showCommentsTab conditional, the onSelect callback, and
 * badge-off parity for the extension (app) variant so the app's live bar can move without a
 * visible change (I4). No rename is asserted here (that is L-A').
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

import ChatWidgetTabBar from '../src/components/ChatWidgetTabBar.svelte';

afterEach(cleanup);

const renderBar = (props: Record<string, unknown> = {}) =>
  render(ChatWidgetTabBar, {
    props: {
      activeTab: 'chat',
      chatTabLabel: 'Chat',
      commentsTabLabel: 'Comments',
      queueTabLabel: 'Jobs',
      ...props,
    },
  });

describe('ChatWidgetTabBar', () => {
  it('renders the three roles in order: comments, chat, jobs', () => {
    renderBar({ showCommentsTab: true });
    const labels = screen.getAllByRole('button').map((b) => b.textContent?.trim());
    expect(labels).toEqual(['Comments', 'Chat', 'Jobs']);
  });

  it('omits the comments tab when showCommentsTab is false', () => {
    renderBar({ showCommentsTab: false });
    const labels = screen.getAllByRole('button').map((b) => b.textContent?.trim());
    expect(labels).toEqual(['Chat', 'Jobs']);
  });

  it('calls onSelect with the tab id on click', async () => {
    const onSelect = vi.fn();
    renderBar({ onSelect, showCommentsTab: true });
    await fireEvent.click(screen.getByRole('button', { name: 'Comments' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Jobs' }));
    expect(onSelect).toHaveBeenNthCalledWith(1, 'comments');
    expect(onSelect).toHaveBeenNthCalledWith(2, 'queue');
  });

  it('extension variant shows no jobs badge and keeps app classes (badge-off parity, I4)', () => {
    const { container } = renderBar({
      variant: 'extension',
      showCommentsTab: true,
      showJobsBadge: false,
      jobsBadgeCount: 5,
    });
    expect(container.querySelector('.extension-main-tabs')).not.toBeNull();
    const chat = screen.getByRole('button', { name: 'Chat' });
    expect(chat.className).toContain('extension-main-tab');
    const jobs = screen.getByRole('button', { name: 'Jobs' });
    expect(jobs.textContent?.trim()).toBe('Jobs');
    expect(jobs.querySelector('span[aria-label="5 jobs"]')).toBeNull();
  });

  it('default variant renders the jobs badge when count > 0', () => {
    renderBar({ variant: 'default', showJobsBadge: true, jobsBadgeCount: 3 });
    const badge = screen
      .getByRole('button', { name: /Jobs/ })
      .querySelector('span[aria-label="3 jobs"]');
    expect(badge?.textContent?.trim()).toBe('3');
  });
});
