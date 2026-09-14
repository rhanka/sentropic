import type { ActuationRequest } from '../runtime/registration.js';

export type MessageId = string;
export type DeliveryId = string;
export type MailboxId = string;
export type TopicId = string;
export type SubscriptionId = string;
export type MessageLeaseId = string;

export type MessageJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly MessageJsonValue[]
  | { readonly [key: string]: MessageJsonValue };

export interface MessagingProductContext {
  /** Authenticated product principal; never accepted from the message body. */
  readonly principalId: string;
  readonly tenantId?: string;
  readonly workspaceId?: string;
  readonly scopes: readonly string[];
  readonly policyRevision: string;
  readonly authenticationEvidenceRef: string;
}

export type MessageAddress =
  | { readonly kind: 'mailbox'; readonly mailboxId: MailboxId }
  | { readonly kind: 'topic'; readonly topicId: TopicId };

export interface MessagePayload {
  readonly contentType: string;
  readonly value: MessageJsonValue;
}

export interface MessageActuationIntent {
  readonly kind: 'session-control';
  readonly targetRegistrationId: string;
  readonly action: ActuationRequest['action'];
  /** Opaque command identity, signed-instruction lookup key, and invocation ID. */
  readonly commandRef: string;
}

export interface MeshMessage {
  readonly version: 'sentropic.cluster-mesh.message/v1';
  readonly messageId: MessageId;
  readonly producerPrincipalId: string;
  readonly destination: MessageAddress;
  readonly idempotencyKey: string;
  readonly payload: MessagePayload;
  readonly actuation?: MessageActuationIntent;
  readonly metadata?: Readonly<Record<string, MessageJsonValue>>;
  readonly enqueuedAt: string;
  readonly expiresAt?: string;
}

export interface PutMessageRequest {
  readonly context: MessagingProductContext;
  readonly destination: MessageAddress;
  readonly idempotencyKey: string;
  readonly payload: MessagePayload;
  readonly actuation?: MessageActuationIntent;
  readonly metadata?: Readonly<Record<string, MessageJsonValue>>;
  readonly expiresAt?: string;
}

export type PutMessageResult =
  | {
      readonly ok: true;
      readonly outcome: 'accepted' | 'idempotent_replay';
      readonly messageId: MessageId;
      readonly mailboxIds: readonly MailboxId[];
    }
  | {
      readonly ok: false;
      readonly reason:
        | 'forbidden'
        | 'invalid_message'
        | 'route_unresolved'
        | 'idempotency_conflict'
        | 'capacity_exhausted'
        | 'unavailable';
    };
