import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { db } from '../../db/client';
import { sql } from 'drizzle-orm';

const settingsSchema = z.object({
  openaiModels: z.record(z.string()).default({}),
  prompts: z.record(z.any()).default({}),
  generationLimits: z.record(z.any()).default({})
});

export const settingsRouter = new Hono();

settingsRouter.get('/', async (c) => {
  // Récupérer les paramètres depuis le système clé-valeur
  const openaiModelsRecord = await db.get(sql`SELECT value FROM settings WHERE key = 'openai_models' AND user_id IS NULL`) as { value: string } | undefined;
  const promptsRecord = await db.get(sql`SELECT value FROM settings WHERE key = 'prompts' AND user_id IS NULL`) as { value: string } | undefined;
  const generationLimitsRecord = await db.get(sql`SELECT value FROM settings WHERE key = 'generation_limits' AND user_id IS NULL`) as { value: string } | undefined;

  return c.json({
    openaiModels: openaiModelsRecord?.value ? JSON.parse(openaiModelsRecord.value) : {},
    prompts: promptsRecord?.value ? JSON.parse(promptsRecord.value) : {},
    generationLimits: generationLimitsRecord?.value ? JSON.parse(generationLimitsRecord.value) : {}
  });
});

settingsRouter.put('/', zValidator('json', settingsSchema), async (c) => {
  const payload = c.req.valid('json');
  
  // Mettre à jour les paramètres dans le système clé-valeur
  await db.run(sql`
    INSERT INTO settings (key, user_id, value, description, updated_at)
    VALUES ('openai_models', NULL, ${JSON.stringify(payload.openaiModels)}, 'Configured OpenAI models', ${new Date().toISOString()})
    ON CONFLICT (key) WHERE user_id IS NULL
    DO UPDATE SET
      value = EXCLUDED.value,
      description = EXCLUDED.description,
      updated_at = EXCLUDED.updated_at
  `);
  
  await db.run(sql`
    INSERT INTO settings (key, user_id, value, description, updated_at)
    VALUES ('prompts', NULL, ${JSON.stringify(payload.prompts)}, 'Configured prompts', ${new Date().toISOString()})
    ON CONFLICT (key) WHERE user_id IS NULL
    DO UPDATE SET
      value = EXCLUDED.value,
      description = EXCLUDED.description,
      updated_at = EXCLUDED.updated_at
  `);
  
  await db.run(sql`
    INSERT INTO settings (key, user_id, value, description, updated_at)
    VALUES ('generation_limits', NULL, ${JSON.stringify(payload.generationLimits)}, 'Generation limits', ${new Date().toISOString()})
    ON CONFLICT (key) WHERE user_id IS NULL
    DO UPDATE SET
      value = EXCLUDED.value,
      description = EXCLUDED.description,
      updated_at = EXCLUDED.updated_at
  `);

  return c.json(payload);
});
