import type { BoundedLocalMessagingOptions } from './bounded-local-options.js';
import type { DeliveryId, MailboxId, MessageId } from './message-contracts.js';
import type {
  AckTombstone,
  PreparedPut,
  PutMutationResult,
  StoredDelivery,
  StoredDrain,
  StoredMailbox,
  StoredMessage,
} from './local-model.js';
import { DELIVERY_OVERHEAD_BYTES } from './local-model.js';
import { AsyncMutex, resolveMessagingOptions, type ResolvedMessagingOptions } from './local-support.js';

export type PutMutation = PutMutationResult | {
  readonly error: 'idempotency_conflict' | 'capacity_exhausted' | 'unavailable';
};

export class LocalMessagingState {
  readonly options: ResolvedMessagingOptions;
  readonly mutex = new AsyncMutex();
  readonly messages = new Map<MessageId, StoredMessage>();
  readonly idempotency = new Map<string, MessageId>();
  readonly mailboxes = new Map<MailboxId, StoredMailbox>();
  readonly deliveries = new Map<DeliveryId, StoredDelivery>();
  readonly tombstones = new Map<DeliveryId, AckTombstone>();
  readonly drains = new Map<string, StoredDrain>();
  totalBytes = 0;
  signalVersion = 0;
  private readonly waiters = new Set<() => void>();

  constructor(options: BoundedLocalMessagingOptions) {
    this.options = resolveMessagingOptions(options);
  }

  nowMs(): number | null {
    const value = this.options.now().getTime();
    return Number.isFinite(value) ? value : null;
  }

  cleanup(nowMs: number): void {
    for (const tombstone of [...this.tombstones.values()]) {
      if (tombstone.ackedAtMs + this.options.ackTombstoneTtlMs <= nowMs) {
        this.tombstones.delete(tombstone.deliveryId);
        this.totalBytes -= tombstone.bytes;
      }
    }
    for (const delivery of [...this.deliveries.values()]) {
      const message = this.messages.get(delivery.messageId);
      if (!message) { this.deliveries.delete(delivery.deliveryId); continue; }
      const leaseExpiry = delivery.lease ? Date.parse(delivery.lease.expiresAt) : null;
      if (leaseExpiry !== null && leaseExpiry <= nowMs) {
        delete delivery.lease;
        delete delivery.leaseSubscriptionId;
      }
      const expiry = message.message.expiresAt ? Date.parse(message.message.expiresAt) : null;
      if (!delivery.lease && expiry !== null && expiry <= nowMs) this.removeDelivery(delivery);
    }
  }

  removeDelivery(delivery: StoredDelivery): void {
    if (!this.deliveries.delete(delivery.deliveryId)) return;
    this.totalBytes -= delivery.bytes;
    const message = this.messages.get(delivery.messageId);
    if (!message) return;
    message.deliveryIds.delete(delivery.deliveryId);
    if (message.deliveryIds.size === 0) {
      this.messages.delete(message.message.messageId);
      this.idempotency.delete(message.idempotencyScope);
      this.totalBytes -= message.bytes;
    }
  }

  mutatePut(prepared: PreparedPut): PutMutation {
    const existingId = this.idempotency.get(prepared.idempotencyScope);
    if (existingId) {
      const existing = this.messages.get(existingId);
      if (!existing) return { error: 'unavailable' };
      return existing.fingerprint === prepared.fingerprint
        ? { outcome: 'idempotent_replay', messageId: existingId, mailboxIds: existing.mailboxIds }
        : { error: 'idempotency_conflict' };
    }
    if (this.messages.size >= this.options.maxMessages
      || this.totalBytes + prepared.messageBytes + prepared.deliveryBytes > this.options.maxBytes
      || this.messages.has(prepared.message.messageId)) return { error: 'capacity_exhausted' };
    const allocated: Array<{ deliveryId: string; mailboxId: string; sequence: number }> = [];
    const seen = new Set<string>();
    for (const [index, mailboxId] of prepared.mailboxIds.entries()) {
      const mailbox = this.mailboxes.get(mailboxId) ?? { nextSequence: 1, deliveryIds: [] };
      if (!Number.isSafeInteger(mailbox.nextSequence)) return { error: 'unavailable' };
      const deliveryId = prepared.deliveryIds[index];
      if (!deliveryId || seen.has(deliveryId) || this.deliveries.has(deliveryId)) {
        return { error: 'unavailable' };
      }
      seen.add(deliveryId);
      allocated.push({ deliveryId, mailboxId, sequence: mailbox.nextSequence });
    }
    const stored: StoredMessage = {
      message: prepared.message,
      idempotencyScope: prepared.idempotencyScope,
      fingerprint: prepared.fingerprint,
      mailboxIds: prepared.mailboxIds,
      bytes: prepared.messageBytes,
      deliveryIds: new Set(allocated.map(({ deliveryId }) => deliveryId)),
    };
    this.messages.set(prepared.message.messageId, stored);
    this.idempotency.set(prepared.idempotencyScope, prepared.message.messageId);
    this.totalBytes += stored.bytes;
    for (const item of allocated) {
      const mailbox = this.mailboxes.get(item.mailboxId)
        ?? { nextSequence: 1, deliveryIds: [] };
      const bytes = DELIVERY_OVERHEAD_BYTES
        + Buffer.byteLength(item.mailboxId, 'utf8') + Buffer.byteLength(item.deliveryId, 'utf8');
      mailbox.deliveryIds.push(item.deliveryId);
      mailbox.nextSequence += 1;
      this.mailboxes.set(item.mailboxId, mailbox);
      this.deliveries.set(item.deliveryId, {
        ...item, mailboxSequence: item.sequence, messageId: stored.message.messageId,
        bytes, deliveryAttempt: 0,
      });
      this.totalBytes += bytes;
    }
    this.signal();
    return { outcome: 'accepted', messageId: stored.message.messageId, mailboxIds: stored.mailboxIds };
  }

  signal(): void {
    this.signalVersion += 1;
    for (const resolve of this.waiters) resolve();
    this.waiters.clear();
  }

  waitForSignal(version: number, timeoutMs = 25): Promise<void> {
    if (version !== this.signalVersion) return Promise.resolve();
    return new Promise((resolve) => {
      const done = (): void => { clearTimeout(timer); this.waiters.delete(done); resolve(); };
      const timer = setTimeout(done, timeoutMs);
      this.waiters.add(done);
    });
  }
}
