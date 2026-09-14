import { describe, expect, it } from 'vitest';
import type { MessageDelivery } from '../src/index.js';
import { messagingFixture, productContext, putRequest } from './messaging-fixture.js';

const delivery = async (
  store: ReturnType<typeof messagingFixture>['store'],
): Promise<MessageDelivery> => {
  const result = await store.pop({ context: productContext, mailboxId: 'mailbox-1' });
  if (!result.ok || result.outcome !== 'delivery') throw new Error('Expected a delivery');
  return result.delivery;
};

describe('bounded-local messaging core', () => {
  it('puts, pops, and idempotently acknowledges a store-authored delivery', async () => {
    const { store, routeCalls } = messagingFixture();
    const accepted = await store.put(putRequest('put-1'));
    expect(accepted).toEqual({
      ok: true, outcome: 'accepted', messageId: 'message-1', mailboxIds: ['mailbox-1'],
    });
    expect(routeCalls).toHaveLength(0);

    await expect(store.put(putRequest('put-1'))).resolves.toEqual({
      ok: true, outcome: 'idempotent_replay', messageId: 'message-1', mailboxIds: ['mailbox-1'],
    });
    await expect(store.put(putRequest('put-1', {
      payload: { contentType: 'application/json', value: { text: 'changed' } },
    }))).resolves.toEqual({ ok: false, reason: 'idempotency_conflict' });

    const first = await delivery(store);
    expect(first).toMatchObject({
      deliveryId: 'delivery-1', mailboxSequence: 1, deliveryAttempt: 1,
      message: { messageId: 'message-1', producerPrincipalId: 'product-1' },
      lease: { leaseId: 'lease-1', ownerPrincipalId: 'product-1' },
    });
    const ack = {
      context: productContext, deliveryId: first.deliveryId, leaseId: first.lease.leaseId,
      ackIdempotencyKey: 'ack-1', disposition: { kind: 'processed' as const },
    };
    await expect(store.ack(ack)).resolves.toEqual({ ok: true, outcome: 'acked' });
    await expect(store.ack(ack)).resolves.toEqual({ ok: true, outcome: 'idempotent_replay' });
    await expect(store.ack({ ...ack, ackIdempotencyKey: 'changed' })).resolves.toEqual({
      ok: false, reason: 'ack_conflict',
    });
    await expect(store.pop({ context: productContext, mailboxId: 'mailbox-1' }))
      .resolves.toEqual({ ok: true, outcome: 'empty' });
  });

  it('redelivers after visibility expiry and rejects the stale lease', async () => {
    const fixture = messagingFixture();
    await fixture.store.put(putRequest('put-redelivery'));
    const first = await delivery(fixture.store);
    await expect(fixture.store.pop({ context: productContext, mailboxId: 'mailbox-1' }))
      .resolves.toEqual({ ok: true, outcome: 'empty' });

    fixture.advance(101);
    const second = await delivery(fixture.store);
    expect(second).toMatchObject({
      deliveryId: first.deliveryId, mailboxSequence: first.mailboxSequence, deliveryAttempt: 2,
    });
    expect(second.lease.leaseId).not.toBe(first.lease.leaseId);
    await expect(fixture.store.ack({
      context: productContext, deliveryId: first.deliveryId, leaseId: first.lease.leaseId,
      ackIdempotencyKey: 'stale', disposition: { kind: 'processed' },
    })).resolves.toEqual({ ok: false, reason: 'lease_mismatch' });
    await expect(fixture.store.ack({
      context: productContext, deliveryId: second.deliveryId, leaseId: second.lease.leaseId,
      ackIdempotencyKey: 'current', disposition: { kind: 'processed' },
    })).resolves.toEqual({ ok: true, outcome: 'acked' });
  });
});
