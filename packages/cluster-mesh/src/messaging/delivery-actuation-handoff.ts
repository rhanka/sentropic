import type {
  VerifiedInvocationContextPort,
  VerifiedInvocationContextRequest,
} from '@sentropic/contracts';
import type {
  ActuationRequest,
  ActuationResult,
  CommandInstructionPort,
  RegistrationGate,
} from '../runtime/registration.js';
import { canonicalEqual } from './canonical-json.js';
import type {
  DeliveryActuationHandoffPort,
  DeliveryActuationHandoffRequest,
  DeliveryActuationHandoffResult,
  DeliveryActuationRefusalReason,
} from './handoff-contracts.js';
import { validIntent } from './validation.js';

export interface DeliveryActuationHandoffAdapterOptions {
  readonly generationId: string;
  readonly context: VerifiedInvocationContextPort;
  readonly registration: RegistrationGate;
  readonly instructions: CommandInstructionPort;
  readonly method?: string;
  readonly path?: string;
}

export class DeliveryActuationHandoffAdapter implements DeliveryActuationHandoffPort {
  constructor(private readonly options: DeliveryActuationHandoffAdapterOptions) {}

  async handoff(input: DeliveryActuationHandoffRequest): Promise<DeliveryActuationHandoffResult> {
    const { delivery, intent, invocation } = input;
    if (!validIntent(intent) || !validIntent(delivery.message.actuation)
      || !canonicalEqual(intent, delivery.message.actuation)
      || invocation.invocationId !== intent.commandRef) {
      return this.refused(input, 'invalid_handoff');
    }
    let context;
    try {
      const request: VerifiedInvocationContextRequest & { readonly custodyToken?: string } = {
        invocationId: invocation.invocationId,
        correlationId: invocation.correlationId,
        generationId: this.options.generationId,
        method: this.options.method ?? 'POST',
        path: this.options.path ?? '/cluster-mesh/messages/actuation',
        targetRegistrationId: intent.targetRegistrationId,
        idempotencyKey: invocation.idempotencyKey,
        receiptStages: ['transported', 'verified', 'acted'],
        ...(invocation.authorizationEvidenceRef === undefined ? {} : {
          authorizationEvidenceRef: invocation.authorizationEvidenceRef,
        }),
        ...(invocation.custodyToken === undefined ? {} : { custodyToken: invocation.custodyToken }),
      };
      context = await this.options.context.verify(request);
    } catch { return this.refused(input, 'unverified_invocation_context'); }
    if (context.invocationId !== intent.commandRef
      || context.correlationId !== invocation.correlationId
      || context.registration?.registrationId !== intent.targetRegistrationId) {
      return this.refused(input, 'invalid_handoff');
    }
    let decision;
    try {
      decision = await this.options.registration.authorize(context, intent.action);
    } catch { return this.refused(input, 'authorization_unavailable'); }
    if (!decision.ok) return this.refused(input, decision.reason);
    let resolvedInstruction;
    try {
      resolvedInstruction = await this.options.instructions.resolve({
        commandRef: intent.commandRef,
        registrationId: decision.registration.registrationId,
        action: intent.action,
      });
    } catch { return this.refused(input, 'instruction_resolution_failed'); }
    if (!resolvedInstruction) return this.refused(input, 'command_unresolved');
    try {
      const actuationRequest: ActuationRequest = decision.action === 'relaunch' ? {
        registration: decision.registration,
        action: decision.action,
        commandRef: intent.commandRef,
        resolvedInstruction,
        launchContext: decision.launchContext,
      } : {
        registration: decision.registration,
        action: decision.action,
        commandRef: intent.commandRef,
        resolvedInstruction,
      };
      const result = await decision.actuator.actuate(actuationRequest);
      if (!this.validResult(result)) return this.uncertain(input, 'actuation_failed');
      return { kind: 'result', deliveryId: delivery.deliveryId,
        commandRef: intent.commandRef, result };
    } catch { return this.uncertain(input, 'actuation_failed'); }
  }

  private refused(
    input: DeliveryActuationHandoffRequest,
    reason: DeliveryActuationRefusalReason,
  ): DeliveryActuationHandoffResult {
    return { kind: 'refused', deliveryId: input.delivery.deliveryId,
      commandRef: input.intent.commandRef, actuationAttempted: false, reason };
  }

  private uncertain(
    input: DeliveryActuationHandoffRequest,
    reason: 'actuation_failed' | 'handoff_unavailable',
  ): DeliveryActuationHandoffResult {
    return { kind: 'uncertain', deliveryId: input.delivery.deliveryId,
      commandRef: input.intent.commandRef, actuationAttempted: 'unknown', reason };
  }

  private validResult(value: ActuationResult): boolean {
    return !!value && typeof value === 'object' && typeof value.effectRef === 'string'
      && value.effectRef.length > 0
      && (value.outcome === 'acted' || value.outcome === 'deferred' || value.outcome === 'failed')
      && (value.actedTargets === undefined
        || (Array.isArray(value.actedTargets)
          && value.actedTargets.every((target) => typeof target === 'string' && target.length > 0)));
  }
}
