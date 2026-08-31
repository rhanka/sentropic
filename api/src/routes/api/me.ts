import { zValidator } from '@hono/zod-validator';
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import { db } from '../../db/client';
import { workspaces } from '../../db/schema';
import {
  getModelCatalogPayload,
  inferProviderFromModelIdWithLegacy,
  resolveDefaultSelection,
} from '../../services/model-catalog';
import { settingsService } from '../../services/settings';

export const meRouter = new Hono();

const patchMeSchema = z.object({
  workspaceName: z.string().min(1).max(128).optional(),
});

const patchMyAISettingsSchema = z
  .object({
    defaultProviderId: z.enum(['openai', 'gemini', 'anthropic', 'mistral', 'cohere', 'gcp', 'local']).optional(),
    defaultModel: z.string().min(1).optional(),
  })
  .refine(
    (value) => value.defaultProviderId !== undefined || value.defaultModel !== undefined,
    { message: 'At least one field is required' }
  );

meRouter.patch('/', zValidator('json', patchMeSchema), async (c) => {
  const { userId, workspaceId } = c.get('user');
  const { workspaceName } = c.req.valid('json');
  const [workspace] = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(and(eq(workspaces.id, workspaceId), eq(workspaces.ownerUserId, userId)))
    .limit(1);

  if (!workspace) return c.json({ error: 'Workspace not found' }, 404);

  await db
    .update(workspaces)
    .set({
      ...(workspaceName === undefined ? {} : { name: workspaceName }),
      updatedAt: new Date(),
    })
    .where(eq(workspaces.id, workspaceId));

  return c.json({ success: true });
});

meRouter.get('/ai-settings', async (c) => {
  const { userId } = c.get('user');
  const [currentSettings, catalog] = await Promise.all([
    settingsService.getAISettings({ userId }),
    getModelCatalogPayload({ userId }),
  ]);
  const resolved = resolveDefaultSelection(
    {
      providerId: currentSettings.defaultProviderId,
      modelId: currentSettings.defaultModel,
    },
    catalog.models
  );

  return c.json({
    defaultProviderId: resolved.provider_id,
    defaultModel: resolved.model_id,
  });
});

meRouter.put('/ai-settings', zValidator('json', patchMyAISettingsSchema), async (c) => {
  const { userId } = c.get('user');
  const body = c.req.valid('json');
  const [currentSettings, catalog] = await Promise.all([
    settingsService.getAISettings({ userId }),
    getModelCatalogPayload({ userId }),
  ]);
  const inferredProviderId = inferProviderFromModelIdWithLegacy(
    catalog.models,
    body.defaultModel ?? null
  );
  const resolved = resolveDefaultSelection(
    {
      providerId:
        body.defaultProviderId ?? inferredProviderId ?? currentSettings.defaultProviderId,
      modelId: body.defaultModel ?? currentSettings.defaultModel,
    },
    catalog.models
  );

  await Promise.all([
    settingsService.set('default_provider_id', resolved.provider_id, 'User default AI provider', {
      userId,
    }),
    settingsService.set('default_model', resolved.model_id, 'User default AI model', { userId }),
  ]);

  return c.json({
    success: true,
    settings: {
      defaultProviderId: resolved.provider_id,
      defaultModel: resolved.model_id,
    },
  });
});
