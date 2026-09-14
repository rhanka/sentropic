import type { MessageAckDisposition, MessageVisibilityLease } from './delivery-contracts.js';
import type {
  DeliveryId,
  MailboxId,
  MeshMessage,
  MessageId,
  SubscriptionId,
} from './message-contracts.js';
import type { NativeDrainCursor, NativeDrainFence } from './native-drain-contracts.js';

export const MESSAGE_OVERHEAD_BYTES = 128;
export const DELIVERY_OVERHEAD_BYTES = 96;
export const TOMBSTONE_OVERHEAD_BYTES = 96;

export interface StoredMessage {
  readonly message: MeshMessage;
  readonly idempotencyScope: string;
  readonly fingerprint: string;
  readonly mailboxIds: readonly MailboxId[];
  readonly bytes: number;
  readonly deliveryIds: Set<DeliveryId>;
}

export interface StoredDelivery {
  readonly deliveryId: DeliveryId;
  readonly mailboxId: MailboxId;
  readonly mailboxSequence: number;
  readonly messageId: MessageId;
  readonly bytes: number;
  deliveryAttempt: number;
  lease?: MessageVisibilityLease;
  leaseSubscriptionId?: SubscriptionId;
}

export interface StoredMailbox {
  nextSequence: number;
  readonly deliveryIds: DeliveryId[];
}

export interface AckTombstone {
  readonly deliveryId: DeliveryId;
  readonly leaseId: string;
  readonly ackIdempotencyKey: string;
  readonly disposition: MessageAckDisposition;
  readonly mailboxId: MailboxId;
  readonly messageId: MessageId;
  readonly ackedAtMs: number;
  readonly bytes: number;
}

export interface StoredDrain {
  generation: number;
  fence?: NativeDrainFence;
  cursor: NativeDrainCursor | null;
  sourceEpoch?: string;
}

export interface PreparedPut {
  readonly producerPrincipalId: string;
  readonly idempotencyScope: string;
  readonly fingerprint: string;
  readonly mailboxIds: readonly MailboxId[];
  readonly deliveryIds: readonly DeliveryId[];
  readonly message: MeshMessage;
  readonly messageBytes: number;
  readonly deliveryBytes: number;
}

export interface PutMutationResult {
  readonly outcome: 'accepted' | 'idempotent_replay';
  readonly messageId: MessageId;
  readonly mailboxIds: readonly MailboxId[];
}
