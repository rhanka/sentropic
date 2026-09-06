import { Hono } from 'hono';
import { z } from 'zod';

import { getModelCatalogPayload, resolveDefaultSelection } from '../../services/model-catalog';
import { isProviderId } from '../../services/provider-runtime';
import { queueManager } from '../../services/queue-manager';
import { settingsService } from '../../services/settings';

const updateAISettingsSchema = z.object({
  concurrency: z.number().min(1).max(50).optional(),
  publishingConcurrency: z.number().min(1).max(50).optional(),
  defaultProviderId: z.enum([
    'openai', 'gemini', 'anthropic', 'mistral', 'cohere', 'gcp', 'local',
  ]).optional(),
  defaultModel: z.string().min(1).optional(),
  processingInterval: z.number().min(1000).max(60000).optional(),
});

export const createProductAISettingsRouter = (): Hono => {
  const router = new Hono();

  router.get('/', async (context) => {
    try {
      return context.json(await settingsService.getAISettings());
    } catch (error) {
      console.error('Error fetching AI settings:', error);
      return context.json({ message: 'Failed to fetch AI settings' }, 500);
    }
  });

  router.put('/', async (context) => {
    try {
      const validatedData = updateAISettingsSchema.parse(await context.req.json());
      const updates: Parameters<typeof settingsService.updateAISettings>[0] = {
        ...validatedData,
      };
      if (validatedData.defaultProviderId !== undefined
        || validatedData.defaultModel !== undefined) {
        const [currentSettings, catalog] = await Promise.all([
          settingsService.getAISettings(),
          getModelCatalogPayload(),
        ]);
        const resolved = resolveDefaultSelection({
          providerId: validatedData.defaultProviderId ?? currentSettings.defaultProviderId,
          modelId: validatedData.defaultModel ?? currentSettings.defaultModel,
        }, catalog.models);
        updates.defaultProviderId = resolved.provider_id;
        updates.defaultModel = resolved.model_id;
      }
      await settingsService.updateAISettings(updates);
      await queueManager.reloadSettings();
      return context.json({
        success: true,
        message: 'AI settings updated successfully',
        settings: await settingsService.getAISettings(),
      });
    } catch (error) {
      console.error('Error updating AI settings:', error);
      if (error instanceof z.ZodError) {
        return context.json({ message: 'Validation error', errors: error.errors }, 400);
      }
      return context.json({ message: 'Failed to update AI settings' }, 500);
    }
  });

  router.get('/all', async (context) => {
    try {
      return context.json(await settingsService.getAll());
    } catch (error) {
      console.error('Error fetching all settings:', error);
      return context.json({ message: 'Failed to fetch settings' }, 500);
    }
  });

  router.get('/:key', async (context) => {
    try {
      const key = context.req.param('key');
      const value = await settingsService.get(key);
      if (value === null) return context.json({ message: 'Setting not found' }, 404);
      return context.json({ key, value });
    } catch (error) {
      console.error('Error fetching setting:', error);
      return context.json({ message: 'Failed to fetch setting' }, 500);
    }
  });

  router.put('/:key', async (context) => {
    try {
      const key = context.req.param('key');
      const { value, description } = await context.req.json();
      if (!value) return context.json({ message: 'Value is required' }, 400);
      if (key === 'default_provider_id'
        && (typeof value !== 'string' || !isProviderId(value))) {
        return context.json({ message: 'Invalid provider id' }, 400);
      }
      await settingsService.set(key, value, description);
      if ([
        'ai_concurrency',
        'publishing_concurrency',
        'default_provider_id',
        'default_model',
        'queue_processing_interval',
      ].includes(key)) {
        await queueManager.reloadSettings();
      }
      return context.json({
        success: true,
        message: 'Setting updated successfully',
        key,
        value,
      });
    } catch (error) {
      console.error('Error updating setting:', error);
      return context.json({ message: 'Failed to update setting' }, 500);
    }
  });

  return router;
};
