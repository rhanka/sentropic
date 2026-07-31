import { describe, expect, it } from 'vitest';
import {
  projectAgentsFeed,
  queueJobsToAppJobs,
  type QueueJob,
} from '$lib/chat/agents-feed-adapter';

/**
 * Guards the app-side plumbing between the queue store and the pure projection.
 * The store types job `data` as `any` and only chat_message jobs carry
 * `data.sessionId`; if that id is not lifted to the top level, D5's merge
 * silently no-ops and a chat turn appears twice. This is the exact bug the
 * first wiring shipped with.
 */
const queueJob = (over: Partial<QueueJob> & { id: string }): QueueJob => ({
  type: 'document_summary',
  status: 'pending',
  createdAt: '2026-07-30T10:00:00.000Z',
  ...over,
});

describe('queueJobsToAppJobs', () => {
  it('lifts data.sessionId to the top level for a chat_message job', () => {
    const [job] = queueJobsToAppJobs([
      queueJob({ id: 'j1', type: 'chat_message', data: { sessionId: 's1', userId: 'u' } }),
    ]);
    expect(job?.sessionId).toBe('s1');
  });

  it('leaves sessionId null for a job whose data has none', () => {
    const [job] = queueJobsToAppJobs([queueJob({ id: 'j1', data: { foo: 'bar' } })]);
    expect(job?.sessionId).toBeNull();
  });

  it('tolerates undefined or non-object data', () => {
    expect(queueJobsToAppJobs([queueJob({ id: 'a' })])[0]?.sessionId).toBeNull();
    expect(
      queueJobsToAppJobs([queueJob({ id: 'b', data: 'nope' as unknown })])[0]?.sessionId,
    ).toBeNull();
  });
});

describe('queue → feed end to end (the D5 duplication guard)', () => {
  it('does NOT duplicate a session that also has a running chat_message job', () => {
    const entries = projectAgentsFeed({
      sessions: [{ id: 's1', title: 'My chat' }],
      jobs: queueJobsToAppJobs([
        queueJob({ id: 'j1', type: 'chat_message', status: 'processing', data: { sessionId: 's1' } }),
      ]),
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ id: 's1', kind: 'session', status: 'running' });
  });

  it('still shows a non-chat job (no sessionId) as its own row', () => {
    const entries = projectAgentsFeed({
      sessions: [{ id: 's1', title: 'My chat' }],
      jobs: queueJobsToAppJobs([queueJob({ id: 'doc', type: 'document_summary' })]),
    });
    expect(entries.map((e) => e.id).sort()).toEqual(['job:doc', 's1']);
  });
});
