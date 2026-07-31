/**
 * BLOCKED — this suite cannot run until the design-system package is fixed.
 *
 * `@sentropic/design-system-svelte@0.34.73` publishes `dist/Accordion.svelte`
 * containing `function toggle(id, disabled?)`: the build strips the type
 * annotations AND the `lang="ts"` marker but leaves the optional-parameter `?`,
 * so the file declares itself JavaScript while still holding TypeScript-only
 * syntax. No consumer-side preprocessor can recover it — verified by adding an
 * explicit `vitePreprocess()` to the plugin, which changed nothing. The package
 * exposes a single `.` export, so the broken file cannot be side-stepped by a
 * deep import either.
 *
 *   RollupError: Parse failure: Expected ',', got '?'
 *   at .../@sentropic/design-system-svelte/dist/Accordion.svelte:50:29
 *
 * Reported to the design-system lane. Un-skip as soon as a fixed version is
 * published — the assertions below are complete and were written against the
 * real DS components, not stubs.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

import AgentsList from '../src/components/AgentsList.svelte';
import type { AgentsListRow } from '../src/state/agentsSort.js';

afterEach(() => cleanup());

const labels = (key: string): string => `label:${key}`;

const ROWS: AgentsListRow[] = [
  {
    entry: { id: 'waiting', kind: 'agent', title: null, status: 'awaiting-input', lastActivityAt: 10, pendingPrompt: 'Need a decision', workspaceLabel: 'acme/web', connection: 'connected' },
    depth: 0,
    aggregateStatus: 'awaiting-input',
    childCount: 2,
  },
  { entry: { id: 'running', kind: 'session', title: 'Working', status: 'running', lastActivityAt: 20 }, depth: 1, aggregateStatus: 'running', childCount: 0 },
  { entry: { id: 'failed', kind: 'remote', title: 'Remote', status: 'failed', lastActivityAt: 30 }, depth: 0, aggregateStatus: 'failed', childCount: 0 },
  { entry: { id: 'done', kind: 'job', title: 'Job', status: 'done', lastActivityAt: 40 }, depth: 0, aggregateStatus: 'done', childCount: 0 },
  { entry: { id: 'idle', kind: 'run', title: 'Run', status: 'idle', lastActivityAt: 50 }, depth: 0, aggregateStatus: 'idle', childCount: 0 },
];

const renderList = (props: Partial<{
  rows: AgentsListRow[];
  activeId: string;
  onSelect: (entryId: string) => void;
  labels: (key: string) => string;
  formatRelative: (epochMs: number) => string;
}> = {}) =>
  render(AgentsList, {
    props: {
      rows: ROWS,
      onSelect: vi.fn(),
      labels,
      formatRelative: (epochMs: number) => `relative:${epochMs}`,
      ...props,
    },
  });

describe('AgentsList', () => {
  it('should render one listbox option per row and mark the active row with aria-current', () => {
    const { container } = renderList({ activeId: 'running' });

    expect(screen.getByRole('listbox', { name: 'label:chat.agents.list.label' })).not.toBeNull();
    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(ROWS.length);
    // The active-row highlight is carried by the row wrapper (aria-current),
    // NOT the DS selection (`aria-selected`) — that is pinned off so a re-click
    // navigates instead of toggling.
    const active = container.querySelector('[data-agent-entry-id="running"]');
    expect(active?.getAttribute('aria-current')).toBe('true');
    const inactive = container.querySelector('[data-agent-entry-id="waiting"]');
    expect(inactive?.getAttribute('aria-current')).toBeNull();
  });

  it('should call onSelect from click and keyboard activation', async () => {
    const onSelect = vi.fn();
    renderList({ onSelect });
    const options = screen.getAllByRole('option');

    await fireEvent.click(options[0]!);
    await fireEvent.keyDown(options[1]!, { key: 'Enter' });

    expect(onSelect).toHaveBeenNthCalledWith(1, 'waiting');
    expect(onSelect).toHaveBeenNthCalledWith(2, 'running');
  });

  it('should still call onSelect when the ALREADY-active row is re-clicked', async () => {
    // Regression: the DS single-select toggles off on re-click of the selected
    // row. If navigation were tied to that, returning to the session you just
    // left would dead-end. onSelect must fire on every activation.
    const onSelect = vi.fn();
    renderList({ activeId: 'running', onSelect });
    const running = screen
      .getAllByRole('option')
      .find((el) => el.closest('[data-agent-entry-id="running"]'));

    await fireEvent.click(running!);
    await fireEvent.click(running!);

    expect(onSelect).toHaveBeenNthCalledWith(1, 'running');
    expect(onSelect).toHaveBeenNthCalledWith(2, 'running');
  });

  it('should render every status with its semantic DS tone and pulse running only', () => {
    const { container } = renderList();

    expect(container.querySelector('.st-statusDot__dot--warning')).not.toBeNull();
    expect(container.querySelector('.st-statusDot__dot--info.st-statusDot__dot--pulse')).not.toBeNull();
    expect(container.querySelector('.st-statusDot__dot--error')).not.toBeNull();
    expect(container.querySelector('.st-statusDot__dot--success')).not.toBeNull();
    expect(container.querySelector('.st-statusDot__dot--neutral')).not.toBeNull();
    expect(container.querySelectorAll('.st-statusDot__dot--pulse')).toHaveLength(1);
  });

  it('should show the pending tag and excerpt only for an awaiting-input row', () => {
    renderList();

    expect(screen.getByText('label:chat.agents.pending-question')).not.toBeNull();
    expect(screen.getByText('Need a decision')).not.toBeNull();
    expect(screen.getAllByText('label:chat.agents.pending-question')).toHaveLength(1);
  });

  it('should indent child rows and show the direct child count', () => {
    const { container } = renderList();

    const child = container.querySelector('[data-agent-entry-id="running"]');
    expect(child?.getAttribute('data-depth')).toBe('1');
    expect(child?.getAttribute('style')).toContain('--agents-list-depth: 1');
    // Plain assertion on purpose: jest-dom matchers (toHaveTextContent) are NOT
    // registered in this vitest setup and fail as "Invalid Chai property",
    // which errors instead of asserting.
    expect(screen.getByLabelText('label:chat.agents.children').textContent).toContain('2');
  });

  it('should resolve every component-owned string through labels', () => {
    const resolve = vi.fn(labels);
    renderList({ labels: resolve, formatRelative: undefined });

    expect(screen.getByText('label:chat.agents.kind.agent')).not.toBeNull();
    // Every row without a formatter renders this fallback, so the match is not
    // unique — assert the count rather than a single element.
    expect(screen.getAllByText('label:chat.agents.activity.unknown').length).toBe(ROWS.length);
    expect(resolve).toHaveBeenCalledWith('chat.agents.list.label');
    expect(resolve).toHaveBeenCalledWith('chat.agents.status.running');
    expect(resolve).toHaveBeenCalledWith('chat.agents.connection.unknown');
    expect(resolve).toHaveBeenCalledWith('chat.agents.workspace.unknown');
  });

  it('should render the DS empty state instead of a listbox when no rows exist', () => {
    const { container } = renderList({ rows: [] });

    expect(screen.getByRole('heading', { name: 'label:chat.agents.empty.title' })).not.toBeNull();
    expect(container.querySelector('.st-empty-state')).not.toBeNull();
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});
