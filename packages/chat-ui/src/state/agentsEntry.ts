/**
 * agentsEntry.ts — the `agents` surface view-model (SPEC_EVOL_AGENTS_SURFACE §2, D16/D19).
 *
 * ONE union across four kinds, because the ordering required by R9 crosses them:
 * a running *job* outranks an idle perennial *agent*. Keeping separate lists per
 * kind would make that ordering unexpressible.
 *
 * Containment (D19): an entry may have children — a perennial agent has sessions,
 * a session has runs, a run has delegated/background child runs. The tree is
 * arbitrary-depth; `parentId` is the only structural field, so a host can emit a
 * flat array and let this module rebuild the hierarchy.
 *
 * Pure module: no stores, no browser API, no HTTP. Node-testable.
 */

/** What an entry *is*. Drives the icon and the kind-specific actions. */
export type AgentsEntryKind =
  /** Perennial: holds a durable role in a workspace (R2). Owns sessions. */
  | 'agent'
  /** Ad-hoc conversation — today's chat session. */
  | 'session'
  /** Remote-control session (R4). Read-only in this surface (D10). */
  | 'remote'
  /** Queue job projected as a session (R5). */
  | 'job'
  /** A run inside a session, incl. delegated subagent and background task (D19). */
  | 'run';

/**
 * What an entry is *doing*. `awaiting-input` is the state that carries the
 * pending-question tag (R8) and, per the owner ratification of O1, sorts above
 * `running`.
 */
export type AgentsEntryStatus =
  | 'awaiting-input'
  | 'running'
  /** Resumeable conversation with no live work; never a terminal state. */
  | 'active'
  | 'idle'
  | 'failed'
  | 'done';

/** Connection state of a host-backed entry (`remote`, `agent`), for the status line. */
export type AgentsEntryConnection = 'connected' | 'disconnected' | 'unknown';

export type AgentsEntry = {
  readonly id: string;
  readonly kind: AgentsEntryKind;
  /** Human-readable title; `null` when the host has none (caller resolves a fallback label). */
  readonly title: string | null;
  readonly status: AgentsEntryStatus;
  /** Parent in the containment tree (D19); `null`/absent for a root. */
  readonly parentId?: string | null;
  /** Workspace scope — drives R10 and the `owner/repo` status line. */
  readonly workspaceId?: string;
  readonly workspaceLabel?: string;
  /** Epoch ms of the last activity of the entry itself (not of its children). */
  readonly lastActivityAt: number;
  /** Epoch ms this principal last *consulted* it (R9); absent = never consulted. */
  readonly lastViewedAt?: number;
  readonly connection?: AgentsEntryConnection;
  /** Excerpt rendered in the pending-question tag/card (R8). */
  readonly pendingPrompt?: string;
  /** Originating CLI host for a transcript-backed entry (R12): claude, codex, agy… */
  readonly hostKind?: string;
};

/**
 * Feed port (D2). chat-ui renders; the host supplies the data — from HTTP, from
 * h2a, from the queue, from a CLI transcript. The surface is therefore
 * buildable and testable before any of those exist.
 */
export type AgentsFeedScope = {
  /** `false` = current workspace only, `true` = across workspaces (R10). */
  readonly allWorkspaces: boolean;
  /** Current workspace, required when `allWorkspaces` is false. */
  readonly workspaceId?: string;
};

export type AgentsFeedPort = {
  list: (scope: AgentsFeedScope) => Promise<readonly AgentsEntry[]>;
  /** Optional live updates; returns an unsubscribe. Absent = poll/refresh only. */
  subscribe?: (
    scope: AgentsFeedScope,
    onChange: (entries: readonly AgentsEntry[]) => void,
  ) => () => void;
};

/** Urgency rank — lower is more urgent. Shared by the comparator and the aggregator. */
const STATUS_URGENCY: Record<AgentsEntryStatus, number> = {
  'awaiting-input': 0,
  running: 1,
  failed: 2,
  active: 3,
  idle: 4,
  done: 5,
};

export const agentsEntryStatusUrgency = (status: AgentsEntryStatus): number =>
  STATUS_URGENCY[status];

/**
 * Aggregate a parent's displayed status from its own status and its descendants'
 * (D19): the most urgent wins, so an `awaiting-input` buried in a delegated run
 * surfaces on the top-level row instead of staying invisible.
 */
export const aggregateAgentsEntryStatus = (
  own: AgentsEntryStatus,
  descendants: readonly AgentsEntryStatus[],
): AgentsEntryStatus =>
  [own, ...descendants].reduce((mostUrgent, candidate) =>
    agentsEntryStatusUrgency(candidate) < agentsEntryStatusUrgency(mostUrgent)
      ? candidate
      : mostUrgent,
  );
