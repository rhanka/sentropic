/** Heavy phases of builder pods whose memory peaks stack on one node (A-LIVE r3.5, owner « Cluster mesh gère la file »). */
export type HeavyPhaseKind = 'install' | 'prebundle' | 'dev' | 'build';
/** Provisional peak costs above the pod base (MiB), measured on the immo variant. A finished `dev` keeps `dev` as the
 * live reservation of its subject until the live stops. */
export const PROVISIONAL_HEAVY_PHASE_COSTS_MIB: Readonly<Record<HeavyPhaseKind, number>> =
  Object.freeze({ install: 980, prebundle: 980, dev: 418, build: 1344 });

export interface HeavyPhaseBudget {
  /** Node memory left to builder pods (one d2-4: 1706 MiB). */
  readonly budgetMiB: number;
  /** Bootstrap resident memory of every pod present on the node (to measure per deployment). */
  readonly podBaseMiB: number;
  readonly costs: Readonly<Record<HeavyPhaseKind, number>>;
  /** A queued waiter or an admitted runner that stops renewing its ticket for longer leaves the queue. */
  readonly entryTtlMs: number;
}
export interface HeavyPhaseEntry {
  readonly subject: string; readonly kind: HeavyPhaseKind; readonly costMiB: number; readonly seq: number;
  touchedAt: number; admittedAt: number | null;
}
export interface HeavyPhaseQueueState { seq: number; pods: string[]; lives: string[]; entries: HeavyPhaseEntry[] }
export interface HeavyPhaseQueueStore {
  /** Serializes one node across replicas; the mutated state persists with the result, or nothing does. */
  transaction<T>(node: string, work: (state: HeavyPhaseQueueState) => T): Promise<T>;
}
export type HeavyPhaseTicket = { readonly subject: string; readonly kind: HeavyPhaseKind };
export type HeavyPhaseTicketStatus = HeavyPhaseTicket & (
  | { readonly state: 'admitted' }
  | { readonly state: 'queued'; readonly position: number; readonly blockedBy: 'fifo' | 'budget' | 'live' }
  | { readonly state: 'none' });
export interface HeavyPhaseQueueStatus {
  readonly node: string; readonly budgetMiB: number; readonly usedMiB: number;
  readonly pods: readonly string[]; readonly lives: readonly string[];
  /** In FIFO order; `position` is 1-based among queued entries and 0 once admitted. */
  readonly entries: ReadonlyArray<HeavyPhaseTicket & { costMiB: number; state: 'admitted' | 'queued'; position: number }>;
}
export interface HeavyPhaseQueue {
  /** Enqueues at the tail, or renews an existing ticket at its position, then admits in strict FIFO. */
  request(node: string, ticket: HeavyPhaseTicket): Promise<HeavyPhaseTicketStatus>;
  /** Ends a ticket; a finished `dev` with `live` becomes the subject's live reservation. */
  finish(node: string, ticket: HeavyPhaseTicket & { live?: boolean }): Promise<void>;
  /** Drops every ticket of a subject (teardown, wake). */
  cancel(node: string, subject: string): Promise<void>;
  /** Pod base and live reservation holds of a subject. */
  hold(node: string, input: { subject: string; pod?: boolean; live?: boolean }): Promise<void>;
  /** After a controller restart: replaces the holds from the durable runtimes; tickets keep their positions. */
  seed(node: string, holds: { pods: readonly string[]; lives: readonly string[] }): Promise<void>;
  status(node: string): Promise<HeavyPhaseQueueStatus>;
}

export const emptyHeavyPhaseQueueState = (): HeavyPhaseQueueState => ({ seq: 0, pods: [], lives: [], entries: [] });
const same = (entry: HeavyPhaseEntry, ticket: HeavyPhaseTicket) => entry.subject === ticket.subject && entry.kind === ticket.kind;
const toggle = (list: string[], subject: string, present: boolean | undefined) => {
  if (present === undefined) return list;
  const rest = list.filter(item => item !== subject);
  return present ? [...rest, subject] : rest;
};

/**
 * A phase is admitted when sum(pod bases) + sum(live reservations) + sum(admitted phases) + its cost fits the budget,
 * strictly in arrival order: the first queued entry that does not fit blocks every later one. A build also requires
 * that no live runs on the node. The queue state is durable through the injected store.
 */
export function createHeavyPhaseQueue(options: { store: HeavyPhaseQueueStore; budget: HeavyPhaseBudget; now(): number }): HeavyPhaseQueue {
  const { budget, store } = options;
  const costs = Object.values(budget.costs);
  if (![budget.budgetMiB, budget.podBaseMiB, budget.entryTtlMs, ...costs].every(value => Number.isFinite(value) && value > 0)
    || costs.length !== 4 || budget.podBaseMiB + Math.max(...costs) > budget.budgetMiB) {
    throw new Error('Invalid heavy-phase budget: positive costs, each admissible with one pod on an empty node');
  }
  const used = (state: HeavyPhaseQueueState) => state.pods.length * budget.podBaseMiB + state.lives.length * budget.costs.dev
    + state.entries.reduce((sum, entry) => sum + (entry.admittedAt === null ? 0 : entry.costMiB), 0);
  const blocker = (state: HeavyPhaseQueueState, entry: HeavyPhaseEntry, total: number) =>
    entry.kind === 'build' && state.lives.length > 0 ? 'live' as const
      : total + entry.costMiB > budget.budgetMiB ? 'budget' as const : null;
  const settle = (state: HeavyPhaseQueueState, now: number) => {
    state.entries = state.entries.filter(entry => now - entry.touchedAt <= budget.entryTtlMs);
    let total = used(state);
    for (const entry of state.entries) {
      if (entry.admittedAt !== null) continue;
      if (blocker(state, entry, total)) return;
      entry.admittedAt = now; total += entry.costMiB;
    }
  };
  const ticketStatus = (state: HeavyPhaseQueueState, ticket: HeavyPhaseTicket): HeavyPhaseTicketStatus => {
    const queued = state.entries.filter(entry => entry.admittedAt === null);
    const index = queued.findIndex(entry => same(entry, ticket));
    if (index > 0) return { ...ticket, state: 'queued', position: index + 1, blockedBy: 'fifo' };
    if (index === 0) return { ...ticket, state: 'queued', position: 1, blockedBy: blocker(state, queued[0], used(state)) ?? 'budget' };
    return { ...ticket, state: state.entries.some(entry => same(entry, ticket)) ? 'admitted' : 'none' };
  };
  const mutate = <T>(node: string, work: (state: HeavyPhaseQueueState, now: number) => T) => store.transaction(node, state => {
    const now = options.now(); settle(state, now);
    const result = work(state, now); settle(state, now); return result;
  });
  return {
    request: (node, ticket) => mutate(node, (state, now) => {
      const entry = state.entries.find(candidate => same(candidate, ticket));
      if (entry) entry.touchedAt = now;
      else state.entries.push({ subject: ticket.subject, kind: ticket.kind, costMiB: budget.costs[ticket.kind],
        seq: ++state.seq, touchedAt: now, admittedAt: null });
      settle(state, now); return ticketStatus(state, ticket);
    }),
    finish: (node, ticket) => mutate(node, state => {
      const entry = state.entries.find(candidate => same(candidate, ticket));
      state.entries = state.entries.filter(candidate => candidate !== entry);
      if (entry?.admittedAt != null && ticket.kind === 'dev' && ticket.live) state.lives = toggle(state.lives, ticket.subject, true);
    }),
    cancel: (node, subject) => mutate(node, state => { state.entries = state.entries.filter(entry => entry.subject !== subject); }),
    hold: (node, input) => mutate(node, state => {
      state.pods = toggle(state.pods, input.subject, input.pod); state.lives = toggle(state.lives, input.subject, input.live);
    }),
    seed: (node, holds) => mutate(node, state => { state.pods = [...new Set(holds.pods)]; state.lives = [...new Set(holds.lives)]; }),
    status: node => mutate(node, state => {
      let position = 0;
      return { node, budgetMiB: budget.budgetMiB, usedMiB: used(state), pods: [...state.pods], lives: [...state.lives],
        entries: state.entries.map(entry => ({ subject: entry.subject, kind: entry.kind, costMiB: entry.costMiB,
          state: entry.admittedAt === null ? 'queued' as const : 'admitted' as const,
          position: entry.admittedAt === null ? ++position : 0 })) };
    }),
  };
}

/** Single-process store (tests, local runtime): one serialized transaction per node, committed only on success. */
export function createMemoryHeavyPhaseQueueStore(): HeavyPhaseQueueStore {
  const nodes = new Map<string, HeavyPhaseQueueState>(); let tail: Promise<unknown> = Promise.resolve();
  return {
    transaction(node, work) {
      const run = tail.then(() => {
        const state = structuredClone(nodes.get(node) ?? emptyHeavyPhaseQueueState());
        const result = work(state); nodes.set(node, state); return result;
      });
      tail = run.catch(() => undefined); return run;
    },
  };
}
