import { test } from 'node:test';
import assert from 'node:assert/strict';
import { quoteCredit, imageTokens, initialCreditState, allocateSegment } from '../src/ci-credit-budget.ts';
const envelope = { input: 200_000, output: 16_384, framingQualified: true };
const price = { model: 'gpt-5.6-luna', input: 0.25, output: 1.2, maxInput: 272_000,
  maxOutput: 128_000, context: 1_050_000, validUntil: 2000, qualified: true };
test('uses exact model-specific cache-write-safe reservations, rounded up', () => {
  assert.equal(quoteCredit(envelope, price, 1000), 69661);
  assert.equal(quoteCredit(envelope, { ...price, model: 'gpt-6-luna', input: 0.125, output: 0.5 }, 1000), 33192);
  assert.equal(Math.floor(2_000_000 / 69661), 28);
  assert.equal(Math.floor(2_000_000 / 33192), 60);
  for (const delta of [{ input: 922_000, output: 128_000 }, { framingQualified: false }, { output: Infinity }])
    assert.throws(() => quoteCredit({ ...envelope, ...delta }, price, 1000), /credit-/);
  assert.throws(() => quoteCredit(envelope, price, 2000), /credit-price/);
});
test('high and auto/original/omitted image detail have different conservative ceilings', () => {
  assert.equal(imageTokens(32_000, 32_000, 'high'), 3001);
  for (const detail of ['auto', 'original', undefined]) assert.equal(imageTokens(32_000, 32_000, detail), 36001);
  assert.throws(() => imageTokens(100, 100, 'unknown'), /image-detail/);
});
const segment = { campaign: 'campaign', binding: 'a'.repeat(64), runId: '100', runAttempt: 1,
  day: '2026-10-17', index: 1, maxMicro: 2_000_000, maxAttempts: 250 };
test('segments retain shared day/month caps and cannot reset by dispatch or gate rerun', () => {
  const state = initialCreditState(); allocateSegment(state, segment);
  assert.throws(() => allocateSegment(state, segment), /segment/);
  allocateSegment(state, { ...segment, runId: '101', index: 2 });
  assert.throws(() => allocateSegment(state, { ...segment, runId: '102', index: 3 }), /credit-day/);
  assert.throws(() => allocateSegment(initialCreditState(), { ...segment, maxAttempts: 251 }), /credit-segment/);
});
test('300-attempt campaigns require separately allocated bounded segments', () => {
  const state = initialCreditState();
  allocateSegment(state, { ...segment, maxAttempts: 150, maxMicro: 100_000 });
  allocateSegment(state, { ...segment, index: 2, runId: '101', maxAttempts: 150, maxMicro: 100_000 });
  assert.equal(Object.values(state.segments).reduce((n, s) => n + s.maxAttempts, 0), 300);
});
