import { describe, expect, it, vi } from 'vitest';

import { normalizeGatewayIngress } from '../../../packages/llm-gateway/src/index';
import { createApplicationGatewayRoutePlane } from '../../src/services/llm-runtime/gateway-route-plane';
import { createApiMeshContractProof } from '../../src/services/llm-runtime/mesh-contract-proof';
import { providerRegistry } from '../../src/services/provider-registry';

describe('API LLM mesh contract proof', () => {
  it('loads the package mesh contract from the API runtime boundary', () => {
    const proof = createApiMeshContractProof();

    expect(proof.providers).toEqual(
      expect.arrayContaining(['openai', 'gemini', 'anthropic', 'mistral', 'cohere', 'gcp', 'local']),
    );
    expect(proof.providers).toHaveLength(7);
    expect(proof.modelCount).toBeGreaterThanOrEqual(10);
    expect(proof.mesh.listModels().some((model) => model.modelId === 'gpt-5.5')).toBe(true);
  });

  it('keeps package model profiles aligned with the application runtime catalog', () => {
    const proof = createApiMeshContractProof();
    const meshModels = new Map(
      proof.mesh
        .listModels()
        .map((model) => [`${model.providerId}:${model.modelId}`, model]),
    );

    for (const runtimeModel of providerRegistry.listModels()) {
      const key = `${runtimeModel.providerId}:${runtimeModel.modelId}`;
      const meshModel = meshModels.get(key);

      expect(meshModel, key).toBeDefined();
      expect(meshModel?.label).toBe(runtimeModel.label);
      expect(meshModel?.reasoningTier).toBe(runtimeModel.reasoningTier);
      if (runtimeModel.supportsTools) {
        expect(meshModel?.capabilities.tools.support).not.toBe('unsupported');
      }
      if (runtimeModel.supportsStreaming) {
        expect(meshModel?.capabilities.streaming.support).not.toBe('unsupported');
      }
      if (runtimeModel.reasoningTier !== 'none') {
        expect(meshModel?.capabilities.reasoning.support).not.toBe('unsupported');
      }
    }
  });

  it('shadows route intent without duplicating the current provider egress', async () => {
    const generate = vi.fn().mockResolvedValue({
      id: 'response-1', providerId: 'openai', modelId: 'gpt-5.6-terra',
      message: { role: 'assistant', content: 'ok' }, text: 'ok', toolCalls: [],
      finishReason: 'stop',
    });
    const stream = vi.fn();
    const shadows: unknown[] = [];
    const plane = createApplicationGatewayRoutePlane({
      dispatch: { generate, stream },
      observeShadow: (evidence) => shadows.push(evidence),
    });
    const subject = { principalRef: 'user-1', ownerScopeRef: 'workspace-1:user-1' };
    const route = {
      requestedModel: 'gpt-5.6-terra', requiredCapabilities: [],
      workspaceId: 'workspace-1', affinityKey: 'request-1',
    };
    const canonical = normalizeGatewayIngress('openai-chat-completions', {
      model: 'gpt-5.6-terra', messages: [{ role: 'user', content: 'hello' }],
    });

    await plane.shadowRouteIntent({
      cost: {
        tenantId: 'tenant-1', workspaceId: 'workspace-1', principalId: 'user-1',
        source: 'test', correlationId: 'request-1',
      },
      subject, canonical, route,
    });
    const plan = await plane.planner.plan(subject, route);
    const attempt = await plane.planner.prepareAttempt(
      subject, plan.planRef, plan.candidateRefs[0]!, 'request-1', 0,
    );
    await attempt.generate(canonical.request);

    expect(shadows).toEqual([{
      requestedModel: 'gpt-5.6-terra', providerId: 'openai',
      modelId: 'gpt-5.6-terra', transportProviderId: 'application-runtime',
      requiredCapabilities: [],
    }]);
    expect(generate).toHaveBeenCalledOnce();
    expect(stream).not.toHaveBeenCalled();
    expect(plan.diagnostics[0]?.diagnosticAccountRef).toBe('provider-owned');
    expect(JSON.stringify(plan)).not.toContain('credential');
  });
});
