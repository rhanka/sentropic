import type {
  DeliveryId,
  MailboxId,
  MessageId,
  MessagingProductContext,
  TopicId,
} from './message-contracts.js';

export type MessagingProductAction =
  | 'message:put'
  | 'message:route'
  | 'message:pop'
  | 'message:subscribe'
  | 'message:push'
  | 'message:ack';

export type MessagingProductResource =
  | { readonly kind: 'mailbox'; readonly mailboxId: MailboxId }
  | { readonly kind: 'topic'; readonly topicId: TopicId }
  | {
      readonly kind: 'delivery';
      readonly mailboxId: MailboxId;
      readonly messageId: MessageId;
      readonly deliveryId: DeliveryId;
    };

export type MessagingProductAuthorizationDecision =
  | { readonly ok: true; readonly decisionRef: string; readonly policyRevision: string }
  | { readonly ok: false; readonly reason: 'forbidden' | 'unavailable' };

export interface MessagingProductAuthorizationPort {
  authorize(input: {
    readonly context: MessagingProductContext;
    readonly action: MessagingProductAction;
    readonly resource: MessagingProductResource;
  }): Promise<MessagingProductAuthorizationDecision>;
}

export interface MessageTopicRoutePort {
  resolve(input: {
    readonly context: MessagingProductContext;
    readonly topicId: TopicId;
  }): Promise<readonly MailboxId[]>;
}
