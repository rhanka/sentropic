import type { ActuationResult, RegistrationFailureReason } from '../runtime/registration.js';
import type { MessageDelivery } from './delivery-contracts.js';
import type { DeliveryId, MessageActuationIntent } from './message-contracts.js';

export interface DeliveryActuationHandoffRequest {
  readonly delivery: MessageDelivery;
  readonly intent: MessageActuationIntent;
  readonly invocation: {
    /** MUST equal intent.commandRef for the existing 0.9.0 control seam. */
    readonly invocationId: string;
    readonly correlationId: string;
    readonly idempotencyKey: string;
    readonly authorizationEvidenceRef?: string;
    readonly custodyToken?: string;
  };
}

export type DeliveryActuationRefusalReason =
  | RegistrationFailureReason
  | 'unverified_invocation_context'
  | 'instruction_resolution_failed'
  | 'invalid_handoff'
  | 'authorization_unavailable';

export type DeliveryActuationHandoffResult =
  | {
      readonly kind: 'result';
      readonly deliveryId: DeliveryId;
      readonly commandRef: string;
      readonly result: ActuationResult;
    }
  | {
      readonly kind: 'refused';
      readonly deliveryId: DeliveryId;
      readonly commandRef: string;
      readonly actuationAttempted: false;
      readonly reason: DeliveryActuationRefusalReason;
    }
  | {
      readonly kind: 'uncertain';
      readonly deliveryId: DeliveryId;
      readonly commandRef: string;
      readonly actuationAttempted: 'unknown';
      readonly reason: 'actuation_failed' | 'handoff_unavailable';
      readonly effectRef?: string;
    };

export interface DeliveryActuationHandoffPort {
  handoff(input: DeliveryActuationHandoffRequest): Promise<DeliveryActuationHandoffResult>;
}
