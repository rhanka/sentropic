import type { ActuationResult } from '../runtime/registration.js';
import type {
  DeliveryId,
  MailboxId,
  MessageLeaseId,
  MeshMessage,
  MessagingProductContext,
  SubscriptionId,
} from './message-contracts.js';

export interface MessageVisibilityLease {
  readonly leaseId: MessageLeaseId;
  readonly ownerPrincipalId: string;
  readonly acquiredAt: string;
  readonly expiresAt: string;
}

export interface MessageDelivery {
  readonly deliveryId: DeliveryId;
  readonly mailboxId: MailboxId;
  readonly mailboxSequence: number;
  readonly deliveryAttempt: number;
  readonly message: MeshMessage;
  readonly lease: MessageVisibilityLease;
}

export interface PopMessageRequest {
  readonly context: MessagingProductContext;
  readonly mailboxId: MailboxId;
  readonly visibilityTimeoutMs?: number;
}

export type PopMessageResult =
  | { readonly ok: true; readonly outcome: 'delivery'; readonly delivery: MessageDelivery }
  | { readonly ok: true; readonly outcome: 'empty' }
  | { readonly ok: false; readonly reason: 'forbidden' | 'unavailable' };

export interface SubscribeMessagesRequest {
  readonly context: MessagingProductContext;
  readonly mailboxId: MailboxId;
  readonly visibilityTimeoutMs?: number;
  readonly maxInFlight?: number;
}

export type MessageSubscriptionTerminal =
  | { readonly reason: 'closed' }
  | { readonly reason: 'authorization_revoked' | 'unavailable' | 'store_restarted' };

export interface MessageSubscription extends AsyncIterable<MessageDelivery> {
  readonly subscriptionId: SubscriptionId;
  readonly mailboxId: MailboxId;
  readonly terminal: Promise<MessageSubscriptionTerminal>;
  close(): Promise<void>;
}

export type SubscribeMessagesResult =
  | { readonly ok: true; readonly subscription: MessageSubscription }
  | {
      readonly ok: false;
      readonly reason: 'forbidden' | 'subscription_capacity_exhausted' | 'unavailable';
    };

export type MessageAckDisposition =
  | { readonly kind: 'processed' }
  | { readonly kind: 'actuation'; readonly commandRef: string; readonly result: ActuationResult }
  | {
      readonly kind: 'quarantined';
      readonly reason: string;
      readonly commandRef?: string;
      readonly effectRef?: string;
    };

export interface AckMessageRequest {
  readonly context: MessagingProductContext;
  readonly deliveryId: DeliveryId;
  readonly leaseId: MessageLeaseId;
  readonly ackIdempotencyKey: string;
  readonly disposition: MessageAckDisposition;
}

export type AckMessageResult =
  | { readonly ok: true; readonly outcome: 'acked' | 'idempotent_replay' }
  | {
      readonly ok: false;
      readonly reason:
        | 'forbidden'
        | 'delivery_not_found'
        | 'lease_mismatch'
        | 'lease_expired'
        | 'ack_conflict'
        | 'unavailable';
    };

export interface ClusterMeshMessagingPort {
  put(input: import('./message-contracts.js').PutMessageRequest):
    Promise<import('./message-contracts.js').PutMessageResult>;
  pop(input: PopMessageRequest): Promise<PopMessageResult>;
  subscribe(input: SubscribeMessagesRequest): Promise<SubscribeMessagesResult>;
  ack(input: AckMessageRequest): Promise<AckMessageResult>;
}
