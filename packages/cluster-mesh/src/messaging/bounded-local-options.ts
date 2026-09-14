export interface BoundedLocalMessagingOptions {
  readonly maxMessages: number;
  readonly maxBytes: number;
  readonly maxMessageBytes: number;
  readonly maxSubscriptions: number;
  readonly defaultVisibilityTimeoutMs: number;
  readonly maxVisibilityTimeoutMs: number;
  readonly ackTombstoneTtlMs: number;
  readonly maxAckTombstones: number;
  readonly maxDrainLeaseMs: number;
  readonly now?: () => Date;
  readonly id?: (
    kind: 'message' | 'delivery' | 'lease' | 'subscription' | 'drain-lease',
  ) => string;
}
