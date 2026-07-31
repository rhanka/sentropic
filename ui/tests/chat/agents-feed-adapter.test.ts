import { describe, expect, it } from 'vitest';
import { buildAgentsListRows } from '@sentropic/chat-ui/state/agentsSort';
import {
  projectAgentsFeed,
  type AppChatSession,
  type AppJob,
} from '$lib/chat/agents-feed-adapter';

const session = (over: Partial<AppChatSession> & { id: string }): AppChatSession => ({
  title: over.id,
  ...over,
});

const job = (over: Partial<AppJob> & { id: string }): AppJob => ({
  type: 'document_summary',
  status: 'pending',
  createdAt: '2026-07-30T10:00:00.000Z',
  ...over,
});

describe('projectAgentsFeed — sessions', () => {
  it('projects a session as an idle session entry with its activity time', () => {
    const [entry] = projectAgentsFeed({
      sessions: [session({ id: 's1', updatedAt: '2026-07-30T12:00:00.000Z' })],
      jobs: [],
    });
    expect(entry).toMatchObject({ id: 's1', kind: 'session', status: 'idle' });
    expect(entry?.lastActivityAt).toBe(Date.parse('2026-07-30T12:00:00.000Z'));
  });

  it('falls back to createdAt when a session has no updatedAt', () => {
    const [entry] = projectAgentsFeed({
      sessions: [session({ id: 's1', createdAt: '2026-07-30T09:00:00.000Z' })],
      jobs: [],
    });
    expect(entry?.lastActivityAt).toBe(Date.parse('2026-07-30T09:00:00.000Z'));
  });
});

describe('projectAgentsFeed — jobs', () => {
  it('maps each job status to the agents status ladder', () => {
    const statuses = (['pending', 'processing', 'completed', 'failed'] as const).map(
      (s) => projectAgentsFeed({ sessions: [], jobs: [job({ id: s, status: s })] })[0]?.status,
    );
    expect(statuses).toEqual(['idle', 'running', 'done', 'failed']);
  });

  it('renders a standalone job as its own row, prefixed to avoid id collision', () => {
    const [entry] = projectAgentsFeed({ sessions: [], jobs: [job({ id: 'j1' })] });
    expect(entry).toMatchObject({ id: 'job:j1', kind: 'job' });
  });

  it('dates a job by completedAt, then startedAt, then createdAt', () => {
    const done = projectAgentsFeed({
      sessions: [],
      jobs: [job({ id: 'j', status: 'completed', completedAt: '2026-07-30T14:00:00.000Z' })],
    })[0];
    expect(done?.lastActivityAt).toBe(Date.parse('2026-07-30T14:00:00.000Z'));
  });
});

describe('projectAgentsFeed — D5 session-bound job merge', () => {
  it('does NOT show a session-bound job as its own row', () => {
    const entries = projectAgentsFeed({
      sessions: [session({ id: 's1' })],
      jobs: [job({ id: 'j1', type: 'chat_message', sessionId: 's1', status: 'processing' })],
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]?.id).toBe('s1');
  });

  it('merges the job status UP into its session (running wins)', () => {
    const [entry] = projectAgentsFeed({
      sessions: [session({ id: 's1' })],
      jobs: [job({ id: 'j1', sessionId: 's1', status: 'processing' })],
    });
    expect(entry?.status).toBe('running');
  });

  it('a failed session-bound job surfaces on the session over a terminal done', () => {
    const [entry] = projectAgentsFeed({
      sessions: [session({ id: 's1' })],
      jobs: [
        job({ id: 'a', sessionId: 's1', status: 'completed' }),
        job({ id: 'b', sessionId: 's1', status: 'failed' }),
      ],
    });
    expect(entry?.status).toBe('failed');
  });

  it('detects the binding by sessionId, not by the job type string', () => {
    // A chat_message-typed job with NO sessionId is a standalone row, and a
    // differently-typed job WITH a sessionId still merges.
    const entries = projectAgentsFeed({
      sessions: [session({ id: 's1' })],
      jobs: [
        job({ id: 'orphan', type: 'chat_message' }),
        job({ id: 'bound', type: 'document_summary', sessionId: 's1', status: 'processing' }),
      ],
    });
    expect(entries.map((e) => e.id).sort()).toEqual(['job:orphan', 's1']);
    expect(entries.find((e) => e.id === 's1')?.status).toBe('running');
  });
});

describe('projectAgentsFeed — feeds the R9 ordering', () => {
  it('produces entries the chat-ui comparator ranks (running session above idle jobs)', () => {
    const entries = projectAgentsFeed({
      sessions: [session({ id: 'busy', updatedAt: 1 })],
      jobs: [
        job({ id: 'q', status: 'pending' }),
        job({ id: 'r', sessionId: 'busy', status: 'processing' }),
      ],
    });
    const rows = buildAgentsListRows(entries);
    expect(rows[0]?.entry.id).toBe('busy');
    expect(rows[0]?.aggregateStatus).toBe('running');
  });
});
