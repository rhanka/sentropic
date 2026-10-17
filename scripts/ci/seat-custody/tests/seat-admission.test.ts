import { test } from 'node:test';
import assert from 'node:assert/strict';
import { admitSeatCases, initialSeatState, reserveSeatClass } from '../src/seat-admission.ts';

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
