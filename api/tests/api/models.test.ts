import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../src/app';
import {
  authenticatedRequest,
  cleanupAuthData,
  createAuthenticatedUser,
} from '../utils/auth-helper';

describe('Models API', () => {
  let user: Awaited<ReturnType<typeof createAuthenticatedUser>>;

  beforeEach(async () => {
    user = await createAuthenticatedUser('editor');
  });

  afterEach(async () => {
    await cleanupAuthData();
  });

  it('returns provider catalog with provider/model pairs', async () => {
    const response = await authenticatedRequest(
      app,
      'GET',
      '/api/v1/models/catalog',
      user.sessionToken!
    );

    expect(response.status).toBe(200);
    const data = await response.json();

    expect(Array.isArray(data.providers)).toBe(true);
    expect(Array.isArray(data.models)).toBe(true);

    const providerIds = data.providers.map((provider: { provider_id: string }) => provider.provider_id);
    expect(providerIds).toContain('openai');
    expect(providerIds).toContain('gemini');
    expect(providerIds).toContain('anthropic');
    expect(providerIds).toContain('mistral');
    expect(providerIds).toContain('cohere');

    const modelsByProvider = (pid: string) =>
      data.models
        .filter((m: { provider_id: string }) => m.provider_id === pid)
        .map((m: { model_id: string }) => m.model_id)
        .sort();

    expect(modelsByProvider('openai')).toEqual(['gpt-4.1-nano', 'gpt-5.4']);
    expect(modelsByProvider('gemini')).toEqual(['gemini-3.1-flash-lite', 'gemini-3.1-pro-preview-customtools']);
    expect(modelsByProvider('anthropic')).toEqual(['claude-opus-4-6', 'claude-sonnet-4-6']);
    expect(modelsByProvider('mistral')).toEqual(['devstral-small-2505', 'mistral-large-2502']);
    expect(modelsByProvider('cohere')).toEqual(['command-a-03-2025', 'command-a-reasoning-03-2025', 'embed-v4.0', 'rerank-v3.5']);
    expect(data.models).toHaveLength(12);

    expect(data.defaults).toBeDefined();
    expect(typeof data.defaults.provider_id).toBe('string');
    expect(typeof data.defaults.model_id).toBe('string');

    const hasDefaultPair = data.models.some(
      (model: { provider_id: string; model_id: string }) =>
        model.provider_id === data.defaults.provider_id &&
        model.model_id === data.defaults.model_id
    );

    expect(hasDefaultPair).toBe(true);
  });

  it('migrates legacy Gemini defaults when user overrides with the old light model id', async () => {
    const updateResponse = await authenticatedRequest(
      app,
      'PUT',
      '/api/v1/me/ai-settings',
      user.sessionToken!,
      { defaultModel: 'gemini-2.5-flash-lite' }
    );
    expect(updateResponse.status).toBe(200);

    const response = await authenticatedRequest(
      app,
      'GET',
      '/api/v1/models/catalog',
      user.sessionToken!
    );

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.defaults.provider_id).toBe('gemini');
    expect(data.defaults.model_id).toBe('gemini-3.1-flash-lite');
  });

  it('migrates legacy OpenAI defaults when user overrides with gpt-5.2', async () => {
    const updateResponse = await authenticatedRequest(
      app,
      'PUT',
      '/api/v1/me/ai-settings',
      user.sessionToken!,
      { defaultModel: 'gpt-5.2' }
    );
    expect(updateResponse.status).toBe(200);

    const response = await authenticatedRequest(
      app,
      'GET',
      '/api/v1/models/catalog',
      user.sessionToken!
    );

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.defaults.provider_id).toBe('openai');
    expect(data.defaults.model_id).toBe('gpt-5.4');
  });
});
