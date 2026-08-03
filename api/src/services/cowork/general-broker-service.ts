import type { CoworkBrokerClosure, CoworkBrokerFactory, CoworkBrokerResult, CoworkTrustedInvocation } from '@sentropic/connector-host';

import {
  decideFoundationAuthority,
  quarantineModelInput,
  type HumanSelectedTarget,
  type ImmutableActionDescriptor,
} from './general-action-safety';

export type GeneralBrokerDependencies = Readonly<{
  descriptorFor(invocation: CoworkTrustedInvocation): ImmutableActionDescriptor;
  selectedTargetFor(invocation: CoworkTrustedInvocation): HumanSelectedTarget | null;
  nodeEnv?: string;
}>;

function invocationKey(invocation: CoworkTrustedInvocation): string {
  return [invocation.principalSub, invocation.tenantRef, invocation.workspaceRef, invocation.toolCallId].join(':');
}

function sameInvocation(left: CoworkTrustedInvocation, right: CoworkTrustedInvocation): boolean {
  return left.toolCallId === right.toolCallId
    && left.principalSub === right.principalSub
    && left.tenantRef === right.tenantRef
    && left.workspaceRef === right.workspaceRef
    && left.targetDeviceId === right.targetDeviceId
    && left.selectedBy === right.selectedBy;
}

/**
 * C1 registry: the factory, not the shared connector mount, owns closures.
 * A same logical call is idempotent; a conflicting reuse of its id is missing.
 */
export function createCoworkGeneralBrokerFactory(dependencies: GeneralBrokerDependencies): CoworkBrokerFactory {
  const closures = new Map<string, CoworkBrokerClosure>();

  return {
    async open(invocation): Promise<CoworkBrokerClosure | null> {
      const key = invocationKey(invocation);
      const existing = closures.get(key);
      if (existing) return sameInvocation(existing.invocation, invocation) ? existing : null;

      const closure: CoworkBrokerClosure = {
        invocation: Object.freeze({ ...invocation }),
        async invoke(assertedModelInput: unknown): Promise<CoworkBrokerResult> {
          // D2 quarantine is deliberately terminal here: no field from this
          // payload reaches descriptor, target, receipt, policy, or PEP checks.
          void quarantineModelInput(assertedModelInput);
          const decision = decideFoundationAuthority({
            descriptor: dependencies.descriptorFor(invocation),
            target: dependencies.selectedTargetFor(invocation),
            freshHumanReceiptId: null,
            signedPepDistributionVerified: false,
            nodeEnv: dependencies.nodeEnv ?? process.env.NODE_ENV,
          });
          return decision.outcome === 'DÉPOSÉ-EN-ATTENTE'
            ? { outcome: 'DÉPOSÉ-EN-ATTENTE', durableCallRef: `unreachable:${invocation.toolCallId}` }
            : { outcome: 'PAS-FAIT', reason: decision.reason };
        },
      };
      closures.set(key, closure);
      return closure;
    },
  };
}
