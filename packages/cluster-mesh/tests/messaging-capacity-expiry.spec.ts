import { describe, expect, it } from 'vitest';
import { messagingFixture, productContext, putRequest } from './messaging-fixture.js';

describe('bounded-local messaging capacity and freshness', () => {
  it('fails closed at capacity without evicting leased or visible unacked work', async () => {
    const fixture = messagingFixture({ options: { maxMessages: 1 } });
    await fixture.store.put(putRequest('retained'));
    const first = await fixture.store.pop({ context: productContext, mailboxId: 'mailbox-1' });
    if (!first.ok || first.outcome !== 'delivery') throw new Error('Expected retained delivery');

    await expect(fixture.store.put(putRequest('rejected'))).resolves.toEqual({
      ok: false, reason: 'capacity_exhausted',
    });
    fixture.advance(101);
    const redelivery = await fixture.store.pop({ context: productContext, mailboxId: 'mailbox-1' });
    expect(redelivery).toMatchObject({
      ok: true,
      outcome: 'delivery',
      delivery: { deliveryId: first.delivery.deliveryId, deliveryAttempt: 2 },
    });
  });

  it('lets a pre-expiry lease ack but never redelivers an expired message', async () => {
    const fixture = messagingFixture();
    await fixture.store.put(putRequest('leased-expiry', {
      expiresAt: '2030-01-01T00:00:00.050Z',
    }));
    const leased = await fixture.store.pop({ context: productContext, mailboxId: 'mailbox-1' });
    if (!leased.ok || leased.outcome !== 'delivery') throw new Error('Expected leased delivery');
    fixture.advance(60);
    await expect(fixture.store.ack({
      context: productContext,
      deliveryId: leased.delivery.deliveryId,
      leaseId: leased.delivery.lease.leaseId,
      ackIdempotencyKey: 'expiry-ack',
      disposition: { kind: 'processed' },
    })).resolves.toEqual({ ok: true, outcome: 'acked' });

    await fixture.store.put(putRequest('unleased-expiry', {
      expiresAt: '2030-01-01T00:00:00.070Z',
    }));
    fixture.advance(11);
    await expect(fixture.store.pop({ context: productContext, mailboxId: 'mailbox-1' }))
      .resolves.toEqual({ ok: true, outcome: 'empty' });
    await expect(fixture.store.put(putRequest('bad-date', { expiresAt: 'not-a-date' })))
      .resolves.toEqual({ ok: false, reason: 'invalid_message' });
  });

  it('caps acknowledgement tombstones oldest-first', async () => {
    const fixture = messagingFixture({ options: { maxAckTombstones: 1 } });
    const acknowledgements: Array<Parameters<typeof fixture.store.ack>[0]> = [];
    for (const key of ['one', 'two']) {
      await fixture.store.put(putRequest(key));
      const popped = await fixture.store.pop({ context: productContext, mailboxId: 'mailbox-1' });
      if (!popped.ok || popped.outcome !== 'delivery') throw new Error('Expected delivery');
      const ack = {
        context: productContext,
        deliveryId: popped.delivery.deliveryId,
        leaseId: popped.delivery.lease.leaseId,
        ackIdempotencyKey: `ack-${key}`,
        disposition: { kind: 'processed' as const },
      };
      acknowledgements.push(ack);
      await expect(fixture.store.ack(ack)).resolves.toEqual({ ok: true, outcome: 'acked' });
    }
    await expect(fixture.store.ack(acknowledgements[0])).resolves.toEqual({
      ok: false, reason: 'delivery_not_found',
    });
    await expect(fixture.store.ack(acknowledgements[1])).resolves.toEqual({
      ok: true, outcome: 'idempotent_replay',
    });
  });

  it('expires acknowledgement tombstones after their retention window', async () => {
    const fixture = messagingFixture({ options: { ackTombstoneTtlMs: 50 } });
    await fixture.store.put(putRequest('tombstone-ttl'));
    const popped = await fixture.store.pop({ context: productContext, mailboxId: 'mailbox-1' });
    if (!popped.ok || popped.outcome !== 'delivery') throw new Error('Expected delivery');
    const ack = {
      context: productContext,
      deliveryId: popped.delivery.deliveryId,
      leaseId: popped.delivery.lease.leaseId,
      ackIdempotencyKey: 'ack-ttl',
      disposition: { kind: 'processed' as const },
    };
    await expect(fixture.store.ack(ack)).resolves.toEqual({ ok: true, outcome: 'acked' });

    fixture.advance(50);
    await expect(fixture.store.ack(ack)).resolves.toEqual({
      ok: false, reason: 'delivery_not_found',
    });
  });

  it('leaves a delivery leased when acknowledgement storage cannot fit', async () => {
    const fixture = messagingFixture({ options: { maxBytes: 700, maxMessageBytes: 500 } });
    await fixture.store.put(putRequest('ack-storage'));
    const popped = await fixture.store.pop({ context: productContext, mailboxId: 'mailbox-1' });
    if (!popped.ok || popped.outcome !== 'delivery') throw new Error('Expected delivery');

    await expect(fixture.store.ack({
      context: productContext,
      deliveryId: popped.delivery.deliveryId,
      leaseId: popped.delivery.lease.leaseId,
      ackIdempotencyKey: 'ack-too-large',
      disposition: { kind: 'quarantined', reason: 'x'.repeat(800) },
    })).resolves.toEqual({ ok: false, reason: 'unavailable' });
    await expect(fixture.store.pop({ context: productContext, mailboxId: 'mailbox-1' }))
      .resolves.toEqual({ ok: true, outcome: 'empty' });

    fixture.advance(101);
    await expect(fixture.store.pop({ context: productContext, mailboxId: 'mailbox-1' }))
      .resolves.toMatchObject({
        ok: true, outcome: 'delivery', delivery: { deliveryAttempt: 2 },
      });
  });
});
