import type { MessageDelivery, PopMessageRequest, PopMessageResult } from './delivery-contracts.js';
import type { StoredDelivery } from './local-model.js';
import { authorizeProduct, duration } from './local-support.js';
import { LocalMessagingState } from './local-state.js';
import type { MessagingProductAuthorizationPort } from './product-authorization.js';
import { validContext } from './validation.js';

export type ClaimResult =
  | { readonly kind: 'delivery'; readonly delivery: MessageDelivery }
  | { readonly kind: 'empty' }
  | { readonly kind: 'unavailable' };

export interface VisibleCandidate {
  readonly deliveryId: string;
  readonly mailboxId: string;
  readonly messageId: string;
}

export class DeliveryOperation {
  constructor(
    private readonly state: LocalMessagingState,
    private readonly authorization: MessagingProductAuthorizationPort,
  ) {}

  async pop(input: PopMessageRequest): Promise<PopMessageResult> {
    const timeoutMs = duration(
      input.visibilityTimeoutMs,
      this.state.options.defaultVisibilityTimeoutMs,
      this.state.options.maxVisibilityTimeoutMs,
    );
    if (!validContext(input.context) || !input.mailboxId || timeoutMs === null) {
      return { ok: false, reason: 'unavailable' };
    }
    const decision = await authorizeProduct(
      this.authorization, input.context, 'message:pop',
      { kind: 'mailbox', mailboxId: input.mailboxId },
    );
    if (decision !== 'allowed') return {
      ok: false, reason: decision === 'forbidden' ? 'forbidden' : 'unavailable',
    };
    const claimed = await this.state.mutex.run(() =>
      this.claim(input.mailboxId, input.context.principalId, timeoutMs));
    if (claimed.kind === 'unavailable') return { ok: false, reason: 'unavailable' };
    return claimed.kind === 'empty' ? { ok: true, outcome: 'empty' }
      : { ok: true, outcome: 'delivery', delivery: claimed.delivery };
  }

  async peek(mailboxId: string, subscriptionId: string, maxInFlight: number): Promise<
    VisibleCandidate | null | 'unavailable'
  > {
    return this.state.mutex.run(() => {
      const nowMs = this.state.nowMs();
      if (nowMs === null) return 'unavailable';
      this.state.cleanup(nowMs);
      let inFlight = 0;
      for (const delivery of this.state.deliveries.values()) {
        if (delivery.leaseSubscriptionId === subscriptionId && delivery.lease) inFlight += 1;
      }
      if (inFlight >= maxInFlight) return null;
      const candidate = this.firstVisible(mailboxId);
      return candidate ? {
        deliveryId: candidate.deliveryId,
        mailboxId: candidate.mailboxId,
        messageId: candidate.messageId,
      } : null;
    });
  }

  async claimCandidate(
    candidate: VisibleCandidate,
    ownerPrincipalId: string,
    timeoutMs: number,
    subscriptionId: string,
  ): Promise<ClaimResult> {
    return this.state.mutex.run(() => {
      const current = this.state.deliveries.get(candidate.deliveryId);
      if (!current || current.lease || current.mailboxId !== candidate.mailboxId) {
        return { kind: 'empty' };
      }
      return this.claimRecord(current, ownerPrincipalId, timeoutMs, subscriptionId);
    });
  }

  private claim(mailboxId: string, ownerPrincipalId: string, timeoutMs: number): ClaimResult {
    const nowMs = this.state.nowMs();
    if (nowMs === null) return { kind: 'unavailable' };
    this.state.cleanup(nowMs);
    const candidate = this.firstVisible(mailboxId);
    return candidate ? this.claimRecord(candidate, ownerPrincipalId, timeoutMs)
      : { kind: 'empty' };
  }

  private firstVisible(mailboxId: string): StoredDelivery | null {
    const mailbox = this.state.mailboxes.get(mailboxId);
    if (!mailbox) return null;
    for (const deliveryId of mailbox.deliveryIds) {
      const delivery = this.state.deliveries.get(deliveryId);
      if (delivery && !delivery.lease) return delivery;
    }
    return null;
  }

  private claimRecord(
    stored: StoredDelivery,
    ownerPrincipalId: string,
    timeoutMs: number,
    subscriptionId?: string,
  ): ClaimResult {
    const nowMs = this.state.nowMs();
    if (nowMs === null || !Number.isSafeInteger(stored.deliveryAttempt + 1)) {
      return { kind: 'unavailable' };
    }
    const leaseId = this.state.options.id('lease');
    if (!leaseId || this.leaseExists(leaseId)) return { kind: 'unavailable' };
    const message = this.state.messages.get(stored.messageId);
    if (!message) return { kind: 'unavailable' };
    stored.deliveryAttempt += 1;
    stored.lease = {
      leaseId, ownerPrincipalId, acquiredAt: new Date(nowMs).toISOString(),
      expiresAt: new Date(nowMs + timeoutMs).toISOString(),
    };
    stored.leaseSubscriptionId = subscriptionId;
    return { kind: 'delivery', delivery: {
      deliveryId: stored.deliveryId, mailboxId: stored.mailboxId,
      mailboxSequence: stored.mailboxSequence, deliveryAttempt: stored.deliveryAttempt,
      message: structuredClone(message.message), lease: { ...stored.lease },
    } };
  }

  private leaseExists(leaseId: string): boolean {
    for (const delivery of this.state.deliveries.values()) {
      if (delivery.lease?.leaseId === leaseId) return true;
    }
    for (const tombstone of this.state.tombstones.values()) {
      if (tombstone.leaseId === leaseId) return true;
    }
    return false;
  }
}
