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
  const openaiModelsRecord = await db.get(sql`SELECT value FROM settings WHERE key = 'openai_models'`) as { value: string } | undefined;
  const promptsRecord = await db.get(sql`SELECT value FROM settings WHERE key = 'prompts'`) as { value: string } | undefined;
  const generationLimitsRecord = await db.get(sql`SELECT value FROM settings WHERE key = 'generation_limits'`) as { value: string } | undefined;

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
    INSERT OR REPLACE INTO settings (key, value, description, updated_at)
    VALUES ('openai_models', ${JSON.stringify(payload.openaiModels)}, 'Modèles OpenAI configurés', ${new Date().toISOString()})
  `);
  
  await db.run(sql`
    INSERT OR REPLACE INTO settings (key, value, description, updated_at)
    VALUES ('prompts', ${JSON.stringify(payload.prompts)}, 'Prompts configurés', ${new Date().toISOString()})
  `);
  
  await db.run(sql`
    INSERT OR REPLACE INTO settings (key, value, description, updated_at)
    VALUES ('generation_limits', ${JSON.stringify(payload.generationLimits)}, 'Limites de génération', ${new Date().toISOString()})
  `);

  return c.json(payload);
});
