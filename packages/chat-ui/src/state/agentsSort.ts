/**
 * agentsSort.ts — the ordering required by R9 (SPEC_EVOL_AGENTS_SURFACE D3).
 *
 * Ordering is HIERARCHICAL, not flat: roots are ranked against each other using
 * their AGGREGATE status (own + descendants, D19), and children are ranked only
 * within their own parent. A single flat comparator would interleave the sessions
 * of two expanded agents, which is not a list a human can read.
 *
 * Buckets (lower sorts first):
 *   0  awaiting-input — blocked on the human. Owner ratification 2026-07-29:
 *      it outranks running, because the human is the bottleneck there.
 *   1  running — any kind, so a running job outranks an idle perennial agent.
 *   2  perennial `agent` that is not running.
 *   3  everything else.
 *
 * Recency key differs per bucket, deliberately: a working item (buckets 0–1) is
 * ranked by `lastActivityAt` — what it is doing, not when the user last looked at
 * it, which is also how the reference UI reads (1m, 20m, 26m…). A resting item
 * (buckets 2–3) is ranked by `lastViewedAt`, which is R9's "age of last
 * consultation". Direction is most-recent-first throughout.
 *
 * Pure module: no stores, no browser API, no clock. Node-testable.
 */

import {
  aggregateAgentsEntryStatus,
  type AgentsEntry,
  type AgentsEntryStatus,
} from './agentsEntry.js';

/** A row in display order: parent immediately followed by its own subtree. */
export type AgentsListRow = {
  readonly entry: AgentsEntry;
  /** 0 for a root; +1 per containment level (D19). */
  readonly depth: number;
  /** Own status merged with every descendant's — what the row displays. */
  readonly aggregateStatus: AgentsEntryStatus;
  /** Number of direct children, for the collapsed-count affordance. */
  readonly childCount: number;
};

export type AgentsSortOptions = {
  /**
   * Whether `awaiting-input` gets its own top bucket. DECIDED `true` by the
   * owner (fork O1); kept as a parameter because it *overrides* R9's literal
   * "running first", so the override stays visible rather than baked in.
   */
  readonly awaitingInputFirst?: boolean;
};

const bucketOf = (
  entry: AgentsEntry,
  status: AgentsEntryStatus,
  awaitingInputFirst: boolean,
): number => {
  if (awaitingInputFirst && status === 'awaiting-input') return 0;
  if (status === 'running') return 1;
  if (entry.kind === 'agent') return 2;
  return 3;
};

/**
 * A never-consulted entry has no `lastViewedAt`; it falls back to its activity
 * time rather than sorting to the bottom, so a brand-new session stays visible
 * instead of being buried under everything the user has already opened.
 */
const recencyOf = (entry: AgentsEntry, bucket: number): number =>
  bucket <= 1 ? entry.lastActivityAt : (entry.lastViewedAt ?? entry.lastActivityAt);

/**
 * Build the display-ordered rows from a flat entry array.
 *
 * Robustness, because a feed is partial by nature: an entry whose `parentId`
 * refers to an absent entry is treated as a ROOT rather than dropped, and a
 * `parentId` cycle is broken instead of recursing forever. Silently losing rows
 * would make the list lie about what is running.
 */
export const buildAgentsListRows = (
  entries: readonly AgentsEntry[],
  options: AgentsSortOptions = {},
): AgentsListRow[] => {
  const awaitingInputFirst = options.awaitingInputFirst ?? true;
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const childrenOf = new Map<string, AgentsEntry[]>();
  const roots: AgentsEntry[] = [];

  for (const entry of entries) {
    const parentId = entry.parentId ?? null;
    const hasResolvableParent =
      parentId !== null && parentId !== entry.id && byId.has(parentId);
    if (!hasResolvableParent) {
      roots.push(entry);
      continue;
    }
    const siblings = childrenOf.get(parentId as string);
    if (siblings) siblings.push(entry);
    else childrenOf.set(parentId as string, [entry]);
  }

  const aggregateCache = new Map<string, AgentsEntryStatus>();
  const resolveAggregate = (
    entry: AgentsEntry,
    seen: ReadonlySet<string>,
  ): AgentsEntryStatus => {
    const cached = aggregateCache.get(entry.id);
    if (cached) return cached;
    if (seen.has(entry.id)) return entry.status;
    const nextSeen = new Set(seen).add(entry.id);
    const descendants = (childrenOf.get(entry.id) ?? []).map((child) =>
      resolveAggregate(child, nextSeen),
    );
    const aggregate = aggregateAgentsEntryStatus(entry.status, descendants);
    aggregateCache.set(entry.id, aggregate);
    return aggregate;
  };

  const compare = (a: AgentsEntry, b: AgentsEntry): number => {
    const statusA = resolveAggregate(a, new Set());
    const statusB = resolveAggregate(b, new Set());
    const bucketA = bucketOf(a, statusA, awaitingInputFirst);
    const bucketB = bucketOf(b, statusB, awaitingInputFirst);
    if (bucketA !== bucketB) return bucketA - bucketB;
    const recencyDelta = recencyOf(b, bucketB) - recencyOf(a, bucketA);
    if (recencyDelta !== 0) return recencyDelta;
    // Stable, deterministic last resort so two identical timestamps never
    // reorder between renders.
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  };

  const rows: AgentsListRow[] = [];
  const emitted = new Set<string>();
  const emit = (entry: AgentsEntry, depth: number, seen: ReadonlySet<string>): void => {
    if (seen.has(entry.id) || emitted.has(entry.id)) return;
    const children = childrenOf.get(entry.id) ?? [];
    rows.push({
      entry,
      depth,
      aggregateStatus: resolveAggregate(entry, new Set()),
      childCount: children.length,
    });
    emitted.add(entry.id);
    const nextSeen = new Set(seen).add(entry.id);
    for (const child of [...children].sort(compare)) emit(child, depth + 1, nextSeen);
  };

  for (const root of [...roots].sort(compare)) emit(root, 0, new Set());

  // A `parentId` cycle leaves its members reachable from no root at all, so the
  // pass above would silently drop them — a list that hides a running agent is
  // worse than a list that shows it at the wrong indent. Promote whatever is
  // left to a root, deterministically, until everything has been emitted.
  const stranded = entries.filter((candidate) => !emitted.has(candidate.id));
  for (const entry of [...stranded].sort(compare)) emit(entry, 0, new Set());

  return rows;
};
