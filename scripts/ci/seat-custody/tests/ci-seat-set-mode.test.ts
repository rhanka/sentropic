import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialSeatState, reserveSeatClass, seatCaps } from '../src/seat-admission.ts';
import { setSeatMode } from '../src/ci-seat-set-mode.ts';
const context = { day: '2026-10-17', campaign: 'ci', generation: 1,
  seatQualified: true, quotaReadable: true, remaining: [80], lifetimeMs: 1000 };
const change = { day: context.day, mode: 'native-campaign' as const, campaign: 'native-a',
  validUntil: '2026-10-20', drained: true, sameDay: true };

test('native campaign allows eight native units and protects two enrollment units', () => {
  const state = initialSeatState(); setSeatMode(state, change);
  assert.equal(seatCaps(state, context.day).ci, 0);
  reserveSeatClass(state, 'native', 8, context);
  reserveSeatClass(state, 'enrollment', 2, { ...context, campaign: 'enrollment' });
  assert.throws(() => reserveSeatClass(state, 'ci', 1, context), /seat-budget/);
});
test('spent or held CI units postpone native entry, without resetting counters', () => {
  const state = initialSeatState(); reserveSeatClass(state, 'ci', 2, context);
  const before = JSON.stringify(state.reservations);
  assert.equal(setSeatMode(state, change).effectiveDay, '2026-10-18');
  assert.equal(JSON.stringify(state.reservations), before);
  assert.equal(seatCaps(state, context.day).ci, 6);
  assert.equal(seatCaps(state, '2026-10-18').ci, 0);
});
test('exit and repeated mode switches cannot replenish the same day CI share', () => {
  const state = initialSeatState(); setSeatMode(state, change);
  setSeatMode(state, { ...change, mode: 'normal' });
  assert.equal(seatCaps(state, context.day).ci, 0);
});
test('missing campaign, expiry and undrained processes refuse the switch', () => {
  for (const delta of [{ campaign: '' }, { validUntil: '2026-10-16' }, { drained: false }]) {
    assert.throws(() => setSeatMode(initialSeatState(), { ...change, ...delta }), /mode-/);
  }
});
test('native mode persists across days and expiry fences instead of silently restoring CI', () => {
  const state = initialSeatState(); setSeatMode(state, change);
  assert.equal(seatCaps(state, '2026-10-19').ci, 0);
  assert.throws(() => seatCaps(state, '2026-10-21'), /native-campaign-expired/);
});
