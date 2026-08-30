import type { IdempotencyKey } from '@sentropic/contracts';
import type {
  ActedInvocationReceipt,
  InvocationReceiptPort,
  TransportedInvocationReceipt,
  VerifiedInvocationReceipt,
} from '@sentropic/events';

export interface ReceiptCoordinates {
  readonly invocationId: string;
  readonly correlationId: string;
  readonly idempotencyKey: IdempotencyKey;
}

export interface InvocationReceiptEmitter {
  transported(input: ReceiptCoordinates): Promise<TransportedInvocationReceipt>;
  verified(
    input: ReceiptCoordinates,
    decision: 'accepted' | 'refused',
    reason?: string,
  ): Promise<VerifiedInvocationReceipt>;
  acted(input: ReceiptCoordinates, effectRef: string): Promise<ActedInvocationReceipt>;
}

export function createInvocationReceiptEmitter(input: {
  readonly generationId: string;
  readonly port: InvocationReceiptPort;
  readonly now?: () => Date;
  readonly receiptId?: (stage: string, invocationId: string) => string;
}): InvocationReceiptEmitter {
  const now = input.now ?? (() => new Date());
  const receiptId = input.receiptId ?? ((stage, invocationId) => `${invocationId}:${stage}`);
  const base = (stage: string, coordinates: ReceiptCoordinates) => ({
    ...coordinates,
    receiptId: receiptId(stage, coordinates.invocationId),
    generationId: input.generationId,
    occurredAt: now().toISOString(),
  });
  return {
    async transported(coordinates) {
      const receipt: TransportedInvocationReceipt = {
        ...base('transported', coordinates),
        stage: 'transported',
      };
      await input.port.append(receipt);
      return receipt;
    },
    async verified(coordinates, decision, reason) {
      const receipt: VerifiedInvocationReceipt = {
        ...base('verified', coordinates),
        stage: 'verified',
        decision,
        reason,
      };
      await input.port.append(receipt);
      return receipt;
    },
    async acted(coordinates, effectRef) {
      const receipt: ActedInvocationReceipt = {
        ...base('acted', coordinates),
        stage: 'acted',
        effectRef,
      };
      await input.port.append(receipt);
      return receipt;
    },
  };
}
