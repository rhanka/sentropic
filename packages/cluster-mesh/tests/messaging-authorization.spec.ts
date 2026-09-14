import { describe, expect, it } from 'vitest';
import { allow, denyAction, messagingFixture, productContext, putRequest } from './messaging-fixture.js';

describe('messaging product authorization and routing', () => {
  it('snapshots sorted topic fan-out and replays the original route set', async () => {
    const fixture = messagingFixture();
    const request = putRequest('topic-1', {
      destination: { kind: 'topic', topicId: 'topic-1' },
    });
    await expect(fixture.store.put(request)).resolves.toEqual({
      ok: true, outcome: 'accepted', messageId: 'message-1',
      mailboxIds: ['mailbox-a', 'mailbox-b'],
    });
    fixture.setRoutes(async () => ['mailbox-c']);
    await expect(fixture.store.put(request)).resolves.toEqual({
      ok: true, outcome: 'idempotent_replay', messageId: 'message-1',
      mailboxIds: ['mailbox-a', 'mailbox-b'],
    });
    expect(fixture.routeCalls).toHaveLength(1);
    expect(fixture.authorizationCalls.map(({ action, resource }) => [action, resource.kind]))
      .toEqual([
        ['message:put', 'topic'], ['message:route', 'mailbox'], ['message:route', 'mailbox'],
        ['message:put', 'topic'], ['message:route', 'mailbox'], ['message:route', 'mailbox'],
      ]);
  });

  it('rejects topic fan-out atomically when one concrete route is forbidden', async () => {
    let denied = true;
    const fixture = messagingFixture({
      authorize: async (call) => denied && call.action === 'message:route'
        && call.resource.kind === 'mailbox' && call.resource.mailboxId === 'mailbox-b'
        ? { ok: false, reason: 'forbidden' }
        : allow(call.context.policyRevision),
    });
    const request = putRequest('atomic', { destination: { kind: 'topic', topicId: 'topic-1' } });
    await expect(fixture.store.put(request)).resolves.toEqual({ ok: false, reason: 'forbidden' });
    for (const mailboxId of ['mailbox-a', 'mailbox-b']) {
      await expect(fixture.store.pop({ context: productContext, mailboxId }))
        .resolves.toEqual({ ok: true, outcome: 'empty' });
    }
    denied = false;
    await expect(fixture.store.put(request)).resolves.toMatchObject({
      ok: true, outcome: 'accepted', messageId: 'message-1',
    });
  });

  it('reauthorizes every subscription push before creating its lease', async () => {
    const fixture = messagingFixture();
    const subscribed = await fixture.store.subscribe({
      context: productContext, mailboxId: 'mailbox-1', maxInFlight: 1,
    });
    if (!subscribed.ok) throw new Error('Expected subscription');
    await fixture.store.put(putRequest('push-1'));
    const first = await subscribed.subscription[Symbol.asyncIterator]().next();
    if (first.done) throw new Error('Expected first push');
    await fixture.store.ack({
      context: productContext, deliveryId: first.value.deliveryId,
      leaseId: first.value.lease.leaseId, ackIdempotencyKey: 'push-ack',
      disposition: { kind: 'processed' },
    });

    await fixture.store.put(putRequest('push-2'));
    fixture.setAuthorization(denyAction('message:push'));
    await expect(subscribed.subscription[Symbol.asyncIterator]().next())
      .resolves.toEqual({ done: true, value: undefined });
    await expect(subscribed.subscription.terminal)
      .resolves.toEqual({ reason: 'authorization_revoked' });
    const popped = await fixture.store.pop({ context: productContext, mailboxId: 'mailbox-1' });
    expect(popped).toMatchObject({ ok: true, outcome: 'delivery', delivery: { deliveryAttempt: 1 } });
    expect(fixture.authorizationCalls.filter(({ action }) => action === 'message:push'))
      .toHaveLength(2);
  });

  it('fails closed on unavailable and stale-revision authorization decisions', async () => {
    const unavailable = messagingFixture({ authorize: async () => { throw new Error('down'); } });
    await expect(unavailable.store.put(putRequest('down')))
      .resolves.toEqual({ ok: false, reason: 'unavailable' });
    const stale = messagingFixture({ authorize: async () => allow('stale-revision') });
    await expect(stale.store.subscribe({ context: productContext, mailboxId: 'mailbox-1' }))
      .resolves.toEqual({ ok: false, reason: 'unavailable' });
  });
});
