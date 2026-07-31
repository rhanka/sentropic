/**
 * agents-feed-adapter.ts — host-side projection of the data the app ALREADY has
 * (chat sessions + queue jobs) into `@sentropic/chat-ui`'s `AgentsEntry` model.
 *
 * This is the `AgentsFeedPort` contract fulfilled with real dev data, WITHOUT the
 * api feed: perennial agents (R2), CLI transcripts (R12) and cross-workspace
 * (R10) need the api gap closed (same blocker as BR-39l) and are deliberately
 * absent here rather than faked. The first UAT shows exactly what is real today.
 *
 * Pure module: no stores, no fetch, no clock. Node-testable.
 */
import type {
  AgentsEntry,
  AgentsEntryStatus,
} from '@sentropic/chat-ui/state/agentsEntry';

/** The trimmed session shape the app carries (ui/src/lib/components/ChatWidget.svelte). */
export type AppChatSession = {
  readonly id: string;
  readonly title?: string | null;
  readonly updatedAt?: string | number | Date | null;
  readonly createdAt?: string | number | Date | null;
};

/** The queue job shape (ui/src/lib/stores/queue.ts). */
export type AppJobStatus = 'pending' | 'processing' | 'completed' | 'failed';
export type AppJob = {
  readonly id: string;
  readonly type: string;
  readonly status: AppJobStatus;
  readonly createdAt: string;
  readonly startedAt?: string;
  readonly completedAt?: string;
  /** Present on chat-driven jobs; ties the job to a session (D5 merge). */
  readonly sessionId?: string | null;
};

const JOB_STATUS: Record<AppJobStatus, AgentsEntryStatus> = {
  processing: 'running',
  pending: 'idle',
  completed: 'done',
  failed: 'failed',
};

const toMs = (value: string | number | Date | null | undefined): number => {
  if (value === null || value === undefined) return 0;
  const ms = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(ms) ? ms : 0;
};

/**
 * A `chat_message` job is the queued turn of a session that already appears in
 * the list; showing it as its own row would duplicate the conversation (D5). We
 * detect it by an explicit `sessionId` rather than by the job `type` string, so
 * the rule does not silently break if the type label changes.
 */
const isSessionBoundJob = (job: AppJob): boolean =>
  typeof job.sessionId === 'string' && job.sessionId.length > 0;

export type AgentsFeedInput = {
  readonly sessions: readonly AppChatSession[];
  readonly jobs: readonly AppJob[];
};

/**
 * Project the app's sessions and jobs into `AgentsEntry[]`.
 *
 * Sessions become `kind: 'session'` (status `idle` — the app model carries no
 * live-run signal yet; that arrives with the api feed). Jobs become
 * `kind: 'job'`, EXCEPT session-bound jobs, whose status is merged UP into their
 * session so a running turn shows as the session running rather than as a second
 * row.
 */
export const projectAgentsFeed = (input: AgentsFeedInput): AgentsEntry[] => {
  const { sessions, jobs } = input;

  // Most-urgent job status per session, for the D5 merge.
  const sessionRunStatus = new Map<string, AgentsEntryStatus>();
  for (const job of jobs) {
    if (!isSessionBoundJob(job)) continue;
    const id = job.sessionId as string;
    const status = JOB_STATUS[job.status];
    const current = sessionRunStatus.get(id);
    // running beats everything; failed beats a terminal done.
    if (
      current === undefined ||
      (status === 'running') ||
      (status === 'failed' && current === 'done')
    ) {
      sessionRunStatus.set(id, status);
    }
  }

  const sessionEntries: AgentsEntry[] = sessions.map((session) => ({
    id: session.id,
    kind: 'session',
    title: session.title ?? null,
    status: sessionRunStatus.get(session.id) ?? 'idle',
    lastActivityAt: toMs(session.updatedAt ?? session.createdAt),
  }));

  const jobEntries: AgentsEntry[] = jobs
    .filter((job) => !isSessionBoundJob(job))
    .map((job) => ({
      id: `job:${job.id}`,
      kind: 'job',
      title: job.type,
      status: JOB_STATUS[job.status],
      lastActivityAt: toMs(job.completedAt ?? job.startedAt ?? job.createdAt),
    }));

  return [...sessionEntries, ...jobEntries];
};
