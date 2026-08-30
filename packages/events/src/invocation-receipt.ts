import type { IdempotencyKey } from '@sentropic/contracts';

export const INVOCATION_RECEIPT_STAGES = [
  'transported',
  'verified',
  'acted',
] as const;

export type InvocationReceiptStage = (typeof INVOCATION_RECEIPT_STAGES)[number];

interface InvocationReceiptBase {
  readonly receiptId: string;
  readonly invocationId: string;
  readonly correlationId: string;
  readonly generationId: string;
  readonly idempotencyKey: IdempotencyKey;
  readonly occurredAt: string;
}

export interface TransportedInvocationReceipt extends InvocationReceiptBase {
  readonly stage: 'transported';
}

export interface VerifiedInvocationReceipt extends InvocationReceiptBase {
  readonly stage: 'verified';
  readonly decision: 'accepted' | 'refused';
  readonly reason?: string;
}

export interface ActedInvocationReceipt extends InvocationReceiptBase {
  readonly stage: 'acted';
  readonly effectRef: string;
}

export type InvocationReceipt =
  | TransportedInvocationReceipt
  | VerifiedInvocationReceipt
  | ActedInvocationReceipt;

export interface InvocationReceiptPort {
  append(receipt: InvocationReceipt): Promise<void>;
}
