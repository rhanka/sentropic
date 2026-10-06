import * as mesh from '@sentropic/llm-mesh';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../../src/app';
import { queueManager } from '../../src/services/queue-manager';
import { settingsService } from '../../src/services/settings';
import { authenticatedRequest, cleanupAuthData, createAuthenticatedUser } from '../utils/auth-helper';

let user: Awaited<ReturnType<typeof createAuthenticatedUser>>;

beforeEach(async () => {
  user = await createAuthenticatedUser('admin_app');
  vi.spyOn(queueManager, 'reloadSettings').mockResolvedValue();
  const original = mesh.getProviderProfile;
  vi.spyOn(mesh, 'getProviderProfile').mockImplementation((id) => (
    id === 'muse' ? { ...original(id), judgeOnly: true } : original(id)
  ));
});
afterEach(async () => {
  vi.restoreAllMocks();
  await cleanupAuthData();
});

describe('judge-only chat settings', () => {
  it('recovers a stored global judge-only default through the generic admin route', async () => {
    const ordinary = await settingsService.getAISettings();
    let provider = 'typesafe';
    vi.spyOn(settingsService, 'getAISettings').mockImplementation(async () => ({
      ...ordinary, defaultProviderId: provider,
    }));
    const write = vi.spyOn(settingsService, 'set').mockImplementation(async (key, value, _description, scope) => {
      expect(scope).toBeUndefined();
      if (key === 'default_provider_id') provider = value;
    });
    const refused = await authenticatedRequest(app, 'GET', '/api/v1/models/catalog', user.sessionToken!);
    expect(refused.status).toBe(500);
    const repair = await authenticatedRequest(app, 'PUT', '/api/v1/ai-settings/default_provider_id',
      user.sessionToken!, { value: 'openai' });
    expect(repair.status).toBe(200);
    expect(write).toHaveBeenCalledWith('default_provider_id', 'openai', undefined);
    const catalog = await authenticatedRequest(app, 'GET', '/api/v1/models/catalog', user.sessionToken!);
    expect(catalog.status).toBe(200);
    expect(await catalog.json()).toMatchObject({ defaults: { provider_id: 'openai' } });
  });

  it.each(['muse', 'typesafe', 'unknown-provider'])(
    'refuses generic product default writes without storing or reloading (%s)', async (value) => {
      const write = vi.spyOn(settingsService, 'set').mockResolvedValue();
      const response = await authenticatedRequest(app, 'PUT', '/api/v1/ai-settings/default_provider_id',
        user.sessionToken!, { value });
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ message: 'Invalid provider id' });
      expect(write).not.toHaveBeenCalled();
      expect(queueManager.reloadSettings).not.toHaveBeenCalled();
    });

  it('preserves the product structured-setting closed-enum refusal', async () => {
    const write = vi.spyOn(settingsService, 'updateAISettings').mockResolvedValue();
    const response = await authenticatedRequest(app, 'PUT', '/api/v1/ai-settings',
      user.sessionToken!, { defaultProviderId: 'typesafe' });
    expect(response.status).toBe(400);
    expect(write).not.toHaveBeenCalled();
    expect(queueManager.reloadSettings).not.toHaveBeenCalled();
  });

  it('preserves the existing user-setting closed-enum refusal', async () => {
    const write = vi.spyOn(settingsService, 'set').mockResolvedValue();
    const response = await authenticatedRequest(app, 'PUT', '/api/v1/me/ai-settings',
      user.sessionToken!, { defaultProviderId: 'typesafe' });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ message: 'Invalid AI settings request' });
    expect(write).not.toHaveBeenCalled();
  });

  it.each(['openai', 'local'])('retains ordinary generic product default writes (%s)', async (value) => {
    const write = vi.spyOn(settingsService, 'set').mockResolvedValue();
    const response = await authenticatedRequest(app, 'PUT', '/api/v1/ai-settings/default_provider_id',
      user.sessionToken!, { value });
    expect(response.status).toBe(200);
    expect(write).toHaveBeenCalledWith('default_provider_id', value, undefined);
    expect(queueManager.reloadSettings).toHaveBeenCalledOnce();
  });
});
