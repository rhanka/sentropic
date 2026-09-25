import {
  type PlannedRouteTarget,
  type RoutePlanInput,
  type RoutePlanner,
  type VerifiedRoutingSubject,
} from '@sentropic/llm-mesh';
import type {
  CanonicalIngressResult,
  CostContext,
} from '../../../../packages/llm-gateway/src/index';

import { providerRegistry } from '../provider-registry';
import {
  applicationGatewayRuntime,
  type GatewayRuntimeDispatchPort,
} from './gateway-wire-adapter';
import { resolveRuntimeSelection } from './index';
import {
  createGatewayRoutePlane,
  type GatewayRouteIntentEvidence,
} from './standalone-ports';

export type { GatewayRouteIntentEvidence } from './standalone-ports';

export interface GatewayShadowRouteIntentInput {
  readonly cost: CostContext;
  readonly subject: VerifiedRoutingSubject;
  readonly canonical: CanonicalIngressResult;
  readonly route: RoutePlanInput;
}

const resolveTarget = async (
  subject: VerifiedRoutingSubject,
  requestedModel: string,
): Promise<PlannedRouteTarget> => {
  const selected = await resolveRuntimeSelection({
    model: requestedModel,
    userId: subject.principalRef,
  });
  return {
    requestedModel,
    providerId: selected.providerId,
    modelId: selected.model,
    transportProviderId: 'application-runtime',
    reason: selected.model === requestedModel ? 'exact' : 'alias',
  };
};

export const createApplicationGatewayRoutePlane = (options?: {
  readonly dispatch?: GatewayRuntimeDispatchPort;
  readonly observeShadow?: (evidence: GatewayRouteIntentEvidence) => void;
}): {
  readonly planner: RoutePlanner;
  readonly shadowRouteIntent: (input: GatewayShadowRouteIntentInput) => Promise<void>;
} => createGatewayRoutePlane({
  name: 'application',
  councilRevision: 'application-runtime-v1',
  targets: { resolve: resolveTarget },
  catalog: { listModels: () => providerRegistry.listModels() },
  dispatch: options?.dispatch ?? applicationGatewayRuntime,
  ...(options?.observeShadow ? { observeShadow: options.observeShadow } : {}),
});
