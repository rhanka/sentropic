// ACT-L06a (r6 §7.2 W2, §6.4 rows L9-C/L9-F, §7.3 T5-N2 C/ half): synthetic L6-B–G
// rotation/allocator cases over the single CustodyStateV1 store, two Codex/two Vibe
// fixtures, L6-H qualification gating and review-partial-roster publication.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeGenesisState, validateState, type CustodyStateV1 } from '../src/custody-state-store.ts';
import {
  CAPS, PROVIDER_RING, activeAccounts, admitSuccessor, assertTicketAccount, beginRefresh,
  canEnablePurpose, checkEligibility, disableAccount, enrollAccount, mergeAliasFamilies,
  projectForAccount, qualifyAccountRoute, removeAccount, renameAccount, reviewCoverage,
  reserveForAccount, selectRoute, settleReservation, type Eligibility, type TaskSpec,
} from '../src/security-roster.ts';
import { admitPublicExecution, validateDisposition } from '../src/seat-public-execution.ts';

const NOW = Date.parse('2026-11-02T06:45:00Z');
const okQuota = { readable: true, observedAt: NOW - 1000, now: NOW, remaining: [80] };
const task = (over: Partial<TaskSpec> = {}): TaskSpec => ({
  reviewInputKey: 'rk-1', units: 1, day: '2026-11-02', campaign: 'review', generation: 1,
  purpose: 'report-review', ...over,
});
const allOk = (t: TaskSpec): Eligibility => checkEligibility(t, { quota: okQuota });

function twoProviderState(): CustodyStateV1 {
  const s = makeGenesisState();
  enrollAccount(s, { account: 'A1', cli: 'CODEX', slot: 'CODEX_00', displayName: 'A one' });
  enrollAccount(s, { account: 'A2', cli: 'CODEX', slot: 'CODEX_01', displayName: 'A two' });
  enrollAccount(s, { account: 'B1', cli: 'MUSE', slot: 'MUSE_00', displayName: 'B one' });
  return s;
}

test('L6-B: providers A/B with accounts A1/A2/B1 select A1, B1, A2, B1, A1', () => {
  const s = twoProviderState();
  const picked: string[] = [];
  for (let i = 0; i < 5; i++) {
    const r = selectRoute(s, task({ reviewInputKey: `rk-${i}`, day: `2026-11-0${i + 2}` }), allOk);
    assert.equal(r.kind, 'selected');
    if (r.kind === 'selected') picked.push(r.entry.account);
  }
  assert.deepEqual(picked, ['A1', 'B1', 'A2', 'B1', 'A1']);
  assert.equal(s.reservations.length, 5);
  assert.equal(s.admissions.length, 5);
  validateState(s);
});

test('L6-B: exhausted A1 skips to A2 within provider A turn; all-A-refuse lets B run', () => {
  const s = twoProviderState();
  const r1 = selectRoute(s, task(), (e, t) => e.account === 'A1'
    ? checkEligibility(t, { quota: { readable: true, observedAt: NOW, now: NOW, remaining: [20] } })
    : allOk(t));
  assert.equal(r1.kind, 'selected');
  if (r1.kind === 'selected') {
    assert.equal(r1.entry.account, 'A2');
    assert.deepEqual(r1.skips.map(x => [x.accountRef, x.code]), [['A1', 'quota-exhausted']]);
  }
  const s2 = twoProviderState();
  const r2 = selectRoute(s2, task({ reviewInputKey: 'rk-x' }), (e, t) => e.account === 'B1' ? allOk(t)
    : { ok: false, code: 'quota-exhausted' });
  assert.equal(r2.kind, 'selected');
  if (r2.kind === 'selected') {
    assert.equal(r2.entry.account, 'B1');
    assert.deepEqual(r2.skips.map(x => x.accountRef), ['A1', 'A2']);
  }
});

test('L6-B: full five-provider ring rotates openai→meta→anthropic→google→mistral→openai', () => {
  const s = makeGenesisState();
  enrollAccount(s, { account: 'o1', cli: 'CODEX', slot: 'CODEX_00' });
  enrollAccount(s, { account: 'm1', cli: 'MUSE', slot: 'MUSE_00' });
  enrollAccount(s, { account: 'a1', cli: 'CLAUDE', slot: 'CLAUDE_00' });
  enrollAccount(s, { account: 'g1', cli: 'AGY', slot: 'AGY_00' });
  enrollAccount(s, { account: 'v1', cli: 'VIBE', slot: 'VIBE_00' });
  assert.deepEqual([...PROVIDER_RING], ['openai', 'meta', 'anthropic', 'google', 'mistral']);
  const picked: string[] = [];
  for (let i = 0; i < 6; i++) {
    const r = selectRoute(s, task({ reviewInputKey: `rk-${i}`, day: `2026-11-0${i + 2}` }), allOk);
    assert.equal(r.kind, 'selected');
    if (r.kind === 'selected') picked.push(r.entry.account);
  }
  assert.deepEqual(picked, ['o1', 'm1', 'a1', 'g1', 'v1', 'o1']);
});

test('T5-N2/L6-B: two Codex and two Vibe fixtures with duplicate display names stay distinct accounts', () => {
  const s = makeGenesisState();
  enrollAccount(s, { account: 'codex-1', cli: 'CODEX', slot: 'CODEX_00', displayName: 'Codex' });
  enrollAccount(s, { account: 'codex-2', cli: 'CODEX', slot: 'CODEX_01', displayName: 'Codex' });
  enrollAccount(s, { account: 'vibe-1', cli: 'VIBE', slot: 'VIBE_00', displayName: 'Vibe' });
  enrollAccount(s, { account: 'vibe-2', cli: 'VIBE', slot: 'VIBE_01', displayName: 'Vibe' });
  assert.equal(activeAccounts(s).length, 4);
  const picked = new Set<string>();
  for (let i = 0; i < 4; i++) {
    const r = selectRoute(s, task({ reviewInputKey: `rk-${i}`, day: `2026-11-0${i + 2}` }), allOk);
    assert.equal(r.kind, 'selected');
    if (r.kind === 'selected') picked.add(r.entry.account);
  }
  assert.deepEqual([...picked].sort(), ['codex-1', 'codex-2', 'vibe-1', 'vibe-2']);
});

test('L6-B: new enrollment appends without reorder; rename keeps order and cursor; removal tombstones with cursor successor', () => {
  const s = twoProviderState();
  selectRoute(s, task({ reviewInputKey: 'rk-0', day: '2026-11-02' }), allOk);
  enrollAccount(s, { account: 'A3', cli: 'CODEX', slot: 'CODEX_02' });
  assert.deepEqual(s.roster.map(e => e.account), ['A1', 'A2', 'B1', 'A3']);
  const cursorBefore = { ...s.cursors };
  renameAccount(s, 'A1', 'renamed');
  assert.deepEqual(s.roster.map(e => e.account), ['A1', 'A2', 'B1', 'A3']);
  assert.equal(s.roster[0].displayName, 'renamed');
  assert.deepEqual(s.cursors, cursorBefore);
  removeAccount(s, 'B1');
  assert.deepEqual(s.tombstones, ['B1']);
  assert.equal(s.roster.length, 4);
  assert.equal(s.roster.find(e => e.account === 'B1')?.tombstoned, true);
  assert.deepEqual(s.cursors, cursorBefore);
  assert.equal(activeAccounts(s, 'meta').length, 0);
  const r = selectRoute(s, task({ reviewInputKey: 'rk-1', day: '2026-11-03' }), allOk);
  assert.equal(r.kind, 'selected');
  if (r.kind === 'selected') assert.notEqual(r.entry.account, 'B1');
});

test('L6-C: aliases and two refresh families share one quota family and one turn; caps do not grow with a third account', () => {
  const s = makeGenesisState();
  enrollAccount(s, { account: 'A1', cli: 'CODEX', slot: 'CODEX_00', quotaFamilyRef: 'qf-a', refreshFamilyRef: 'rf-1', aliases: ['A1-alias'] });
  enrollAccount(s, { account: 'A1-alias', cli: 'CODEX', slot: 'CODEX_01', quotaFamilyRef: 'qf-a', refreshFamilyRef: 'rf-2' });
  enrollAccount(s, { account: 'A2', cli: 'CODEX', slot: 'CODEX_02', quotaFamilyRef: 'qf-b' });
  let attempts = 0;
  const r = selectRoute(s, task(), (e, t) => { attempts++; return allOk(t); });
  assert.equal(r.kind, 'selected');
  if (r.kind === 'selected') {
    assert.equal(r.entry.account, 'A1');
    assert.equal(attempts, 1);
    assert.deepEqual(r.skips.map(x => [x.accountRef, x.code]), [['A1-alias', 'alias-conflict']]);
    assert.equal(r.reservation.family, 'qf-a');
  }
  assert.equal(CAPS.fleetSecurityUnitsPerDay, 4);
  assert.equal(CAPS.accountSlotUnitsPerDay, 2);
  assert.equal(CAPS.cliUnitsPerDay, 10);
  const s2 = makeGenesisState();
  enrollAccount(s2, { account: 'A1', cli: 'CODEX', slot: 'CODEX_00' });
  enrollAccount(s2, { account: 'A2', cli: 'CODEX', slot: 'CODEX_01' });
  enrollAccount(s2, { account: 'A3', cli: 'CODEX', slot: 'CODEX_02' });
  assert.throws(() => {
    for (let i = 0; i < 5; i++) reserveForAccount(s2, s2.roster[i % 3], task({ reviewInputKey: `r${i}` }));
  }, /fleet-cap/);
});

test('L6-C: cursors, tombstones, reservations and admissions persist across restart, midnight, epoch/generation and repository move', () => {
  const s = twoProviderState();
  selectRoute(s, task({ reviewInputKey: 'rk-0', day: '2026-11-02' }), allOk);
  selectRoute(s, task({ reviewInputKey: 'rk-1', day: '2026-11-02' }), allOk);
  const reloaded = JSON.parse(JSON.stringify(s)) as CustodyStateV1;
  validateState(reloaded);
  assert.deepEqual(reloaded.cursors, s.cursors);
  const r = selectRoute(reloaded, task({ reviewInputKey: 'rk-2', day: '2026-11-03' }), allOk);
  assert.equal(r.kind, 'selected');
  if (r.kind === 'selected') assert.equal(r.entry.account, 'A2');
  assert.equal(reloaded.counters.day['2026-11-03'], 1);
  const afterThird = JSON.stringify(reloaded.cursors);
  reloaded.storeEpoch = 2;
  reloaded.generation = 2;
  reloaded.priorCommittedGeneration = 1;
  validateState(reloaded);
  assert.equal(JSON.stringify(reloaded.cursors), afterThird);
  const moved = JSON.parse(JSON.stringify(reloaded)) as CustodyStateV1;
  validateState(moved);
  assert.equal(JSON.stringify(moved.cursors), afterThird);
});

test('L6-D: every skip category is typed and produces zero send', () => {
  const cases: [Partial<Parameters<typeof checkEligibility>[1]>, string][] = [
    [{ off: true }, 'off'],
    [{ identityVerified: false }, 'identity-unverified'],
    [{ routeQualified: false }, 'route-unqualified'],
    [{ modelCompatible: false }, 'model-incompatible'],
    [{ billingVerified: false }, 'billing-unverified'],
    [{ generationOk: false }, 'generation-mismatch'],
    [{ refreshPending: true }, 'refresh-pending'],
    [{ lifetimeOk: false }, 'expiry-bound'],
    [{ priorityDeclared: false }, 'waiting-priority-reservation'],
    [{ quota: null }, 'quota-unreadable'],
    [{ quota: { readable: false, observedAt: NOW, now: NOW, remaining: [80] } }, 'quota-unreadable'],
    [{ quota: { readable: true, observedAt: NOW - 31_000, now: NOW, remaining: [80] } }, 'quota-stale'],
    [{ quota: { readable: true, observedAt: NOW, now: NOW, remaining: [20] } }, 'quota-exhausted'],
    [{ quota: { readable: true, observedAt: NOW, now: NOW, remaining: [] } }, 'quota-exhausted'],
    [{ quota: { readable: true, observedAt: NOW, now: NOW, remaining: [21] } }, 'quota-reserve'],
    [{ busy: true }, 'busy'],
    [{ actionsCapacity: false }, 'actions-capacity-unavailable'],
  ];
  for (const [input, code] of cases) {
    const verdict = checkEligibility(task(), { quota: okQuota, ...input });
    assert.equal(verdict.ok, false);
    if (!verdict.ok) assert.equal(verdict.code, code, JSON.stringify(input));
  }
  const s = twoProviderState();
  const r = selectRoute(s, task(), () => ({ ok: false, code: 'quota-unreadable' }));
  assert.equal(r.kind, 'waiting-seat');
  if (r.kind === 'waiting-seat') {
    assert.equal(r.skips.length, 3);
    assert.ok(r.skips.every(x => x.code === 'quota-unreadable'));
  }
  assert.equal(s.reservations.length, 0);
  assert.equal(s.admissions.length, 0);
});

test('L6-E: last unit cannot be allocated twice, settlement releases once, crash keeps holds, alias merge cannot refund', () => {
  const s = makeGenesisState();
  enrollAccount(s, { account: 'A1', cli: 'CODEX', slot: 'CODEX_00', quotaFamilyRef: 'qf-a' });
  enrollAccount(s, { account: 'A2', cli: 'CODEX', slot: 'CODEX_01', quotaFamilyRef: 'qf-b' });
  for (let i = 0; i < 4; i++) {
    const r = selectRoute(s, task({ reviewInputKey: `rk-${i}` }), allOk);
    assert.equal(r.kind, 'selected');
  }
  const snapshot = () => JSON.stringify({ cursors: s.cursors, reservations: s.reservations,
    admissions: s.admissions, counters: s.counters, accounting: s.accounting, allocationSeq: s.allocationSeq });
  const before5 = snapshot();
  const r5 = selectRoute(s, task({ reviewInputKey: 'rk-4' }), allOk);
  assert.equal(r5.kind, 'waiting-seat');
  if (r5.kind === 'waiting-seat') {
    assert.ok(r5.skips.some(x => x.code === 'fleet-cap'));
    // A refused traversal commits only its typed skips; every allocator field is unchanged.
    assert.equal(snapshot(), before5);
    assert.equal(s.skips.length, r5.skips.length);
  }
  const ref = s.reservations[0].ref;
  const settled = settleReservation(s, ref, 0);
  assert.equal(settled.released, 1);
  assert.throws(() => settleReservation(s, ref, 0), /already-settled-or-unknown/);
  validateState(s);
  assert.equal(s.accounting.authorized, s.accounting.held + s.accounting.spent + s.accounting.released);
  const heldBefore = s.reservations.reduce((n, r) => n + r.held, 0);
  mergeAliasFamilies(s, 'qf-b', 'qf-a');
  assert.equal(s.reservations.filter(r => r.family === 'qf-b').length, 0);
  assert.equal(s.reservations.reduce((n, r) => n + r.held, 0), heldBefore);
  assert.equal(s.accounting.released, 1);
  validateState(s);
});

test('L6-F: cross-account isolation, refresh drain and later-run successor gate', () => {
  const s = twoProviderState();
  const r = selectRoute(s, task(), allOk);
  assert.equal(r.kind, 'selected');
  if (r.kind !== 'selected') return;
  const proj = projectForAccount(s, 'A1');
  assert.deepEqual(Object.keys(proj).sort(), ['accountRef', 'projectionName', 'quotaFamilyRef', 'slot']);
  assert.equal(proj.slot, 'CODEX_00');
  assert.equal(proj.projectionName, 'SEAT_USE_CODEX_00');
  assert.throws(() => assertTicketAccount('B1', r.entry), /ticket-account-mismatch/);
  beginRefresh(s, r.reservation.family);
  assert.ok(s.refreshIntents.includes('A1'));
  assert.equal(s.reservations.find(x => x.ref === r.reservation.ref)?.status, 'fenced');
  // While the refresh is pending the fenced family is skipped with refresh-pending and
  // the traversal continues over the remaining accounts of the ring.
  const during = selectRoute(s, task({ reviewInputKey: 'rk-2', day: '2026-11-03' }),
    (e, t) => checkEligibility(t, { quota: okQuota,
      refreshPending: s.refreshIntents.includes(e.quotaFamilyRef ?? e.account), busy: e.account !== 'A1' }));
  assert.equal(during.kind, 'waiting-seat');
  if (during.kind === 'waiting-seat') {
    assert.deepEqual(during.skips.map(x => [x.accountRef, x.code]),
      [['B1', 'busy'], ['A2', 'busy'], ['A1', 'refresh-pending']]);
  }
  assert.throws(() => admitSuccessor(s, 'A1', { laterRunVerified: false, generation: s.generation + 1 }), /generation-mismatch/);
  assert.throws(() => admitSuccessor(s, 'A1', { laterRunVerified: true, generation: s.generation }), /generation-mismatch/);
  admitSuccessor(s, 'A1', { laterRunVerified: true, generation: s.generation + 1 });
  assert.equal(s.refreshIntents.includes('A1'), false);
  assert.equal(s.reservations.find(x => x.ref === r.reservation.ref)?.status, 'active');
});

test('L6-G/T5-N2: exhausting every account yields one bounded traversal, typed skips, waiting-seat, zero paid calls, released runner', () => {
  const s = twoProviderState();
  const r = selectRoute(s, task(), () => ({ ok: false, code: 'quota-exhausted' }));
  assert.equal(r.kind, 'waiting-seat');
  if (r.kind === 'waiting-seat') {
    assert.equal(r.paidAttempts, 0);
    assert.equal(r.runnerReleased, true);
    assert.equal(r.nextEligible, 'unknown');
    assert.equal(r.skips.length, 3);
    assert.equal(new Set(r.skips.map(x => x.accountRef)).size, 3);
    assert.ok(new Set(r.skips.map(x => x.provider)).size <= PROVIDER_RING.length);
  }
  assert.equal(s.reservations.length, 0);
  assert.equal(s.admissions.length, 0);
  assert.equal(s.counters.day['2026-11-02'] ?? 0, 0);
  assert.deepEqual(s.cursors, {});
  assert.equal(s.skips.length, 3);
});

test('T5-N2: unchanged reviewInputKey performs zero inference even after a prior result', () => {
  const s = twoProviderState();
  const first = selectRoute(s, task(), allOk);
  assert.equal(first.kind, 'selected');
  const skipsBefore = s.skips.length;
  const again = selectRoute(s, task(), allOk);
  assert.equal(again.kind, 'dedup');
  if (again.kind === 'dedup') {
    assert.equal(again.inferenceCalls, 0);
    assert.equal(again.prior.reviewInputKey, 'rk-1');
  }
  assert.equal(s.reservations.length, 1);
  assert.equal(s.admissions.length, 1);
  assert.equal(s.skips.length, skipsBefore);
});

const disposition = (over: Record<string, unknown> = {}) => ({
  schemaVersion: 1, kind: 'c1-d0-3-public-extension', provider: 'openai',
  route: 'chat:gpt-6-astra', client: 'CODEX', model: 'gpt-6-astra',
  publicRepository: 'rhanka/sentropic',
  privateToPublicChange: 'execution moves from private custody to the public rhanka/sentropic repository with public logs/artifacts',
  evidenceDate: '2026-11-01T00:00:00Z', evidenceDigest: 'a'.repeat(64),
  validUntil: '2026-12-01T00:00:00Z', reviewTrigger: 'any workflow/log/artifact exposure change',
  dispositionSource: 'C1 D0.3 owner disposition', actor: 'owner', a9Record: 'A9',
  affectedQualificationIds: ['Q-CODEX-1'], isolationControls: ['FD-only loading', 'no candidate egress'],
  providerFacts: ['provider terms permit public-repository CI usage'],
  ...over,
});

const qualification = (accountRef: string, over: Record<string, unknown> = {}) => ({
  schemaVersion: 1, accountRef, provider: 'openai', cli: 'CODEX',
  route: { operation: 'chat', model: 'gpt-6-astra', endpoint: 'https://api.openai.example/v1', capabilities: ['chat'], purpose: 'report-review' },
  billingFirst: { verifiedAt: '2026-11-01T00:00:00Z', noOverageEvidenceDigest: 'b'.repeat(64), noPayment: true },
  quotaReader: { kind: 'non-inference', observedAt: '2026-11-02T06:44:40Z', remaining: [80], freshnessSec: 20 },
  lifecycle: { mode: 'standard', lifetimeMs: 3_600_000, validUntil: '2026-11-03T00:00:00Z' },
  isolation: { termsDigest: 'c'.repeat(64), entitlementDigest: 'd'.repeat(64) },
  publicExecutionDigest: 'a'.repeat(64), checkedAt: '2026-11-02T06:45:00Z',
  validUntil: '2026-11-09T00:00:00Z', status: 'qualified', ...over,
});

test('L6-H: billing-first, non-inference quota, lifecycle, exact model and T6-P1 disposition gate one qualified route; review-partial-roster published', () => {
  const s = twoProviderState();
  const ctx = { now: NOW, operationModels: { chat: 'gpt-6-astra' }, operation: 'chat', dispositions: [disposition()] };
  const q = qualifyAccountRoute(s, qualification('A1'), ctx);
  assert.equal(q.status, 'qualified');
  assert.equal(s.routeQualifications.length, 1);
  const coverage = reviewCoverage(s, ['ROSTER-COMPLETENESS']);
  assert.equal(coverage.status, 'review-partial-roster');
  assert.equal(coverage.qualifiedCount, 1);
  assert.deepEqual(coverage.unresolved, ['ROSTER-COMPLETENESS']);
  const review = canEnablePurpose(s, 'report-review', ['ROSTER-COMPLETENESS']);
  assert.equal(review.enabled, true);
  assert.equal(review.coverage.status, 'review-partial-roster');
  const repair = canEnablePurpose(s, 'assisted-repair', ['ROSTER-COMPLETENESS']);
  assert.equal(repair.enabled, false);
  assert.equal(repair.reason, 'distinct-author-reviewer-models-required');
});

test('L6-H: assisted repair needs the qualified distinct author/reviewer model set', () => {
  const s = twoProviderState();
  const ctx = { now: NOW, operationModels: { chat: 'gpt-6-astra', build: 'gpt-6.1-sol' }, operation: 'chat', dispositions: [disposition()] };
  qualifyAccountRoute(s, qualification('A1'), ctx);
  const second = qualifyAccountRoute(s, qualification('A2', {
    route: { operation: 'build', model: 'gpt-6.1-sol', endpoint: 'https://api.openai.example/v1', capabilities: ['build'], purpose: 'assisted-repair' },
  }), { ...ctx, operation: 'build', dispositions: [disposition({ route: 'build:gpt-6.1-sol', model: 'gpt-6.1-sol', affectedQualificationIds: ['Q-CODEX-2'] })] });
  assert.equal(second.status, 'qualified');
  const repair = canEnablePurpose(s, 'assisted-repair', ['ROSTER-COMPLETENESS']);
  assert.equal(repair.enabled, true);
  const sameModel = canEnablePurpose(s, 'assisted-repair', []);
  assert.equal(sameModel.coverage.status, 'complete-for-declared-input');
});

test('L6-H: incomplete per-account proof leaves the route off and visible; no all-account claim', () => {
  const s = twoProviderState();
  const ctx = { now: NOW, operationModels: { chat: 'gpt-6-astra' }, operation: 'chat', dispositions: [disposition()] };
  assert.throws(() => qualifyAccountRoute(s, qualification('A1', { billingFirst: { verifiedAt: '2026-11-01T00:00:00Z', noOverageEvidenceDigest: 'b'.repeat(64), noPayment: false } }), ctx), /billing-unverified/);
  assert.throws(() => qualifyAccountRoute(s, qualification('A1', { quotaReader: { kind: 'inference', observedAt: '2026-11-02T06:44:40Z', remaining: [80], freshnessSec: 20 } }), ctx), /quota-reader-invalid/);
  assert.throws(() => qualifyAccountRoute(s, qualification('A1', { quotaReader: { kind: 'non-inference', observedAt: '2026-11-02T06:44:40Z', remaining: [80], freshnessSec: 31 } }), ctx), /quota-reader-invalid/);
  assert.throws(() => qualifyAccountRoute(s, qualification('A1', { quotaReader: { kind: 'non-inference', observedAt: '2026-11-02T06:44:40Z', remaining: [20], freshnessSec: 20 } }), ctx), /quota-reader-invalid/);
  assert.throws(() => qualifyAccountRoute(s, qualification('A1', { route: { operation: 'chat', model: 'gpt-4.1-nano', endpoint: 'x', capabilities: ['chat'], purpose: 'report-review' } }), ctx), /model-retired/);
  assert.throws(() => qualifyAccountRoute(s, qualification('A1', { route: { operation: 'chat', model: 'gpt-9-other', endpoint: 'x', capabilities: ['chat'], purpose: 'report-review' } }), ctx), /model-not-qualified-route/);
  assert.throws(() => qualifyAccountRoute(s, qualification('A1', { publicExecutionDigest: 'f'.repeat(64) }), ctx), /public-execution-disposition-missing/);
  assert.throws(() => qualifyAccountRoute(s, qualification('A1'), { ...ctx, dispositions: [disposition({ validUntil: '2026-11-01T00:00:00Z' })] }), /public-execution-evidence-expired/);
  assert.equal(s.routeQualifications.length, 0);
  disableAccount(s, 'A1', 'live-evidence-pending');
  disableAccount(s, 'A2', 'live-evidence-pending');
  disableAccount(s, 'B1', 'live-evidence-pending');
  const r = selectRoute(s, task(), (e, t) => checkEligibility(t, { quota: okQuota, routeQualified: false }));
  assert.equal(r.kind, 'waiting-seat');
  if (r.kind === 'waiting-seat') assert.ok(r.skips.every(x => x.code === 'route-unqualified'));
  const coverage = reviewCoverage(s, ['ROSTER-COMPLETENESS', 'ROSTER-CODEX-PRIMARY']);
  assert.equal(coverage.status, 'review-partial-roster');
  assert.equal(coverage.qualifiedCount, 0);
  assert.equal(canEnablePurpose(s, 'report-review', ['ROSTER-COMPLETENESS']).enabled, false);
});

test('T6-P1 via roster: public-execution disposition must match provider/route/client/model and be current', () => {
  const d = validateDisposition(disposition());
  assert.equal(d.a9Record, 'A9');
  const ok = admitPublicExecution(disposition(), { provider: 'openai', route: 'chat:gpt-6-astra', client: 'CODEX', model: 'gpt-6-astra', now: NOW });
  assert.equal(ok.ok, true);
  const other = admitPublicExecution(disposition(), { provider: 'meta', route: 'chat:gpt-6-astra', client: 'CODEX', model: 'gpt-6-astra', now: NOW });
  assert.deepEqual(other, { ok: false, code: 'provider-mismatch' });
  const expired = admitPublicExecution(disposition({ validUntil: '2026-11-02T00:00:00Z' }), { provider: 'openai', route: 'chat:gpt-6-astra', client: 'CODEX', model: 'gpt-6-astra', now: NOW });
  assert.deepEqual(expired, { ok: false, code: 'evidence-expired' });
});
