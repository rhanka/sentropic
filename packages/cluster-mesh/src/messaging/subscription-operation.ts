import type {
  MessageDelivery,
  MessageSubscription,
  MessageSubscriptionTerminal,
  SubscribeMessagesRequest,
  SubscribeMessagesResult,
} from './delivery-contracts.js';
import { DeliveryOperation } from './delivery-operation.js';
import { authorizeProduct, duration } from './local-support.js';
import { LocalMessagingState } from './local-state.js';
import type { MessagingProductAuthorizationPort } from './product-authorization.js';
import { validContext } from './validation.js';

export class SubscriptionOperation {
  private readonly active = new Map<string, LocalMessageSubscription>();

  constructor(
    private readonly state: LocalMessagingState,
    private readonly authorization: MessagingProductAuthorizationPort,
    private readonly deliveries: DeliveryOperation,
  ) {}

  async subscribe(input: SubscribeMessagesRequest): Promise<SubscribeMessagesResult> {
    const timeoutMs = duration(
      input.visibilityTimeoutMs,
      this.state.options.defaultVisibilityTimeoutMs,
      this.state.options.maxVisibilityTimeoutMs,
    );
    const maxInFlight = input.maxInFlight ?? 1;
    if (!validContext(input.context) || !input.mailboxId || timeoutMs === null
      || !Number.isSafeInteger(maxInFlight) || maxInFlight <= 0
      || maxInFlight > this.state.options.maxMessages) {
      return { ok: false, reason: 'unavailable' };
    }
    const decision = await authorizeProduct(
      this.authorization, input.context, 'message:subscribe',
      { kind: 'mailbox', mailboxId: input.mailboxId },
    );
    if (decision !== 'allowed') return {
      ok: false, reason: decision === 'forbidden' ? 'forbidden' : 'unavailable',
    };
    return this.state.mutex.run(() => {
      if (this.active.size >= this.state.options.maxSubscriptions) {
        return { ok: false, reason: 'subscription_capacity_exhausted' } as const;
      }
      const subscriptionId = this.state.options.id('subscription');
      if (!subscriptionId || this.active.has(subscriptionId)) {
        return { ok: false, reason: 'unavailable' } as const;
      }
      const subscription = new LocalMessageSubscription({
        subscriptionId, request: input, timeoutMs, maxInFlight,
        state: this.state, authorization: this.authorization, deliveries: this.deliveries,
        onClose: () => { this.active.delete(subscriptionId); this.state.signal(); },
      });
      this.active.set(subscriptionId, subscription);
      return { ok: true, subscription } as const;
    });
  }
}

class LocalMessageSubscription implements MessageSubscription, AsyncIterator<MessageDelivery> {
  readonly subscriptionId: string;
  readonly mailboxId: string;
  readonly terminal: Promise<MessageSubscriptionTerminal>;
  private terminalResult?: MessageSubscriptionTerminal;
  private resolveTerminal!: (value: MessageSubscriptionTerminal) => void;

  constructor(private readonly input: {
    readonly subscriptionId: string;
    readonly request: SubscribeMessagesRequest;
    readonly timeoutMs: number;
    readonly maxInFlight: number;
    readonly state: LocalMessagingState;
    readonly authorization: MessagingProductAuthorizationPort;
    readonly deliveries: DeliveryOperation;
    readonly onClose: () => void;
  }) {
    this.subscriptionId = input.subscriptionId;
    this.mailboxId = input.request.mailboxId;
    this.terminal = new Promise((resolve) => { this.resolveTerminal = resolve; });
  }

  [Symbol.asyncIterator](): AsyncIterator<MessageDelivery> { return this; }

  async next(): Promise<IteratorResult<MessageDelivery>> {
    while (!this.terminalResult) {
      const version = this.input.state.signalVersion;
      const candidate = await this.input.deliveries.peek(
        this.mailboxId, this.subscriptionId, this.input.maxInFlight,
      );
      if (candidate === 'unavailable') return this.finish('unavailable');
      if (!candidate) {
        await this.input.state.waitForSignal(version);
        continue;
      }
      const decision = await authorizeProduct(
        this.input.authorization, this.input.request.context, 'message:push',
        { kind: 'delivery', mailboxId: candidate.mailboxId,
          messageId: candidate.messageId, deliveryId: candidate.deliveryId },
      );
      if (decision !== 'allowed') {
        return this.finish(decision === 'forbidden' ? 'authorization_revoked' : 'unavailable');
      }
      const claimed = await this.input.deliveries.claimCandidate(
        candidate, this.input.request.context.principalId,
        this.input.timeoutMs, this.subscriptionId,
      );
      if (claimed.kind === 'delivery') return { done: false, value: claimed.delivery };
      if (claimed.kind === 'unavailable') return this.finish('unavailable');
    }
    return { done: true, value: undefined };
  }

  async return(): Promise<IteratorResult<MessageDelivery>> {
    await this.close();
    return { done: true, value: undefined };
  }

  async close(): Promise<void> { this.finish('closed'); }

  private finish(reason: MessageSubscriptionTerminal['reason']): IteratorResult<MessageDelivery> {
    if (!this.terminalResult) {
      const terminal: MessageSubscriptionTerminal = { reason };
      this.terminalResult = terminal;
      this.resolveTerminal(terminal);
      this.input.onClose();
    }
    return { done: true, value: undefined };
  }
}
