import type { LlmMeshRouterInput } from '@sentropic/cluster-mesh/compose/llm-mesh';
import type { CostContext } from '@sentropic/llm-gateway';
import { db } from '../db/client';
import { env } from '../config/env';
import type { AuthUser } from '../middleware/auth';
import { createLlmIdentityDirectory } from './llm-identity/directory';
import { ownerScopeRefFor } from './llm-identity/caller-auth';
import { requireWorkspaceAdmin, requireWorkspaceEditor } from './workspace-access';
import { createDecisionMetering } from './llm-metering/decision';
import { createDecisionAuth, createDecisionHost, decisionDescriptors, type DecisionExecutionProfile } from './decision-host';
import type { JevTransport } from '@sentropic/llm-mesh/transport/jev';

const resolveCaller = async (user: AuthUser, profile: DecisionExecutionProfile): Promise<CostContext | undefined> => {
  const grants = await createLlmIdentityDirectory().listUserWorkspaceGrants(user.userId);
  const grant = grants.find((entry) => entry.workspaceId === user.workspaceId && !entry.workspaceHidden
    && entry.tenantStatus === 'active' && entry.tenantMembershipStatus === 'approved');
  if (!grant || (profile === 'qualification' && user.role !== 'admin_app')) return undefined;
  try {
    await (profile === 'qualification' ? requireWorkspaceAdmin : requireWorkspaceEditor)(user.userId, user.workspaceId);
  } catch { return undefined; }
  return { tenantId: grant.workspaceTenantId, principalId: user.userId, workspaceId: grant.workspaceId,
    ownerScopeRef: ownerScopeRefFor(grant.workspaceId, user.userId), source: 'product-api:decision', correlationId: crypto.randomUUID() };
};

export const createDecisionRuntime = (input: LlmMeshRouterInput, jev: JevTransport, profile: DecisionExecutionProfile) => {
  const host = input.decisionHost;
  if (!host) throw new Error('Decision host unavailable');
  const descriptors = decisionDescriptors(host, profile);
  return async (user: AuthUser) => {
    const cost = await resolveCaller(user, profile);
    if (!cost) return undefined;
    const metering = createDecisionMetering(db, cost, descriptors);
    const environment = { OPENAI_API_KEY: env.OPENAI_API_KEY, JEV_API_KEY: process.env.JEV_API_KEY };
    const resolveAuth = createDecisionAuth(environment);
    const client = createDecisionHost({ host, mesh: input.llmMesh, jev, fetch: globalThis.fetch, profile, descriptors,
      ports: { ...metering, resolveAuth, authorize: async () => {
        const current = await resolveCaller(user, profile);
        return !!current && current.tenantId === cost.tenantId && current.workspaceId === cost.workspaceId;
      } } });
    return { client, async readiness() {
      const evaluators = await Promise.all(descriptors.map(async (descriptor) => {
        const storeReady = await metering.probe(descriptor.evaluator);
        const auth = await resolveAuth({ providerId: descriptor.evaluator.providerId });
        const price = await metering.resolvePrice({ providerId: descriptor.evaluator.providerId, modelId: descriptor.wireModel,
          protocol: descriptor.protocol ?? 'jev-native', authority: descriptor.priceProtocol.authority,
          priceRevision: descriptor.priceProtocol.revision });
        return { ...host.discoverDecisionEvaluator(descriptor), productionReady: false,
          availability: profile === 'qualification' && storeReady && auth.material.type === 'environment-token' && !!price
            ? 'available' : 'unavailable' };
      }));
      return { profile, productionReady: false, evaluators };
    } };
  };
};
