import { describe, expect, it } from 'vitest';
import {
  aggregateAgentsEntryStatus,
  agentsEntryStatusUrgency,
  type AgentsEntryStatus,
} from '../src/state/agentsEntry.js';

describe('agents entry status urgency', () => {
  it('ranks awaiting-input as the most urgent, above running (owner ratification of O1)', () => {
    expect(agentsEntryStatusUrgency('awaiting-input')).toBeLessThan(
      agentsEntryStatusUrgency('running'),
    );
  });

  it('orders the full status ladder from most to least urgent', () => {
    const ladder: AgentsEntryStatus[] = [
      'awaiting-input',
      'running',
      'failed',
      'idle',
      'done',
    ];
    const ranks = ladder.map(agentsEntryStatusUrgency);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    expect(new Set(ranks).size).toBe(ladder.length);
  });
});

describe('aggregateAgentsEntryStatus', () => {
  it('surfaces an awaiting-input buried in a delegated run onto the parent row', () => {
    expect(aggregateAgentsEntryStatus('idle', ['done', 'awaiting-input'])).toBe(
      'awaiting-input',
    );
  });

  it('keeps the parent status when it is already the most urgent', () => {
    expect(aggregateAgentsEntryStatus('running', ['idle', 'done'])).toBe('running');
  });

  it('returns the own status when there are no descendants', () => {
    expect(aggregateAgentsEntryStatus('failed', [])).toBe('failed');
  });

  it('prefers running over failed, and failed over idle', () => {
    expect(aggregateAgentsEntryStatus('failed', ['running'])).toBe('running');
    expect(aggregateAgentsEntryStatus('idle', ['failed'])).toBe('failed');
  });

  it('does not invent urgency: a done parent with done children stays done', () => {
    expect(aggregateAgentsEntryStatus('done', ['done', 'done'])).toBe('done');
  });
});
