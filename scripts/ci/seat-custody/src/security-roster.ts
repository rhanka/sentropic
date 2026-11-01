// ACT-L06a (r6 §7.2 W2, r4 §3): persistent provider-first/account-second rotation over
// the single CustodyStateV1 allocator in security-seat-writer. Initial ring
// OpenAI → Meta → Anthropic → Google → Mistral; within a provider accounts follow
// trusted enrollment order (ties by opaque accountRef). Aliases and refresh families of
// one underlying account share one quota family and one account turn. Cursors,
// tombstones, reservations, admissions and refusal skips persist across restart,
// midnight, epoch/generation replacement and repository moves. Zero payment on
// exhaustion: a full bounded traversal publishes waiting-seat and never calls a paid
// route. L6-H qualification is billing-first and additionally requires the r6 §4.3.3
// public-execution disposition (T6-P1) before a route is admitted.
import { ensure, type SeatClass } from './seat-admission.ts';
import { assertQualifiedModel, type OperationModels } from './ci-seat-broker.ts';
import { admitPublicExecution, validateDisposition } from './seat-public-execution.ts';
import { validateState, type AdmissionV1, type CustodyStateV1, type Reservation, type RosterEntryV1, type SkipV1 } from './custody-state-store.ts';

export const PROVIDER_RING = ['openai', 'meta', 'anthropic', 'google', 'mistral'] as const;
export type Provider = (typeof PROVIDER_RING)[number];
export const CLI_PROVIDER: Record<string, Provider> = {
  CODEX: 'openai', MUSE: 'meta', CLAUDE: 'anthropic', AGY: 'google', VIBE: 'mistral',
};

// r4 §3.2 required typed skip codes.
export const SKIP_CODES = [
  'identity-unverified', 'alias-conflict', 'route-unqualified', 'model-incompatible',
  'billing-unverified', 'quota-unreadable', 'quota-stale', 'quota-reserve', 'quota-exhausted',
  'busy', 'refresh-pending', 'generation-mismatch', 'expiry-bound', 'waiting-priority-reservation',
  'cli-cap', 'account-cap', 'fleet-cap', 'actions-capacity-unavailable', 'cancelled', 'off',
] as const;
export type SkipCode = (typeof SKIP_CODES)[number];

// r6 §2 capacity layer: four security inference units/day fleet-wide, two/account
// slot/day, ten/CLI/day. Constants: adding accounts never enlarges them.
export const CAPS = { fleetSecurityUnitsPerDay: 4, accountSlotUnitsPerDay: 2, cliUnitsPerDay: 10 } as const;

export type RosterEntry = RosterEntryV1;
export type Admission = AdmissionV1;
export type SkipRecord = SkipV1;

export type TaskSpec = {
  reviewInputKey: string; units: number; day: string; campaign: string;
  generation: number; purpose: 'report-review' | 'assisted-repair' | 'ci';
};

export type EligibilityInput = {
  off?: boolean; identityVerified?: boolean; routeQualified?: boolean; modelCompatible?: boolean;
  billingVerified?: boolean; generationOk?: boolean; refreshPending?: boolean; lifetimeOk?: boolean;
  priorityDeclared?: boolean; busy?: boolean; actionsCapacity?: boolean; cancelled?: boolean;
  quota?: { readable: boolean; observedAt: number; now: number; remaining: number[] } | null;
};
export type Eligibility = { ok: true } | { ok: false; code: SkipCode };

export type SelectionResult =
  | { kind: 'dedup'; prior: Admission; inferenceCalls: 0 }
  | { kind: 'selected'; entry: RosterEntry; reservation: Reservation; skips: SkipRecord[] }
  | { kind: 'waiting-seat'; nextEligible: string; skips: SkipRecord[]; paidAttempts: 0; runnerReleased: true };

export function providerOf(entry: RosterEntry): Provider {
  const p = entry.provider ?? CLI_PROVIDER[entry.cli];
  ensure(p && (PROVIDER_RING as readonly string[]).includes(p), 'identity-unverified');
  return p;
}

export function enrollAccount(state: CustodyStateV1, entry: {
  account: string; cli: string; slot: string; provider?: string; displayName?: string;
  aliases?: string[]; quotaFamilyRef?: string; refreshFamilyRef?: string;
}): RosterEntry {
  ensure(/^[A-Z]+_\d{2}$/.test(entry.slot) && entry.slot.startsWith(`${entry.cli}_`), 'slot-shape');
  ensure(!state.roster.some(e => e.slot === entry.slot), 'slot-duplicate');
  ensure(!state.roster.some(e => e.account === entry.account), 'account-duplicate');
  const record: RosterEntry = { provider: entry.provider ?? CLI_PROVIDER[entry.cli], ...entry };
  ensure(record.provider && (PROVIDER_RING as readonly string[]).includes(record.provider), 'provider-unknown');
  state.roster.push(record);
  state.rosterRevision += 1;
  return record;
}

// Rename never reorders the roster and never moves a cursor.
export function renameAccount(state: CustodyStateV1, accountRef: string, displayName: string): void {
  const entry = state.roster.find(e => e.account === accountRef);
  ensure(entry, 'account-unknown');
  entry.displayName = displayName;
  state.rosterRevision += 1;
}

// Removal tombstones the entry in place: cursor successors keep their indices.
export function removeAccount(state: CustodyStateV1, accountRef: string): void {
  const entry = state.roster.find(e => e.account === accountRef);
  ensure(entry, 'account-unknown');
  entry.tombstoned = true;
  if (!state.tombstones.includes(accountRef)) state.tombstones.push(accountRef);
}

export function activeAccounts(state: CustodyStateV1, provider?: Provider): RosterEntry[] {
  return state.roster.filter(e => !e.tombstoned && !state.tombstones.includes(e.account)
    && (!provider || providerOf(e) === provider));
}

// r4 §3.2 step 3 gate order. Quota must be strictly above 20% and no older than 30 s.
export function checkEligibility(task: TaskSpec, input: EligibilityInput): Eligibility {
  if (input.off) return { ok: false, code: 'off' };
  if (input.identityVerified === false) return { ok: false, code: 'identity-unverified' };
  if (input.routeQualified === false) return { ok: false, code: 'route-unqualified' };
  if (input.modelCompatible === false) return { ok: false, code: 'model-incompatible' };
  if (input.billingVerified === false) return { ok: false, code: 'billing-unverified' };
  if (input.generationOk === false) return { ok: false, code: 'generation-mismatch' };
  if (input.refreshPending) return { ok: false, code: 'refresh-pending' };
  if (input.lifetimeOk === false) return { ok: false, code: 'expiry-bound' };
  if (input.priorityDeclared === false) return { ok: false, code: 'waiting-priority-reservation' };
  const q = input.quota;
  if (!q || !q.readable) return { ok: false, code: 'quota-unreadable' };
  if (q.now - q.observedAt > 30_000) return { ok: false, code: 'quota-stale' };
  if (q.remaining.length === 0 || q.remaining.some(n => !(n > 20))) return { ok: false, code: 'quota-exhausted' };
  if (Math.min(...q.remaining) - task.units <= 20) return { ok: false, code: 'quota-reserve' };
  if (input.busy) return { ok: false, code: 'busy' };
  if (input.actionsCapacity === false) return { ok: false, code: 'actions-capacity-unavailable' };
  if (input.cancelled) return { ok: false, code: 'cancelled' };
  return { ok: true };
}

const CAP_CODES = new Set(['fleet-cap', 'account-cap', 'cli-cap']);

// Single-writer reservation with the r6 §2 capacity layer. Throws the typed cap code.
export function reserveForAccount(state: CustodyStateV1, entry: RosterEntry, task: TaskSpec): Reservation {
  const family = entry.quotaFamilyRef ?? entry.account;
  const dayReservations = state.reservations.filter(r => r.day === task.day);
  if ((state.counters.day[task.day] ?? 0) + task.units > CAPS.fleetSecurityUnitsPerDay) throw new Error('fleet-cap');
  const accountHeld = dayReservations.filter(r => r.family === family).reduce((n, r) => n + r.held, 0);
  if (accountHeld + task.units > CAPS.accountSlotUnitsPerDay) throw new Error('account-cap');
  const cliHeld = dayReservations.filter(r => r.cli === entry.cli).reduce((n, r) => n + r.held, 0);
  if (cliHeld + task.units > CAPS.cliUnitsPerDay) throw new Error('cli-cap');
  const ref = `${task.day}:${entry.cli}:${entry.account}:${state.allocationSeq + 1}`;
  state.allocationSeq += 1;
  const reservation: Reservation = {
    ref, family, credentialGeneration: state.generation, capacity: task.units, held: task.units,
    status: 'active', day: task.day, cli: entry.cli, accountRef: entry.account,
  };
  state.reservations.push(reservation);
  state.accounting.authorized += task.units;
  state.accounting.held += task.units;
  state.counters.day[task.day] = (state.counters.day[task.day] ?? 0) + task.units;
  state.counters.fleet += task.units;
  return reservation;
}

// r4 §3.2 admission algorithm: each provider at most once from nextProviderRef, each
// distinct account at most once from its account cursor, an alias is never a second
// attempt. The whole selection runs on a draft and commits atomically only on success;
// refusal receipts persist even when the traversal returns to the same cursor.
export function selectRoute(state: CustodyStateV1, task: TaskSpec,
  isEligible: (entry: RosterEntry, task: TaskSpec) => Eligibility): SelectionResult {
  validateState(state);
  ensure(task.units > 0 && Number.isSafeInteger(task.units), 'case-bound');
  const prior = (state.admissions ?? []).find(a => a.reviewInputKey === task.reviewInputKey);
  if (prior) return { kind: 'dedup', prior, inferenceCalls: 0 };
  const draft = structuredClone(state);
  const skips: SkipRecord[] = [];
  const startP = draft.cursors['provider'] ?? 0;
  const seenFamilies = new Set<string>();
  const seenAccounts = new Set<string>();
  for (let step = 0; step < PROVIDER_RING.length; step++) {
    const provider = PROVIDER_RING[(startP + step) % PROVIDER_RING.length];
    const accounts = activeAccounts(draft, provider);
    if (accounts.length === 0) continue;
    const startA = draft.cursors[`account:${provider}`] ?? 0;
    // Pass 1 over the provider's accounts in cursor order: one representative per
    // quota family; every further alias of a family is an alias-conflict skip and is
    // never a second attempt (no eligibility probe is spent on it).
    const reps: { entry: RosterEntry; k: number }[] = [];
    for (let k = 0; k < accounts.length; k++) {
      const entry = accounts[(startA + k) % accounts.length];
      if (seenAccounts.has(entry.account)) continue;
      seenAccounts.add(entry.account);
      const family = entry.quotaFamilyRef ?? entry.account;
      if (seenFamilies.has(family)) {
        skips.push({ code: 'alias-conflict', accountRef: entry.account, provider, at: task.day });
        continue;
      }
      seenFamilies.add(family);
      reps.push({ entry, k });
    }
    // Pass 2: the first eligible representative of the provider wins its turn.
    for (const { entry, k } of reps) {
      const verdict = isEligible(entry, task);
      if (!verdict.ok) {
        skips.push({ code: verdict.code, accountRef: entry.account, provider, at: task.day });
        continue;
      }
      let reservation: Reservation;
      try {
        reservation = reserveForAccount(draft, entry, task);
      } catch (e) {
        const code = (e as Error).message;
        ensure(CAP_CODES.has(code), code);
        skips.push({ code: code as SkipCode, accountRef: entry.account, provider, at: task.day });
        continue;
      }
      draft.cursors['provider'] = (startP + step + 1) % PROVIDER_RING.length;
      draft.cursors[`account:${provider}`] = (startA + k + 1) % accounts.length;
      const admission: Admission = {
        reviewInputKey: task.reviewInputKey, accountRef: entry.account,
        reservationRef: reservation.ref, outcome: 'reserved',
      };
      draft.admissions.push(admission);
      validateState(draft);
      Object.assign(state, draft);
      return { kind: 'selected', entry, reservation, skips };
    }
  }
  state.skips.push(...skips);
  return { kind: 'waiting-seat', nextEligible: 'unknown', skips, paidAttempts: 0, runnerReleased: true };
}

// Once-only settlement: releases only proven unused units, exactly once.
export function settleReservation(state: CustodyStateV1, ref: string, spent: number): { released: number } {
  const r = state.reservations.find(x => x.ref === ref);
  ensure(r && !r.settled, 'already-settled-or-unknown');
  ensure(Number.isSafeInteger(spent) && spent >= 0 && spent <= r.capacity, 'settlement-overrun');
  const released = r.capacity - spent;
  r.held = spent;
  r.settled = true;
  state.accounting.held -= r.capacity;
  state.accounting.spent += spent;
  state.accounting.released += released;
  validateState(state);
  return { released };
}

// Reconciliation migrates balances/reservations atomically; an alias merge cannot refund.
export function mergeAliasFamilies(state: CustodyStateV1, fromFamily: string, toFamily: string): void {
  ensure(fromFamily !== toFamily, 'alias-merge-same-family');
  for (const r of state.reservations) if (r.family === fromFamily) r.family = toFamily;
  validateState(state);
}

// L6-F: the access projection of one account exposes only its own slot; a ticket bound
// to another account is refused. Owner active profiles are never touched.
export function projectForAccount(state: CustodyStateV1, accountRef: string) {
  const entry = state.roster.find(e => e.account === accountRef);
  ensure(entry, 'account-unknown');
  return {
    accountRef: entry.account, slot: entry.slot,
    projectionName: `SEAT_USE_${entry.slot}`, quotaFamilyRef: entry.quotaFamilyRef ?? entry.account,
  };
}

export function assertTicketAccount(claimsAccountRef: string, entry: RosterEntry): void {
  ensure(claimsAccountRef === entry.account, 'ticket-account-mismatch');
}

// Refresh fences admission for the family and drains aliases/descendants; only a
// later-run verified successor with a higher generation is admitted.
export function beginRefresh(state: CustodyStateV1, quotaFamilyRef: string): void {
  if (!state.refreshIntents.includes(quotaFamilyRef)) state.refreshIntents.push(quotaFamilyRef);
  for (const r of state.reservations) if (r.family === quotaFamilyRef) r.status = 'fenced';
}

export function admitSuccessor(state: CustodyStateV1, quotaFamilyRef: string,
  proof: { laterRunVerified: boolean; generation: number }): void {
  ensure(proof.laterRunVerified && proof.generation > state.generation, 'generation-mismatch');
  state.refreshIntents = state.refreshIntents.filter(f => f !== quotaFamilyRef);
  for (const r of state.reservations) if (r.family === quotaFamilyRef && r.status === 'fenced') r.status = 'active';
}

// L6-H per-account route qualification receipt (r6 §7.2 ACT-L06a: billing-first quota/
// lifecycle/model proof plus the §4.3.3 public-execution disposition). Live evidence
// stays pending for real accounts; synthetic receipts only exercise the gate.
export type AccountQualificationV1 = {
  schemaVersion: 1; accountRef: string; provider: Provider; cli: string;
  route: { operation: string; model: string; endpoint: string; capabilities: string[]; purpose: string };
  billingFirst: { verifiedAt: string; noOverageEvidenceDigest: string; noPayment: boolean };
  quotaReader: { kind: string; observedAt: string; remaining: number[]; freshnessSec: number };
  lifecycle: { mode: string; lifetimeMs: number; validUntil: string };
  isolation: { termsDigest: string; entitlementDigest: string };
  publicExecutionDigest: string;
  checkedAt: string; validUntil: string; status: 'qualified' | 'disabled'; reason?: string;
};

export function qualifyAccountRoute(state: CustodyStateV1, receipt: unknown, ctx: {
  now: number; operationModels: OperationModels; operation: string; dispositions: unknown[];
}): AccountQualificationV1 {
  const r = receipt as AccountQualificationV1;
  ensure(r && typeof r === 'object' && r.schemaVersion === 1, 'qualification-schema');
  const entry = (state.roster ?? []).find(e => e.account === r.accountRef);
  ensure(entry, 'account-unknown');
  ensure(r.provider === providerOf(entry), 'provider-mismatch');
  ensure(r.cli === entry.cli, 'cli-mismatch');
  ensure(r.billingFirst && r.billingFirst.noPayment === true
    && /^[0-9a-f]{64}$/.test(r.billingFirst.noOverageEvidenceDigest ?? ''), 'billing-unverified');
  ensure(Date.parse(r.billingFirst.verifiedAt) <= Date.parse(r.checkedAt), 'billing-not-first');
  ensure(r.quotaReader && r.quotaReader.kind === 'non-inference' && r.quotaReader.freshnessSec <= 30
    && r.quotaReader.remaining.length > 0 && r.quotaReader.remaining.every(n => n > 20), 'quota-reader-invalid');
  ensure(r.lifecycle && Number.isFinite(r.lifecycle.lifetimeMs) && r.lifecycle.lifetimeMs > 0
    && Date.parse(r.lifecycle.validUntil) > ctx.now, 'lifecycle-invalid');
  ensure(Date.parse(r.validUntil) > ctx.now, 'qualification-expired');
  assertQualifiedModel(r.route?.model, ctx.operationModels, ctx.operation, ctx.now);
  ensure(r.route && nonEmptyStr(r.route.endpoint) && Array.isArray(r.route.capabilities) && r.route.capabilities.length > 0, 'route-incomplete');
  const disp = (ctx.dispositions ?? []).find(d => {
    try { return validateDisposition(d).evidenceDigest === r.publicExecutionDigest; } catch { return false; }
  });
  ensure(disp, 'public-execution-disposition-missing');
  const verdict = admitPublicExecution(disp, {
    provider: r.provider, route: `${r.route.operation}:${r.route.model}`,
    client: r.cli, model: r.route.model, now: ctx.now,
  });
  ensure(verdict.ok, `public-execution-${verdict.ok ? '' : verdict.code}`);
  const qualified: AccountQualificationV1 = { ...r, status: 'qualified' };
  state.routeQualifications = [...(state.routeQualifications ?? []), qualified];
  return qualified;
}

const nonEmptyStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

// Unqualified entries stay visible and never receive a speculative smoke.
export function disableAccount(state: CustodyStateV1, accountRef: string, reason: string): void {
  const entry = state.roster.find(e => e.account === accountRef);
  ensure(entry, 'account-unknown');
  state.routeQualifications = [...(state.routeQualifications ?? []), {
    schemaVersion: 1, accountRef, provider: providerOf(entry), cli: entry.cli,
    status: 'disabled', reason, checkedAt: '', validUntil: '',
  }];
}

export function qualifiedRoutes(state: CustodyStateV1, purpose?: string): AccountQualificationV1[] {
  return (state.routeQualifications ?? []).filter(q => {
    const r = q as AccountQualificationV1;
    return r.status === 'qualified' && (!purpose || r.route?.purpose === purpose);
  }) as AccountQualificationV1[];
}

// r4 §2.2 / r6 §7.2 ACT-L06a: while A1 (roster completeness) is unresolved the public
// review coverage is review-partial-roster with the actual qualified count and every
// unresolved record. No L6-A/all-account closure is claimed.
export function reviewCoverage(state: CustodyStateV1, unresolvedRecords: string[]): {
  status: 'review-partial-roster' | 'complete-for-declared-input'; qualifiedCount: number; unresolved: string[];
} {
  const qualifiedCount = qualifiedRoutes(state).length;
  if (unresolvedRecords.length > 0) {
    return { status: 'review-partial-roster', qualifiedCount, unresolved: [...unresolvedRecords] };
  }
  return { status: 'complete-for-declared-input', qualifiedCount, unresolved: [] };
}

// One qualified route can enable report-only review; assisted repair additionally
// needs the qualified distinct author/reviewer model set (contributor-set rule).
export function canEnablePurpose(state: CustodyStateV1, purpose: 'report-review' | 'assisted-repair',
  unresolvedRecords: string[]): { enabled: boolean; reason?: string; coverage: ReturnType<typeof reviewCoverage> } {
  const coverage = reviewCoverage(state, unresolvedRecords);
  if (purpose === 'report-review') {
    if (qualifiedRoutes(state, 'report-review').length >= 1) return { enabled: true, coverage };
    return { enabled: false, reason: 'no-qualified-report-review-route', coverage };
  }
  // Assisted repair needs the qualified distinct author/reviewer model set across all
  // individually qualified routes (contributor-set rule), not a single route.
  const routes = qualifiedRoutes(state);
  const models = new Set(routes.map(r => r.route?.model));
  if (routes.length >= 2 && models.size >= 2) return { enabled: true, coverage };
  return { enabled: false, reason: 'distinct-author-reviewer-models-required', coverage };
}

export type { SeatClass };
