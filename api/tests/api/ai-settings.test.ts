import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { app } from '../../src/app';
import { authenticatedRequest, createAuthenticatedUser, cleanupAuthData } from '../utils/auth-helper';
import { queueManager } from '../../src/services/queue-manager';
import { settingsService } from '../../src/services/settings';

describe('AI Settings API', () => {
  let user: any;

  beforeEach(async () => {
    user = await createAuthenticatedUser('admin_app');
  });

  afterEach(async () => {
    await cleanupAuthData();
  });

  describe('GET /ai-settings', () => {
    it('should get AI settings', async () => {
      const response = await authenticatedRequest(app, 'GET', '/api/v1/ai-settings', user.sessionToken!);
      
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toBeDefined();
    });
  });

  describe('GET /ai-settings/all', () => {
    it('should get all AI settings', async () => {
      const response = await authenticatedRequest(app, 'GET', '/api/v1/ai-settings/all', user.sessionToken!);
      
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(Array.isArray(data)).toBe(true);
    });
  });

  describe('GET /ai-settings/:key', () => {
    it('should get specific AI setting', async () => {
      const response = await authenticatedRequest(app, 'GET', '/api/v1/ai-settings/default_model', user.sessionToken!);
      
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toBeDefined();
    });
  });

  describe('PUT /ai-settings', () => {
    it('updates publishingConcurrency and reloads queue settings', async () => {
      const updateSpy = vi.spyOn(settingsService, 'updateAISettings').mockResolvedValue();
      const reloadSpy = vi.spyOn(queueManager, 'reloadSettings').mockResolvedValue();
      const getSpy = vi.spyOn(settingsService, 'getAISettings').mockResolvedValue({
        concurrency: 9,
        publishingConcurrency: 7,
        defaultProviderId: 'openai',
        defaultModel: 'gpt-4.1-mini',
        processingInterval: 1500,
      });

      try {
        const response = await authenticatedRequest(app, 'PUT', '/api/v1/ai-settings', user.sessionToken!, {
          publishingConcurrency: 7,
        });

        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data.success).toBe(true);
        expect(data.settings.publishingConcurrency).toBe(7);
        expect(updateSpy).toHaveBeenCalledWith({ publishingConcurrency: 7 });
        expect(reloadSpy).toHaveBeenCalledTimes(1);
      } finally {
        updateSpy.mockRestore();
        reloadSpy.mockRestore();
        getSpy.mockRestore();
      }
    });
  });

  describe('PUT /ai-settings/:key', () => {
    it('updates publishing_concurrency and reloads queue settings', async () => {
      const setSpy = vi.spyOn(settingsService, 'set').mockResolvedValue();
      const reloadSpy = vi.spyOn(queueManager, 'reloadSettings').mockResolvedValue();

      try {
        const response = await authenticatedRequest(
          app,
          'PUT',
          '/api/v1/ai-settings/publishing_concurrency',
          user.sessionToken!,
          { value: '6' }
        );

        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data.success).toBe(true);
        expect(setSpy).toHaveBeenCalledWith('publishing_concurrency', '6', undefined);
        expect(reloadSpy).toHaveBeenCalledTimes(1);
      } finally {
        setSpy.mockRestore();
        reloadSpy.mockRestore();
      }
    });

    it('rejects invalid default_provider_id', async () => {
      const response = await authenticatedRequest(
        app,
        'PUT',
        '/api/v1/ai-settings/default_provider_id',
        user.sessionToken!,
        { value: 'invalid-provider' }
      );

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.message).toContain('Invalid provider id');
    });

    it('does not reload queue settings for non-queue keys', async () => {
      const setSpy = vi.spyOn(settingsService, 'set').mockResolvedValue();
      const reloadSpy = vi.spyOn(queueManager, 'reloadSettings').mockResolvedValue();

      try {
        const response = await authenticatedRequest(
          app,
          'PUT',
          '/api/v1/ai-settings/custom_key',
          user.sessionToken!,
          { value: 'custom-value' }
        );

        expect(response.status).toBe(200);
        expect(setSpy).toHaveBeenCalledWith('custom_key', 'custom-value', undefined);
        expect(reloadSpy).not.toHaveBeenCalled();
      } finally {
        setSpy.mockRestore();
        reloadSpy.mockRestore();
      }
    });
  });
});
