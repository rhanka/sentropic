import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PaidQueue, settleUsage } from '../src/ci-credit-broker.ts';

test('paid requests are FIFO and cancelled queued work never dispatches', async () => {
  const queue = new PaidQueue(); const sends: number[] = []; let release!: () => void;
  const first = queue.run('first', 1000, undefined, async () => {
    sends.push(1); await new Promise<void>(r => { release = r; }); return 1;
  });
  await new Promise(r => setImmediate(r));
  const controller = new AbortController();
  const second = queue.run('second', 1000, controller.signal, async () => { sends.push(2); });
  controller.abort(); release();
  assert.equal(await first, 1); await assert.rejects(second, /broker-queue/);
  assert.deepEqual(sends, [1]);
  await assert.rejects(queue.run('first', 1000, undefined, async () => {}), /duplicate-request/);
});
test('terminal trusted usage refunds once; missing, truncated or forged usage retains reservation', () => {
  const debit = { id: 'request-1', reserved: 69661, inputBound: 200000, outputBound: 16384,
    settled: false, actual: undefined as number | undefined };
  const price = { input: 0.25, output: 1.2 };
  for (const terminal of [undefined, { trusted: false, complete: true, id: debit.id, input: 1, output: 1 }]) {
    assert.equal(settleUsage(debit, terminal, price).held, 69661);
    assert.equal(debit.settled, false);
  }
  const terminal = { trusted: true, complete: true, id: debit.id, input: 100, output: 10 };
  assert.deepEqual(settleUsage(debit, terminal, price), { actual: 37, held: 0, released: 69624 });
  assert.throws(() => settleUsage(debit, terminal, price), /already-settled/);
});
test('over-bound provider usage fences instead of refunding', () => {
  assert.throws(() => settleUsage({ id: 'one', reserved: 100, inputBound: 10, outputBound: 1,
    settled: false }, { trusted: true, complete: true, id: 'one', input: 11, output: 1 },
  { input: 1, output: 1 }), /usage-contract/);
});
