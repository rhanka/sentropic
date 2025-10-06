import { Hono } from 'hono';
import { z } from 'zod';
import { settingsService } from '../../services/settings';
import { queueManager } from '../../services/queue-manager';

const aiSettingsRouter = new Hono();

// GET /ai-settings - Récupérer les paramètres IA
aiSettingsRouter.get('/', async (c) => {
  try {
    const settings = await settingsService.getAISettings();
    return c.json(settings);
  } catch (error) {
    console.error('Error fetching AI settings:', error);
    return c.json({ message: 'Failed to fetch AI settings' }, 500);
  }
});

// PUT /ai-settings - Mettre à jour les paramètres IA
const updateAISettingsSchema = z.object({
  concurrency: z.number().min(1).max(50).optional(),
  defaultModel: z.string().min(1).optional(),
  processingInterval: z.number().min(1000).max(60000).optional(),
});

aiSettingsRouter.put('/', async (c) => {
  try {
    const body = await c.req.json();
    const validatedData = updateAISettingsSchema.parse(body);

    // Mettre à jour les paramètres
    await settingsService.updateAISettings(validatedData);

    // Recharger les paramètres dans le queue manager
    await queueManager.reloadSettings();

    // Retourner les nouveaux paramètres
    const updatedSettings = await settingsService.getAISettings();
    
    return c.json({
      success: true,
      message: 'AI settings updated successfully',
      settings: updatedSettings
    });
  } catch (error) {
    console.error('Error updating AI settings:', error);
    if (error instanceof z.ZodError) {
      return c.json({ 
        message: 'Validation error', 
        errors: error.errors 
      }, 400);
    }
    return c.json({ message: 'Failed to update AI settings' }, 500);
  }
});

// GET /ai-settings/all - Récupérer tous les paramètres
aiSettingsRouter.get('/all', async (c) => {
  try {
    const settings = await settingsService.getAll();
    return c.json(settings);
  } catch (error) {
    console.error('Error fetching all settings:', error);
    return c.json({ message: 'Failed to fetch settings' }, 500);
  }
});

// GET /ai-settings/:key - Récupérer un paramètre spécifique
aiSettingsRouter.get('/:key', async (c) => {
  try {
    const key = c.req.param('key');
    const value = await settingsService.get(key);
    
    if (value === null) {
      return c.json({ message: 'Setting not found' }, 404);
    }
    
    return c.json({ key, value });
  } catch (error) {
    console.error('Error fetching setting:', error);
    return c.json({ message: 'Failed to fetch setting' }, 500);
  }
});

// PUT /ai-settings/:key - Mettre à jour un paramètre spécifique
aiSettingsRouter.put('/:key', async (c) => {
  try {
    const key = c.req.param('key');
    const body = await c.req.json();
    const { value, description } = body;

    if (!value) {
      return c.json({ message: 'Value is required' }, 400);
    }

    await settingsService.set(key, value, description);

    // Recharger les paramètres si c'est un paramètre IA
    if (['ai_concurrency', 'default_model', 'queue_processing_interval'].includes(key)) {
      await queueManager.reloadSettings();
    }

    return c.json({
      success: true,
      message: 'Setting updated successfully',
      key,
      value
    });
  } catch (error) {
    console.error('Error updating setting:', error);
    return c.json({ message: 'Failed to update setting' }, 500);
  }
});

export default aiSettingsRouter;
