import { describe, expect, it } from 'vitest';
import { toWorkEvent } from '../../src/run/work-event.js';
import type { WorkEventContext } from '../../src/run/work-event.js';

const ctx: WorkEventContext = {
  runId: 'cli',
  commit: 'abc123',
  branch: 'feat/x',
  env: 'cli',
  runner: 'harness',
  at: '1970-01-01T00:00:00.000Z',
};

describe('toWorkEvent (neutral, emit-only)', () => {
  it('assembles a minimal opened event with empty refs/detail', () => {
    const e = toWorkEvent({ verb: 'brainstorm', status: 'opened' }, ctx);
    expect(e).toMatchObject({
      schemaVersion: 1,
      kind: 'work-event',
      verb: 'brainstorm',
      status: 'opened',
      refs: {},
      detail: {},
      runId: 'cli',
      commit: 'abc123',
      branch: 'feat/x',
      env: 'cli',
      runner: 'harness',
      at: '1970-01-01T00:00:00.000Z',
    });
  });

  it('omits subject and skill when absent (minimal, stable JSON)', () => {
    const e = toWorkEvent({ verb: 'test', status: 'requested' }, ctx);
    expect('subject' in e).toBe(false);
    expect('skill' in e).toBe(false);
  });

  it('carries subject, skill, refs and a neutral detail bag', () => {
    const e = toWorkEvent(
      {
        verb: 'review',
        status: 'requested',
        subject: 'PR #290',
        skill: 'harness/review',
        refs: { thread: 'h2a:env:x', decision: 'D5' },
        detail: { consensus: true, peers: 3, lenses: ['correctness', 'security'] },
      },
      ctx,
    );
    expect(e.subject).toBe('PR #290');
    expect(e.skill).toBe('harness/review');
    expect(e.refs.thread).toBe('h2a:env:x');
    expect(e.detail.peers).toBe(3);
    expect(e.detail.consensus).toBe(true);
    expect(e.detail.lenses).toEqual(['correctness', 'security']);
  });

  it('is JSON-serialisable and round-trips', () => {
    const e = toWorkEvent({ verb: 'branch', status: 'opened', subject: 'feat/x' }, ctx);
    const round = JSON.parse(JSON.stringify(e)) as typeof e;
    expect(round).toEqual(e);
  });
});
