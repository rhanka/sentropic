import { randomUUID } from 'node:crypto';
import type { BoundedLocalMessagingOptions } from './bounded-local-options.js';
import type {
  MessagingProductAction,
  MessagingProductAuthorizationPort,
  MessagingProductResource,
} from './product-authorization.js';
import type { MessagingProductContext } from './message-contracts.js';

export interface ResolvedMessagingOptions extends BoundedLocalMessagingOptions {
  readonly now: () => Date;
  readonly id: NonNullable<BoundedLocalMessagingOptions['id']>;
}

const positiveInteger = (value: number): boolean => Number.isSafeInteger(value) && value > 0;

export const resolveMessagingOptions = (
  input: BoundedLocalMessagingOptions,
): ResolvedMessagingOptions => {
  const integers = [
    input.maxMessages, input.maxBytes, input.maxMessageBytes, input.maxSubscriptions,
    input.defaultVisibilityTimeoutMs, input.maxVisibilityTimeoutMs,
    input.ackTombstoneTtlMs, input.maxAckTombstones, input.maxDrainLeaseMs,
  ];
  if (!integers.every(positiveInteger)
    || input.maxMessageBytes > input.maxBytes
    || input.defaultVisibilityTimeoutMs > input.maxVisibilityTimeoutMs) {
    throw new RangeError('Invalid bounded-local messaging options');
  }
  return {
    ...input,
    now: input.now ?? (() => new Date()),
    id: input.id ?? ((kind) => `${kind}-${randomUUID()}`),
  };
};

export const duration = (value: number | undefined, fallback: number, maximum: number): number | null => {
  const selected = value ?? fallback;
  return positiveInteger(selected) && selected <= maximum ? selected : null;
};

export type AuthorizationOutcome = 'allowed' | 'forbidden' | 'unavailable';

export const authorizeProduct = async (
  port: MessagingProductAuthorizationPort,
  context: MessagingProductContext,
  action: MessagingProductAction,
  resource: MessagingProductResource,
): Promise<AuthorizationOutcome> => {
  try {
    const decision = await port.authorize({ context, action, resource });
    if (!decision || decision.ok === false) {
      return decision?.reason === 'forbidden' ? 'forbidden' : 'unavailable';
    }
    return decision.policyRevision === context.policyRevision
      && typeof decision.decisionRef === 'string' && decision.decisionRef.length > 0
      ? 'allowed' : 'unavailable';
  } catch { return 'unavailable'; }
};

export class AsyncMutex {
  private tail: Promise<void> = Promise.resolve();

  async run<T>(operation: () => T | Promise<T>): Promise<T> {
    let release = (): void => undefined;
    const turn = new Promise<void>((resolve) => { release = resolve; });
    const previous = this.tail;
    this.tail = previous.then(() => turn);
    await previous;
    try { return await operation(); } finally { release(); }
  }
}
