import { canonicalBytes, canonicalEqual } from './canonical-json.js';
import type { AckMessageRequest, AckMessageResult } from './delivery-contracts.js';
import { TOMBSTONE_OVERHEAD_BYTES, type AckTombstone } from './local-model.js';
import { authorizeProduct } from './local-support.js';
import { LocalMessagingState } from './local-state.js';
import type { MessagingProductAuthorizationPort, MessagingProductResource } from './product-authorization.js';
import { validContext, validDisposition } from './validation.js';

export class AckOperation {
  constructor(
    private readonly state: LocalMessagingState,
    private readonly authorization: MessagingProductAuthorizationPort,
  ) {}

  async ack(input: AckMessageRequest): Promise<AckMessageResult> {
    if (!validContext(input.context) || !input.deliveryId || !input.leaseId
      || !input.ackIdempotencyKey || !validDisposition(input.disposition)) {
      return { ok: false, reason: 'unavailable' };
    }
    const resource = await this.state.mutex.run(() => this.resource(input.deliveryId));
    if (!resource) return { ok: false, reason: 'delivery_not_found' };
    const authorization = await authorizeProduct(
      this.authorization, input.context, 'message:ack', resource,
    );
    if (authorization !== 'allowed') return {
      ok: false, reason: authorization === 'forbidden' ? 'forbidden' : 'unavailable',
    };
    return this.state.mutex.run(() => this.mutate(input));
  }

  private resource(deliveryId: string): MessagingProductResource | null {
    const delivery = this.state.deliveries.get(deliveryId);
    if (delivery) return {
      kind: 'delivery', mailboxId: delivery.mailboxId,
      messageId: delivery.messageId, deliveryId,
    };
    const tombstone = this.state.tombstones.get(deliveryId);
    return tombstone ? {
      kind: 'delivery', mailboxId: tombstone.mailboxId,
      messageId: tombstone.messageId, deliveryId,
    } : null;
  }

  private mutate(input: AckMessageRequest): AckMessageResult {
    const nowMs = this.state.nowMs();
    if (nowMs === null) return { ok: false, reason: 'unavailable' };
    this.pruneTombstones(nowMs);
    const tombstone = this.state.tombstones.get(input.deliveryId);
    if (tombstone) return this.replay(tombstone, input);
    const delivery = this.state.deliveries.get(input.deliveryId);
    if (!delivery) return { ok: false, reason: 'delivery_not_found' };
    if (!delivery.lease || delivery.lease.leaseId !== input.leaseId
      || delivery.lease.ownerPrincipalId !== input.context.principalId) {
      return { ok: false, reason: 'lease_mismatch' };
    }
    if (Date.parse(delivery.lease.expiresAt) <= nowMs) {
      delete delivery.lease;
      delete delivery.leaseSubscriptionId;
      const message = this.state.messages.get(delivery.messageId);
      if (message?.message.expiresAt && Date.parse(message.message.expiresAt) <= nowMs) {
        this.state.removeDelivery(delivery);
      }
      this.state.signal();
      return { ok: false, reason: 'lease_expired' };
    }
    const message = this.state.messages.get(delivery.messageId);
    if (!message || !this.dispositionMatchesMessage(input, message.message.actuation?.commandRef)) {
      return { ok: false, reason: 'ack_conflict' };
    }
    const storedDisposition = structuredClone(input.disposition);
    const bytes = TOMBSTONE_OVERHEAD_BYTES + canonicalBytes({
      leaseId: input.leaseId,
      ackIdempotencyKey: input.ackIdempotencyKey,
      disposition: storedDisposition,
    });
    this.trimToCap();
    const freed = delivery.bytes + (message.deliveryIds.size === 1 ? message.bytes : 0);
    if (this.state.totalBytes - freed + bytes > this.state.options.maxBytes) {
      return { ok: false, reason: 'unavailable' };
    }
    this.state.removeDelivery(delivery);
    this.state.tombstones.set(input.deliveryId, {
      deliveryId: input.deliveryId, leaseId: input.leaseId,
      ackIdempotencyKey: input.ackIdempotencyKey, disposition: storedDisposition,
      mailboxId: delivery.mailboxId, messageId: delivery.messageId, ackedAtMs: nowMs, bytes,
    });
    this.state.totalBytes += bytes;
    this.state.signal();
    return { ok: true, outcome: 'acked' };
  }

  private dispositionMatchesMessage(input: AckMessageRequest, commandRef?: string): boolean {
    return input.disposition.kind !== 'actuation'
      || (commandRef !== undefined && input.disposition.commandRef === commandRef);
  }

  private replay(tombstone: AckTombstone, input: AckMessageRequest): AckMessageResult {
    return tombstone.leaseId === input.leaseId
      && tombstone.ackIdempotencyKey === input.ackIdempotencyKey
      && canonicalEqual(tombstone.disposition, input.disposition)
      ? { ok: true, outcome: 'idempotent_replay' }
      : { ok: false, reason: 'ack_conflict' };
  }

  private pruneTombstones(nowMs: number): void {
    for (const tombstone of [...this.state.tombstones.values()]) {
      if (tombstone.ackedAtMs + this.state.options.ackTombstoneTtlMs <= nowMs) {
        this.state.tombstones.delete(tombstone.deliveryId);
        this.state.totalBytes -= tombstone.bytes;
      }
    }
  }

  private trimToCap(): void {
    while (this.state.tombstones.size >= this.state.options.maxAckTombstones) {
      const oldest = this.state.tombstones.values().next().value as AckTombstone | undefined;
      if (!oldest) return;
      this.state.tombstones.delete(oldest.deliveryId);
      this.state.totalBytes -= oldest.bytes;
    }
  }
}
