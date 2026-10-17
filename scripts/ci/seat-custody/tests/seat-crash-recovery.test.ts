import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DurableStore } from '../src/github-seat-store.ts';
import { initialSeatState, reserveSeatClass } from '../src/seat-admission.ts';
import { settleSeatReservation, createHandoff } from '../src/seat-writer.ts';
const context = { day: '2026-10-17', campaign: 'segment-1', generation: 1,
  seatQualified: true, quotaReadable: true, remaining: [80], lifetimeMs: 1000 };
test('missing/corrupt durable state never reconstructs a zero ledger', async () => {
  const path = join(await mkdtemp(join(tmpdir(), 'seat-')), 'ledger.json');
  const store = new DurableStore(path);
  await assert.rejects(store.read(), /state-unavailable/);
  await store.bootstrap(initialSeatState());
  await store.transact(s => reserveSeatClass(s, 'ci', 6, context));
  const restarted = new DurableStore(path);
  assert.equal((await restarted.read()).reservations[0].units, 6);
  await writeFile(path, '{}');
  await assert.rejects(restarted.read(), /state-corrupt/);
});
test('parallel allocations cannot spend the same last seat allowance', async () => {
  const path = join(await mkdtemp(join(tmpdir(), 'seat-')), 'ledger.json');
  const store = new DurableStore(path); await store.bootstrap(initialSeatState());
  const results = await Promise.allSettled([1, 2].map(n => store.transact(s =>
    reserveSeatClass(s, 'ci', 6, { ...context, campaign: `segment-${n}` }))));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal((await store.read()).reservations.length, 1);
});
test('only a later terminated producer with a bound private handoff releases unused units once', () => {
  const state = initialSeatState(); const r = reserveSeatClass(state, 'ci', 6, context);
  const provenance = { campaign: context.campaign, segment: 1, runId: '100', runAttempt: 1,
    control: 'a'.repeat(64), workflow: 'seats-consumer.yml', createdAt: 1000 };
  const handoff = createHandoff([{ reservation: r.id, request: 'one', debit: 1 }], provenance);
  const evidence = { ...provenance, now: 2000, trustedWorkflow: true, producerTerminated: true,
    consumerExited: true, settlementRunId: '101', expectedDigest: handoff.digest };
  assert.throws(() => settleSeatReservation(state, r.id, undefined, evidence), /handoff/);
  assert.equal(r.units, 6); assert.equal(r.settled, undefined);
  assert.throws(() => settleSeatReservation(state, r.id, handoff, { ...evidence, runId: 'wrong' }), /handoff/);
  settleSeatReservation(state, r.id, handoff, evidence);
  assert.equal(r.spent, 1);
  assert.throws(() => settleSeatReservation(state, r.id, handoff, evidence), /already-settled/);
});
