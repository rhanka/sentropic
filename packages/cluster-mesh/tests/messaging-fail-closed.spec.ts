import { describe, expect, it } from 'vitest';
import {
  allow, denyAction, messagingFixture, productContext, putRequest,
} from './messaging-fixture.js';

describe('messaging fail-closed boundaries', () => {
  it('rejects unavailable and empty topic routes before allocating store identity', async () => {
    const fixture = messagingFixture({ routes: async () => { throw new Error('routing down'); } });
    const request = putRequest('routed', {
      destination: { kind: 'topic', topicId: 'topic-1' },
    });
    await expect(fixture.store.put(request))
      .resolves.toEqual({ ok: false, reason: 'route_unresolved' });
    fixture.setRoutes(async () => []);
    await expect(fixture.store.put(request))
      .resolves.toEqual({ ok: false, reason: 'route_unresolved' });
    fixture.setRoutes(async () => ['mailbox-1']);
    await expect(fixture.store.put(request)).resolves.toEqual({
      ok: true, outcome: 'accepted', messageId: 'message-1', mailboxIds: ['mailbox-1'],
    });
    await expect(fixture.store.pop({ context: productContext, mailboxId: 'mailbox-1' }))
      .resolves.toMatchObject({ ok: true, delivery: { mailboxSequence: 1, deliveryAttempt: 1 } });
  });

  it('creates no lease when pop, subscribe, or per-push authorization is unavailable', async () => {
    const fixture = messagingFixture();
    await fixture.store.put(putRequest('protected'));
    fixture.setAuthorization(async () => { throw new Error('authorization down'); });
    await expect(fixture.store.pop({ context: productContext, mailboxId: 'mailbox-1' }))
      .resolves.toEqual({ ok: false, reason: 'unavailable' });
    await expect(fixture.store.subscribe({ context: productContext, mailboxId: 'mailbox-1' }))
      .resolves.toEqual({ ok: false, reason: 'unavailable' });

    fixture.setAuthorization(async ({ context }) => allow(context.policyRevision));
    const subscribed = await fixture.store.subscribe({
      context: productContext, mailboxId: 'mailbox-1',
    });
    if (!subscribed.ok) throw new Error('Expected subscription');
    expect(subscribed.subscription.subscriptionId).toBe('subscription-1');
    fixture.setAuthorization(async (call) => {
      if (call.action === 'message:push') throw new Error('authorization down');
      return allow(call.context.policyRevision);
    });
    await expect(subscribed.subscription[Symbol.asyncIterator]().next())
      .resolves.toEqual({ done: true, value: undefined });
    await expect(subscribed.subscription.terminal).resolves.toEqual({ reason: 'unavailable' });

    fixture.setAuthorization(async ({ context }) => allow(context.policyRevision));
    await expect(fixture.store.pop({ context: productContext, mailboxId: 'mailbox-1' }))
      .resolves.toMatchObject({ ok: true, delivery: { deliveryAttempt: 1 } });
  });

  it('leaves the current lease untouched when acknowledgement is denied or unavailable', async () => {
    const fixture = messagingFixture();
    await fixture.store.put(putRequest('ack-protected'));
    const popped = await fixture.store.pop({ context: productContext, mailboxId: 'mailbox-1' });
    if (!popped.ok || popped.outcome !== 'delivery') throw new Error('Expected delivery');
    const ack = {
      context: productContext, deliveryId: popped.delivery.deliveryId,
      leaseId: popped.delivery.lease.leaseId, ackIdempotencyKey: 'ack-protected',
      disposition: { kind: 'processed' as const },
    };
    fixture.setAuthorization(denyAction('message:ack'));
    await expect(fixture.store.ack(ack)).resolves.toEqual({ ok: false, reason: 'forbidden' });
    fixture.setAuthorization(async (call) => {
      if (call.action === 'message:ack') throw new Error('authorization down');
      return allow(call.context.policyRevision);
    });
    await expect(fixture.store.ack(ack)).resolves.toEqual({ ok: false, reason: 'unavailable' });
    fixture.setAuthorization(async ({ context }) => allow(context.policyRevision));
    await expect(fixture.store.ack(ack)).resolves.toEqual({ ok: true, outcome: 'acked' });
  });

  it('starts empty after a store restart and makes no cursor durability claim', async () => {
    const beforeRestart = messagingFixture();
    await beforeRestart.store.put(putRequest('volatile'));
    const afterRestart = messagingFixture();
    await expect(afterRestart.store.pop({ context: productContext, mailboxId: 'mailbox-1' }))
      .resolves.toEqual({ ok: true, outcome: 'empty' });
    await expect(afterRestart.store.acquire({
      sourceId: 'source-1', workerId: 'worker-1', leaseMs: 100,
    })).resolves.toMatchObject({ ok: true, cursor: null, fence: { generation: 1 } });
    await expect(afterRestart.store.put(putRequest('after-restart')))
      .resolves.toMatchObject({ ok: true, messageId: 'message-1' });
  });
});
