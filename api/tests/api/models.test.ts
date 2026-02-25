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

    const openaiModelIds = data.models
      .filter((model: { provider_id: string; model_id: string }) => model.provider_id === 'openai')
      .map((model: { model_id: string }) => model.model_id)
      .sort();

    const geminiModelIds = data.models
      .filter((model: { provider_id: string; model_id: string }) => model.provider_id === 'gemini')
      .map((model: { model_id: string }) => model.model_id)
      .sort();

    expect(openaiModelIds).toEqual(['gpt-4.1-nano', 'gpt-5.2']);
    expect(geminiModelIds).toEqual(['gemini-2.5-flash-lite', 'gemini-3.1-pro-preview-customtools']);
    expect(data.models).toHaveLength(4);

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

  it('returns user-scoped defaults when user overrides default model', async () => {
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
    expect(data.defaults.model_id).toBe('gemini-2.5-flash-lite');
  });
});
