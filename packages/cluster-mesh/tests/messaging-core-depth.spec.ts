import { describe, expect, it } from 'vitest';
import type { MessageDelivery } from '../src/index.js';
import { messagingFixture, productContext, putRequest } from './messaging-fixture.js';

const pop = async (
  fixture: ReturnType<typeof messagingFixture>, mailboxId: string,
): Promise<MessageDelivery> => {
  const result = await fixture.store.pop({ context: productContext, mailboxId });
  if (!result.ok || result.outcome !== 'delivery') throw new Error('Expected delivery');
  return result.delivery;
};

describe('bounded-local messaging core depth', () => {
  it('backpressures subscriptions at maxInFlight and close does not acknowledge leases', async () => {
    const fixture = messagingFixture();
    for (const key of ['one', 'two', 'three']) await fixture.store.put(putRequest(key));
    const subscribed = await fixture.store.subscribe({
      context: productContext, mailboxId: 'mailbox-1', maxInFlight: 2,
    });
    if (!subscribed.ok) throw new Error('Expected subscription');
    const iterator = subscribed.subscription[Symbol.asyncIterator]();
    const first = await iterator.next();
    const second = await iterator.next();
    if (first.done || second.done) throw new Error('Expected subscription deliveries');
    expect([first.value.mailboxSequence, second.value.mailboxSequence]).toEqual([1, 2]);

    let thirdResolved = false;
    const thirdPromise = iterator.next().then((value) => { thirdResolved = true; return value; });
    await new Promise<void>((resolve) => { setImmediate(resolve); });
    expect(thirdResolved).toBe(false);
    await fixture.store.ack({
      context: productContext, deliveryId: first.value.deliveryId,
      leaseId: first.value.lease.leaseId, ackIdempotencyKey: 'ack-one',
      disposition: { kind: 'processed' },
    });
    const third = await thirdPromise;
    if (third.done) throw new Error('Expected third delivery after acknowledgement');
    expect(third.value.mailboxSequence).toBe(3);

    await subscribed.subscription.close();
    await expect(subscribed.subscription.terminal).resolves.toEqual({ reason: 'closed' });
    fixture.advance(101);
    const redelivered = await pop(fixture, 'mailbox-1');
    expect(redelivered).toMatchObject({ mailboxSequence: 2, deliveryAttempt: 2 });
  });

  it('commits topic fan-out atomically in per-mailbox acceptance order', async () => {
    const fixture = messagingFixture();
    for (const key of ['topic-one', 'topic-two']) {
      await expect(fixture.store.put(putRequest(key, {
        destination: { kind: 'topic', topicId: 'topic-1' },
      }))).resolves.toMatchObject({
        ok: true, outcome: 'accepted', mailboxIds: ['mailbox-a', 'mailbox-b'],
      });
    }
    const mailboxA = [await pop(fixture, 'mailbox-a'), await pop(fixture, 'mailbox-a')];
    const mailboxB = [await pop(fixture, 'mailbox-b'), await pop(fixture, 'mailbox-b')];
    expect(mailboxA.map(({ mailboxSequence }) => mailboxSequence)).toEqual([1, 2]);
    expect(mailboxB.map(({ mailboxSequence }) => mailboxSequence)).toEqual([1, 2]);
    expect(mailboxA.map(({ message }) => message.messageId))
      .toEqual(mailboxB.map(({ message }) => message.messageId));
    expect(mailboxA.map(({ message }) => message.idempotencyKey))
      .toEqual(['topic-one', 'topic-two']);
  });
});
