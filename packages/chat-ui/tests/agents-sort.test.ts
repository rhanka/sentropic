import { describe, expect, it } from 'vitest';
import { buildAgentsListRows } from '../src/state/agentsSort.js';
import type { AgentsEntry } from '../src/state/agentsEntry.js';

const entry = (over: Partial<AgentsEntry> & { id: string }): AgentsEntry => ({
  kind: 'session',
  title: over.id,
  status: 'idle',
  lastActivityAt: 0,
  ...over,
});

const ids = (rows: readonly { entry: AgentsEntry }[]): string[] =>
  rows.map((row) => row.entry.id);

describe('buildAgentsListRows — R9 bucket order', () => {
  it('puts an awaiting-input entry above a running one, even when far staler', () => {
    const rows = buildAgentsListRows([
      entry({ id: 'running-now', status: 'running', lastActivityAt: 10_000 }),
      entry({ id: 'blocked-10-days-ago', status: 'awaiting-input', lastActivityAt: 1 }),
    ]);
    expect(ids(rows)).toEqual(['blocked-10-days-ago', 'running-now']);
  });

  it('honours the literal R9 reading when awaitingInputFirst is disabled', () => {
    const rows = buildAgentsListRows(
      [
        entry({ id: 'running-now', status: 'running', lastActivityAt: 10_000 }),
        entry({ id: 'blocked', status: 'awaiting-input', lastActivityAt: 1 }),
      ],
      { awaitingInputFirst: false },
    );
    expect(ids(rows)).toEqual(['running-now', 'blocked']);
  });

  it('ranks a running job above an idle perennial agent', () => {
    const rows = buildAgentsListRows([
      entry({ id: 'idle-agent', kind: 'agent', status: 'idle', lastViewedAt: 9_000 }),
      entry({ id: 'running-job', kind: 'job', status: 'running', lastActivityAt: 1 }),
    ]);
    expect(ids(rows)).toEqual(['running-job', 'idle-agent']);
  });

  it('ranks an idle perennial agent above other resting sessions', () => {
    const rows = buildAgentsListRows([
      entry({ id: 'session', status: 'idle', lastViewedAt: 9_000 }),
      entry({ id: 'agent', kind: 'agent', status: 'idle', lastViewedAt: 1 }),
    ]);
    expect(ids(rows)).toEqual(['agent', 'session']);
  });
});

describe('buildAgentsListRows — per-bucket recency key', () => {
  it('orders running items by activity, ignoring when they were last viewed', () => {
    const rows = buildAgentsListRows([
      entry({ id: 'seen-recently', status: 'running', lastActivityAt: 1, lastViewedAt: 9_999 }),
      entry({ id: 'active-now', status: 'running', lastActivityAt: 9_999, lastViewedAt: 1 }),
    ]);
    expect(ids(rows)).toEqual(['active-now', 'seen-recently']);
  });

  it('orders resting items by last consultation, ignoring their activity', () => {
    const rows = buildAgentsListRows([
      entry({ id: 'busy-but-unseen', status: 'idle', lastActivityAt: 9_999, lastViewedAt: 1 }),
      entry({ id: 'just-consulted', status: 'idle', lastActivityAt: 1, lastViewedAt: 9_999 }),
    ]);
    expect(ids(rows)).toEqual(['just-consulted', 'busy-but-unseen']);
  });

  it('falls back to activity for a never-consulted entry instead of burying it', () => {
    const rows = buildAgentsListRows([
      entry({ id: 'opened-long-ago', status: 'idle', lastActivityAt: 1, lastViewedAt: 500 }),
      entry({ id: 'brand-new-never-opened', status: 'idle', lastActivityAt: 9_999 }),
    ]);
    expect(ids(rows)).toEqual(['brand-new-never-opened', 'opened-long-ago']);
  });
});

describe('buildAgentsListRows — hierarchy', () => {
  it('emits each parent immediately followed by its own subtree, with depth', () => {
    const rows = buildAgentsListRows([
      entry({ id: 'a', kind: 'agent', status: 'idle', lastViewedAt: 100 }),
      entry({ id: 'a1', parentId: 'a', status: 'idle', lastViewedAt: 10 }),
      entry({ id: 'a1x', parentId: 'a1', kind: 'run', status: 'idle', lastViewedAt: 5 }),
      entry({ id: 'b', kind: 'agent', status: 'idle', lastViewedAt: 50 }),
      entry({ id: 'b1', parentId: 'b', status: 'idle', lastViewedAt: 40 }),
    ]);
    expect(ids(rows)).toEqual(['a', 'a1', 'a1x', 'b', 'b1']);
    expect(rows.map((row) => row.depth)).toEqual([0, 1, 2, 0, 1]);
  });

  it('never interleaves the children of two different parents', () => {
    // b1 is the most recently viewed child of all, yet it must stay under b.
    const rows = buildAgentsListRows([
      entry({ id: 'a', kind: 'agent', status: 'idle', lastViewedAt: 100 }),
      entry({ id: 'a1', parentId: 'a', status: 'idle', lastViewedAt: 1 }),
      entry({ id: 'b', kind: 'agent', status: 'idle', lastViewedAt: 50 }),
      entry({ id: 'b1', parentId: 'b', status: 'idle', lastViewedAt: 9_999 }),
    ]);
    expect(ids(rows)).toEqual(['a', 'a1', 'b', 'b1']);
  });

  it('lifts a subagent awaiting input to the top via its parent aggregate status', () => {
    const rows = buildAgentsListRows([
      entry({ id: 'quiet-agent', kind: 'agent', status: 'idle', lastViewedAt: 9_999 }),
      entry({ id: 'busy-agent', kind: 'agent', status: 'idle', lastViewedAt: 1 }),
      entry({
        id: 'delegated-run',
        parentId: 'busy-agent',
        kind: 'run',
        status: 'awaiting-input',
        lastActivityAt: 1,
      }),
    ]);
    expect(ids(rows)).toEqual(['busy-agent', 'delegated-run', 'quiet-agent']);
    expect(rows[0]?.aggregateStatus).toBe('awaiting-input');
    expect(rows[0]?.childCount).toBe(1);
  });
});

describe('buildAgentsListRows — malformed feeds', () => {
  it('treats an entry with an absent parent as a root instead of dropping it', () => {
    const rows = buildAgentsListRows([
      entry({ id: 'orphan', parentId: 'never-delivered', status: 'idle', lastViewedAt: 5 }),
    ]);
    expect(ids(rows)).toEqual(['orphan']);
    expect(rows[0]?.depth).toBe(0);
  });

  it('breaks a parent cycle instead of recursing forever, keeping every entry once', () => {
    const rows = buildAgentsListRows([
      entry({ id: 'x', parentId: 'y', status: 'idle' }),
      entry({ id: 'y', parentId: 'x', status: 'idle' }),
    ]);
    expect(rows).toHaveLength(2);
    expect(new Set(ids(rows)).size).toBe(2);
  });

  it('ignores a self-parent rather than hiding the entry', () => {
    const rows = buildAgentsListRows([entry({ id: 'self', parentId: 'self' })]);
    expect(ids(rows)).toEqual(['self']);
  });

  it('is deterministic when two entries tie on bucket and recency', () => {
    const input = [
      entry({ id: 'zeta', status: 'idle', lastViewedAt: 7 }),
      entry({ id: 'alpha', status: 'idle', lastViewedAt: 7 }),
    ];
    expect(ids(buildAgentsListRows(input))).toEqual(['alpha', 'zeta']);
    expect(ids(buildAgentsListRows([...input].reverse()))).toEqual(['alpha', 'zeta']);
  });

  it('returns an empty list for an empty feed', () => {
    expect(buildAgentsListRows([])).toEqual([]);
  });
});
