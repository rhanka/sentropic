import type {
  MessageActuationIntent,
  MessageAddress,
  MessageJsonValue,
  MessagePayload,
  MessagingProductContext,
} from './message-contracts.js';

export interface NativeDrainCursor {
  readonly sourceId: string;
  readonly sourceEpoch: string;
  /** Opaque exclusive position: the next read starts strictly after it. */
  readonly position: string;
}

export interface NativeDrainFence {
  readonly sourceId: string;
  readonly workerId: string;
  readonly generation: number;
  readonly leaseId: string;
  readonly acquiredAt: string;
  readonly expiresAt: string;
}

export interface NativeMessageRecord {
  readonly nativeMessageId: string;
  readonly cursorAfter: NativeDrainCursor;
  readonly destination: MessageAddress;
  readonly payload: MessagePayload;
  readonly actuation?: MessageActuationIntent;
  readonly metadata?: Readonly<Record<string, MessageJsonValue>>;
  readonly producedAt?: string;
  readonly expiresAt?: string;
}

export interface NativeMessageBatch {
  readonly sourceId: string;
  readonly sourceEpoch: string;
  readonly after: NativeDrainCursor | null;
  readonly records: readonly NativeMessageRecord[];
  readonly nextCursor: NativeDrainCursor | null;
  readonly exhausted: boolean;
}

export interface NativeMessageSourcePort {
  read(input: {
    readonly sourceId: string;
    readonly after: NativeDrainCursor | null;
    readonly limit: number;
  }): Promise<NativeMessageBatch>;
}

export type NativeDrainAcquireResult =
  | { readonly ok: true; readonly fence: NativeDrainFence; readonly cursor: NativeDrainCursor | null }
  | { readonly ok: false; readonly reason: 'lease_held' | 'unavailable' };

export type NativeDrainImportResult =
  | {
      readonly ok: true;
      readonly outcome: 'advanced' | 'idempotent_replay' | 'exhausted';
      readonly imported: number;
      readonly cursor: NativeDrainCursor | null;
    }
  | {
      readonly ok: false;
      readonly reason:
        | 'fenced'
        | 'lease_expired'
        | 'cursor_conflict'
        | 'source_epoch_changed'
        | 'invalid_batch'
        | 'forbidden'
        | 'capacity_exhausted'
        | 'unavailable';
    };

export interface NativeDrainCoordinatorPort {
  acquire(input: {
    readonly sourceId: string;
    readonly workerId: string;
    readonly leaseMs: number;
  }): Promise<NativeDrainAcquireResult>;
  renew(input: {
    readonly fence: NativeDrainFence;
    readonly leaseMs: number;
  }): Promise<NativeDrainFence | null>;
  importBatch(input: {
    readonly context: MessagingProductContext;
    readonly fence: NativeDrainFence;
    readonly expectedCursor: NativeDrainCursor | null;
    readonly batch: NativeMessageBatch;
  }): Promise<NativeDrainImportResult>;
  release(input: { readonly fence: NativeDrainFence }): Promise<boolean>;
}
