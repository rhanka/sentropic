import { describe, expect, it } from 'vitest';

import { createApiMeshContractProof } from '../../src/services/llm-runtime/mesh-contract-proof';
import { providerRegistry } from '../../src/services/provider-registry';

describe('API LLM mesh contract proof', () => {
  it('loads the package mesh contract from the API runtime boundary', () => {
    const proof = createApiMeshContractProof();

    expect(proof.providers).toEqual(
      expect.arrayContaining(['openai', 'gemini', 'anthropic', 'mistral', 'cohere']),
    );
    expect(proof.providers).toHaveLength(5);
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

  it('tracks image-generation status across supported and unsupported providers', () => {
    const proof = createApiMeshContractProof();
    const models = new Map(
      proof.mesh
        .listModels()
        .map((model) => [`${model.providerId}:${model.modelId}`, model]),
    );

    const openaiImage = models.get('openai:gpt-image-2');
    const geminiImage = models.get('gemini:gemini-3.1-flash-image-preview');
    const anthropicText = models.get('anthropic:claude-opus-4-7');
    const mistralPlanned = models.get('mistral:mistral-large-latest');

    expect(openaiImage?.capabilities.imageGeneration.status).toBe('supported');
    expect(geminiImage?.capabilities.imageGeneration.status).toBe('supported');
    expect(anthropicText?.capabilities.imageGeneration.status).toBe('unsupported');
    expect(mistralPlanned?.capabilities.imageGeneration.status).toBe('planned');
  });
});
