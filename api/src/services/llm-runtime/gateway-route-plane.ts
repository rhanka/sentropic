import {
  type PlannedRouteTarget,
  type PreparedRouteAttempt,
  type RoutePlan,
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

export interface GatewayRouteIntentEvidence {
  readonly requestedModel: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly transportProviderId: string;
  readonly requiredCapabilities: readonly unknown[];
}

export interface GatewayShadowRouteIntentInput {
  readonly cost: CostContext;
  readonly subject: VerifiedRoutingSubject;
  readonly canonical: CanonicalIngressResult;
  readonly route: RoutePlanInput;
}

const policy = {
  strategy: { kind: 'last-enrolled' as const },
  rules: [],
  fallbackMode: 'retest-preferred' as const,
  negativeCacheTtlMs: 300_000,
  maxAttempts: 1,
  preferSameTransport: true,
  stickyAccount: true,
  rotateEquivalentAccounts: false,
  allowEquivalentModels: true,
};

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

const subjectKey = (subject: VerifiedRoutingSubject, input: RoutePlanInput): string =>
  [subject.principalRef, subject.ownerScopeRef, input.affinityKey ?? '', input.requestedModel].join('\u001f');

export const createApplicationGatewayRoutePlane = (options?: {
  readonly dispatch?: GatewayRuntimeDispatchPort;
  readonly observeShadow?: (evidence: GatewayRouteIntentEvidence) => void;
}): {
  readonly planner: RoutePlanner;
  readonly shadowRouteIntent: (input: GatewayShadowRouteIntentInput) => Promise<void>;
} => {
  const dispatch = options?.dispatch ?? applicationGatewayRuntime;
  const shadowTargets = new Map<string, PlannedRouteTarget>();
  const plans = new Map<string, {
    subject: VerifiedRoutingSubject;
    workspaceId?: string;
    target: PlannedRouteTarget;
    candidateRef: string;
  }>();
  let sequence = 0;

  const shadowRouteIntent = async (input: GatewayShadowRouteIntentInput): Promise<void> => {
    const target = await resolveTarget(input.subject, input.route.requestedModel);
    shadowTargets.set(subjectKey(input.subject, input.route), target);
    options?.observeShadow?.({
      requestedModel: input.route.requestedModel,
      providerId: target.providerId,
      modelId: target.modelId,
      transportProviderId: target.transportProviderId,
      requiredCapabilities: [...(input.route.requiredCapabilities ?? [])].sort((left, right) =>
        JSON.stringify(left).localeCompare(JSON.stringify(right))),
    });
  };

  const planner: RoutePlanner = {
    async listModels() {
      return providerRegistry.listModels().map((model) => ({
        modelId: model.modelId, providerId: model.providerId,
      }));
    },
    async plan(subject, input): Promise<RoutePlan> {
      const key = subjectKey(subject, input);
      let target = shadowTargets.get(key);
      if (!target) {
        target = await resolveTarget(subject, input.requestedModel);
        options?.observeShadow?.({
          requestedModel: input.requestedModel,
          providerId: target.providerId,
          modelId: target.modelId,
          transportProviderId: target.transportProviderId,
          requiredCapabilities: [...(input.requiredCapabilities ?? [])].sort((left, right) =>
            JSON.stringify(left).localeCompare(JSON.stringify(right))),
        });
      }
      shadowTargets.delete(key);
      sequence += 1;
      const planRef = `application-gateway-plan-${sequence}`;
      const candidateRef = `application-gateway-candidate-${sequence}`;
      plans.set(planRef, {
        subject, ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
        target, candidateRef,
      });
      return {
        planRef,
        expiresAt: new Date(Date.now() + 30_000).toISOString(),
        candidateRefs: [candidateRef], policy, councilRevision: 'application-runtime-v1',
        diagnostics: [{
          candidateRef, diagnosticAccountRef: 'provider-owned',
          requestedModel: input.requestedModel,
          actualProviderId: target.providerId,
          actualModelId: target.modelId,
          actualTransportProviderId: target.transportProviderId,
          reason: target.reason, cacheContinuityRisk: false,
        }],
      };
    },
    async prepareAttempt(subject, planRef, candidateRef): Promise<PreparedRouteAttempt> {
      const planned = plans.get(planRef);
      if (!planned || planned.candidateRef !== candidateRef
        || planned.subject.principalRef !== subject.principalRef
        || planned.subject.ownerScopeRef !== subject.ownerScopeRef) {
        throw new Error('gateway route plan does not belong to the caller');
      }
      return {
        attemptRef: `${candidateRef}:attempt`,
        generate: (request) => dispatch.generate(subject, planned.workspaceId, planned.target, request),
        stream: (request) => dispatch.stream(subject, planned.workspaceId, planned.target, request),
        async recordOutcome() { plans.delete(planRef); },
        async markCommitted() {},
        async complete() { plans.delete(planRef); },
        async releaseCancelled() { plans.delete(planRef); },
      };
    },
    describeAffinity() { return null; },
    promoteAffinity() { throw new Error('application gateway affinity promotion is unsupported'); },
    rebindAffinity() { throw new Error('application gateway affinity rebinding is unsupported'); },
    resetAffinity() { return false; },
  };

  return { planner, shadowRouteIntent };
};
