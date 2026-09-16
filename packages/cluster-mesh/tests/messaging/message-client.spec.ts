import { describe, expect, it, vi } from 'vitest';
import {
  AGENT_MESSAGE_CONTENT_TYPE,
  ClusterMeshMessageClient,
  messageEnvelopeSignaturePayload,
  type AgentMessageKind,
  type MessagingProductContext,
} from '../../src/index.js';
import {
  createEphemeralCustodyKey,
  verifyCustodySignature,
} from '../../src/runtime/custody-crypto.js';
import { messagingFixture, productContext } from '../messaging-fixture.js';

const context = (principalId: string): MessagingProductContext => ({
  ...productContext, principalId, authenticationEvidenceRef: `auth-${principalId}`,
});

function clientFixture() {
  const fixture = messagingFixture();
  const key = createEphemeralCustodyKey('agent-a');
  let id = 0;
  const sender = new ClusterMeshMessageClient({
    store: fixture.store, context: context('agent-a'), signer: key.signer, issuer: key.issuer,
    idempotencyKey: () => `send-${++id}`,
  });
  const receiver = new ClusterMeshMessageClient({
    store: fixture.store, context: context('agent-b'), signer: key.signer, issuer: key.issuer,
    visibilityTimeoutMs: 100,
  });
  return { fixture, key, receiver, sender };
}

describe('cluster mesh message client', () => {
  it('should send, drain, and acknowledge a notification without actuation intent', async () => {
    const { fixture, receiver, sender } = clientFixture();
    const put = vi.spyOn(fixture.store, 'put');
    const sent = await sender.sendMessage({ to: 'agent-b', message: { event: 'ready' } });
    expect(sent).toEqual({ ok: true, messageId: 'message-1' });
    if (!sent.ok) throw new Error('Expected accepted message');
    expect(put.mock.calls[0]?.[0]).not.toHaveProperty('actuation');

    const messages = await receiver.receiveMessages({ instance: 'agent-b' });
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      messageId: sent.messageId, producerPrincipalId: 'agent-a', kind: 'notify',
      message: { event: 'ready' }, destination: { kind: 'mailbox', mailboxId: 'agent-b' },
    });
    expect(messages[0]).not.toHaveProperty('actuation');
    await expect(receiver.ack(sent.messageId)).resolves.toEqual({ ok: true, outcome: 'acked' });
    await expect(receiver.receiveMessages({ instance: 'agent-b' })).resolves.toEqual([]);
  });

  it.each(['wake', 'notify', 'text'] as const)(
    'should carry and verify a signed %s envelope',
    async (kind: AgentMessageKind) => {
      const { key, receiver, sender } = clientFixture();
      await sender.sendMessage({ to: 'agent-b', message: `message-${kind}`, kind });
      const [received] = await receiver.receiveMessages({ instance: 'agent-b' });
      expect(received).toMatchObject({ kind, message: `message-${kind}` });
      const trust = await key.trustRoot.resolve(received!.envelope.issuer);
      expect(trust).not.toBeNull();
      expect(verifyCustodySignature({
        publicKeyBase64Url: trust!.publicKeyBase64Url,
        payload: messageEnvelopeSignaturePayload(received!.envelope),
        signatureBase64Url: received!.envelope.evidence.signatureBase64Url,
      })).toBe(true);
    },
  );

  it.each(['application/json', AGENT_MESSAGE_CONTENT_TYPE])(
    'should skip poison messages with content type %s without consuming them',
    async (contentType) => {
      const { fixture, receiver, sender } = clientFixture();
      await sender.sendMessage({ to: 'agent-b', message: 'before' });
      const poison = await fixture.store.put({
        context: context('other-producer'),
        destination: { kind: 'mailbox', mailboxId: 'agent-b' },
        idempotencyKey: 'poison', payload: { contentType, value: 'not an envelope' },
      });
      expect(poison.ok).toBe(true);
      if (!poison.ok) throw new Error('Expected accepted poison message');
      await sender.sendMessage({ to: 'agent-b', message: 'after' });

      const messages = await receiver.receiveMessages({ instance: 'agent-b' });
      expect(messages.map(({ message }) => message)).toEqual(['before', 'after']);
      for (const { messageId } of messages) {
        await expect(receiver.ack(messageId)).resolves.toEqual({ ok: true, outcome: 'acked' });
      }
      await expect(receiver.ack(poison.messageId)).resolves.toEqual({
        ok: false, reason: 'delivery_not_found',
      });
      fixture.advance(101);
      await expect(fixture.store.pop({
        context: context('other-consumer'), mailboxId: 'agent-b',
      })).resolves.toMatchObject({
        ok: true, outcome: 'delivery',
        delivery: { message: { messageId: poison.messageId, payload: { contentType,
          value: 'not an envelope' } }, deliveryAttempt: 2 },
      });
    },
  );

  it('should redeliver an unacknowledged message and stop after acknowledgement', async () => {
    const { fixture, receiver, sender } = clientFixture();
    const sent = await sender.sendMessage({ to: 'agent-b', message: 'retry', kind: 'text' });
    if (!sent.ok) throw new Error('Expected accepted message');
    const first = await receiver.receiveMessages({ instance: 'agent-b' });
    expect(first.map(({ messageId }) => messageId)).toEqual([sent.messageId]);
    await expect(receiver.receiveMessages({ instance: 'agent-b' })).resolves.toEqual([]);

    fixture.advance(101);
    const redelivered = await receiver.receiveMessages({ instance: 'agent-b' });
    expect(redelivered.map(({ messageId }) => messageId)).toEqual([sent.messageId]);
    await expect(receiver.ack(sent.messageId)).resolves.toEqual({ ok: true, outcome: 'acked' });
    fixture.advance(101);
    await expect(receiver.receiveMessages({ instance: 'agent-b' })).resolves.toEqual([]);
  });
});
