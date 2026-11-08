/** Heavy phases of builder pods whose memory peaks stack on one node (A-LIVE r3.5, owner « Cluster mesh gère la file »). */
export type HeavyPhaseKind = 'install' | 'prebundle' | 'dev' | 'build';
/** Provisional peak costs above the pod base (MiB), measured on the immo variant; `build` is the measured clean-build peak
 * at the 1536Mi pod limit (1388.6 MiB) minus the 19 MiB pod base. A finished `dev` keeps `dev` as the live reservation of its
 * subject until the live stops. */
export const PROVISIONAL_HEAVY_PHASE_COSTS_MIB: Readonly<Record<HeavyPhaseKind, number>> =
  Object.freeze({ install: 980, prebundle: 980, dev: 390, build: 1370 });

export interface HeavyPhaseBudget {
  /** Node memory left to builder pods (one d2-4: 1641 MiB, the 1706 MiB node share minus the 65 MiB of image files the
   * pods map from the shared page cache). */
  readonly budgetMiB: number;
  /** Bootstrap memory charged to every pod present on the node (one d2-4: 19 MiB, measured in the pod cgroup). */
  readonly podBaseMiB: number;
  readonly costs: Readonly<Record<HeavyPhaseKind, number>>;
  /** A queued waiter or an admitted runner that stops renewing its ticket for longer leaves the queue. */
  readonly entryTtlMs: number;
}
/** A pod slot: every builder pod creation takes one first (at most `maxPods` pods present); once admitted the subject
 * holds its pod base until `hold(pod: false)`. */
export type HeavyPhaseSlotKind = HeavyPhaseKind | 'pod';
export interface HeavyPhaseEntry {
  readonly subject: string; readonly kind: HeavyPhaseSlotKind; readonly costMiB: number; readonly seq: number;
  touchedAt: number; admittedAt: number | null;
}
export interface HeavyPhaseQueueState { seq: number; pods: string[]; lives: string[]; entries: HeavyPhaseEntry[] }
export interface HeavyPhaseQueueStore {
  /** Serializes one node across replicas; the mutated state persists with the result, or nothing does. */
  transaction<T>(node: string, work: (state: HeavyPhaseQueueState) => T): Promise<T>;
}
export type HeavyPhaseTicket = { readonly subject: string; readonly kind: HeavyPhaseSlotKind };
export type HeavyPhaseTicketStatus = HeavyPhaseTicket & (
  | { readonly state: 'admitted' }
  | { readonly state: 'queued'; readonly position: number; readonly blockedBy: 'fifo' | 'budget' | 'live' | 'pods' }
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
 * that no live runs on the node, and a pod slot that fewer than `maxPods` pods are present. The queue state is durable
 * through the injected store.
 */
export function createHeavyPhaseQueue(options: { store: HeavyPhaseQueueStore; budget: HeavyPhaseBudget; maxPods: number;
  now(): number }): HeavyPhaseQueue {
  const { budget, store, maxPods } = options;
  if (!Number.isInteger(maxPods) || maxPods < 1) throw new Error('Invalid heavy-phase queue: maxPods must be a positive integer');
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
    let total = used(state); let podsWaiting = false;
    for (const entry of state.entries) {
      if (entry.admittedAt !== null) continue;
      // Pod slots wait in their own arrival order on the pod count; they never hold back the phases of present pods,
      // which are what frees a pod.
      if (entry.kind === 'pod' && (podsWaiting || state.pods.length >= maxPods)) { podsWaiting = true; continue; }
      if (blocker(state, entry, total)) break;
      entry.admittedAt = now; total += entry.costMiB;
      // An admitted pod slot becomes the subject's pod hold (its pod base, counted by `used`) and leaves the entries.
      if (entry.kind === 'pod') state.pods = toggle(state.pods, entry.subject, true);
    }
    state.entries = state.entries.filter(entry => entry.kind !== 'pod' || entry.admittedAt === null);
  };
  const ticketStatus = (state: HeavyPhaseQueueState, ticket: HeavyPhaseTicket): HeavyPhaseTicketStatus => {
    const queued = state.entries.filter(entry => entry.admittedAt === null);
    const index = queued.findIndex(entry => same(entry, ticket));
    if (index >= 0) {
      const entry = queued[index]; const full = state.pods.length >= maxPods;
      // A pod slot waiting on the pod count holds back later pod slots only.
      const ahead = queued.slice(0, index).some(other => entry.kind === 'pod' || other.kind !== 'pod' || !full);
      const blockedBy = entry.kind === 'pod' && full ? 'pods' as const
        : ahead ? 'fifo' as const : blocker(state, entry, used(state)) ?? 'budget' as const;
      return { ...ticket, state: 'queued', position: index + 1, blockedBy };
    }
    const held = ticket.kind === 'pod' ? state.pods.includes(ticket.subject) : state.entries.some(entry => same(entry, ticket));
    return { ...ticket, state: held ? 'admitted' : 'none' };
  };
  const mutate = <T>(node: string, work: (state: HeavyPhaseQueueState, now: number) => T) => store.transaction(node, state => {
    const now = options.now(); settle(state, now);
    const result = work(state, now); settle(state, now); return result;
  });
  return {
    request: (node, ticket) => mutate(node, (state, now) => {
      const entry = state.entries.find(candidate => same(candidate, ticket));
      if (entry) entry.touchedAt = now;
      else if (ticket.kind === 'pod' && state.pods.includes(ticket.subject)) return ticketStatus(state, ticket);
      else state.entries.push({ subject: ticket.subject, kind: ticket.kind,
        costMiB: ticket.kind === 'pod' ? budget.podBaseMiB : budget.costs[ticket.kind],
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
