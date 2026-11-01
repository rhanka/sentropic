import { test } from 'node:test';
import assert from 'node:assert/strict';
import { admitSeatCases, initialSeatState, reserveSeatClass, seatCaps } from '../src/seat-admission.ts';
import { makeGenesisState } from '../src/custody-state-store.ts';
import { checkEligibility, enrollAccount, projectForAccount, selectRoute } from '../src/security-roster.ts';

const cases = [
  { id: 'conversation-a', attempts: 4, durationMs: 1000 },
  { id: 'conversation-b', attempts: 3, durationMs: 1000 },
  { id: 'conversation-c', attempts: 2, durationMs: 1000 },
];
const admission = { day: '2026-10-17', campaign: 'campaign-a', generation: 1,
  seatQualified: true, quotaReadable: true, remaining: [20.01, 50], lifetimeMs: 10_000 };

test('reserves whole cases in stable order and protects enrollment and native shares', () => {
  const state = initialSeatState();
  const result = admitSeatCases(state, cases, admission);
  assert.deepEqual(result.seat.map(c => c.id), ['conversation-a', 'conversation-c']);
  assert.deepEqual(result.credit.map(c => c.id), ['conversation-b']);
  assert.equal(result.reservations.reduce((n, r) => n + r.units, 0), 6);
  reserveSeatClass(state, 'enrollment', 2, { ...admission, campaign: 'enrollment' });
  reserveSeatClass(state, 'native', 2, { ...admission, campaign: 'native' });
  assert.throws(() => reserveSeatClass(state, 'ci', 1, admission), /seat-budget/);
});

test('unreadable quota and exactly twenty percent never dispatch a seat', () => {
  for (const overrides of [{ quotaReadable: false }, { remaining: [20] }, { remaining: [] }]) {
    const result = admitSeatCases(initialSeatState(), cases, { ...admission, ...overrides });
    assert.equal(result.seat.length, 0);
    assert.equal(result.noSeat?.units, 0);
    assert.equal(result.noSeat?.consumerMinutes, 0);
  }
});

test('duplicate campaign admission cannot reserve another allowance', () => {
  const state = initialSeatState();
  admitSeatCases(state, cases, admission);
  assert.throws(() => admitSeatCases(state, cases, admission), /duplicate-campaign/);
});

test('missing complete-case bounds refuse admission', () => {
  assert.throws(() => admitSeatCases(initialSeatState(), [{ id: 'bad', attempts: 0, durationMs: 1 }], admission), /case-bound/);
});

// L9-C (r6 §6.4): the one writer allocator commits provider/account turns in the shared
// custody state; the broker consumes the committed reservation without any local cursor
// reset; all-exhausted yields waiting-seat with zero payment and unchanged caps.
test('L9-C: allocator-committed turns, broker consumption without cursor reset, waiting-seat with zero payment', () => {
  const state = makeGenesisState();
  enrollAccount(state, { account: 'A1', cli: 'CODEX', slot: 'CODEX_00' });
  enrollAccount(state, { account: 'B1', cli: 'MUSE', slot: 'MUSE_00' });
  const ok = (t: never) => checkEligibility(t, { quota: { readable: true, observedAt: 0, now: 1, remaining: [80] } });
  const first = selectRoute(state, { reviewInputKey: 'rk-1', units: 1, day: '2026-11-02', campaign: 'c', generation: 1, purpose: 'report-review' }, ok);
  assert.equal(first.kind, 'selected');
  const cursorsAfterFirst = JSON.stringify(state.cursors);
  // Broker side: consume the reservation and the account projection; no cursor reset.
  const proj = projectForAccount(state, 'A1');
  assert.equal(proj.projectionName, 'SEAT_USE_CODEX_00');
  assert.equal(JSON.stringify(state.cursors), cursorsAfterFirst);
  const second = selectRoute(state, { reviewInputKey: 'rk-2', units: 1, day: '2026-11-02', campaign: 'c', generation: 1, purpose: 'report-review' }, ok);
  assert.equal(second.kind, 'selected');
  if (second.kind === 'selected') assert.equal(second.entry.account, 'B1');
  const cursorsAfterSecond = JSON.stringify(state.cursors);
  const exhausted = selectRoute(state, { reviewInputKey: 'rk-3', units: 1, day: '2026-11-02', campaign: 'c', generation: 1, purpose: 'report-review' }, () => ({ ok: false, code: 'quota-exhausted' }));
  assert.equal(exhausted.kind, 'waiting-seat');
  if (exhausted.kind === 'waiting-seat') {
    assert.equal(exhausted.paidAttempts, 0);
    assert.equal(exhausted.runnerReleased, true);
  }
  // Exhaustion is a waiting-seat: the committed cursors are left untouched.
  assert.equal(JSON.stringify(state.cursors), cursorsAfterSecond);
  assert.notEqual(cursorsAfterSecond, cursorsAfterFirst);
  // Adding a third account never enlarges the CLI/fleet caps.
  enrollAccount(state, { account: 'A2', cli: 'CODEX', slot: 'CODEX_01' });
  assert.equal(seatCaps(initialSeatState(), '2026-11-02').ci, 6);
  const campaign = initialSeatState();
  campaign.modes['2026-11-02'] = { mode: 'native-campaign', campaign: 'c', validUntil: '2026-11-03' };
  assert.deepEqual(seatCaps(campaign, '2026-11-02'), { ci: 0, enrollment: 2, native: 8 });
});
