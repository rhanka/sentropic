import { zValidator } from '@hono/zod-validator';
import { sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import { db } from '../../db/client';

const settingsSchema = z.object({
  openaiModels: z.record(z.string()).default({}),
  prompts: z.record(z.any()).default({}),
  generationLimits: z.record(z.any()).default({}),
});

export const createProductSettingsConfigRouter = (): Hono => {
  const router = new Hono();

  router.get('/', async (context) => {
    const openaiModelsRecord = await db.get(
      sql`SELECT value FROM settings WHERE key = 'openai_models' AND user_id IS NULL`,
    ) as { value: string } | undefined;
    const promptsRecord = await db.get(
      sql`SELECT value FROM settings WHERE key = 'prompts' AND user_id IS NULL`,
    ) as { value: string } | undefined;
    const generationLimitsRecord = await db.get(
      sql`SELECT value FROM settings WHERE key = 'generation_limits' AND user_id IS NULL`,
    ) as { value: string } | undefined;

    return context.json({
      openaiModels: openaiModelsRecord?.value ? JSON.parse(openaiModelsRecord.value) : {},
      prompts: promptsRecord?.value ? JSON.parse(promptsRecord.value) : {},
      generationLimits: generationLimitsRecord?.value
        ? JSON.parse(generationLimitsRecord.value)
        : {},
    });
  });

  router.put('/', zValidator('json', settingsSchema), async (context) => {
    const payload = context.req.valid('json');
    const updatedAt = new Date().toISOString();
    for (const [key, value, description] of [
      ['openai_models', payload.openaiModels, 'Configured OpenAI models'],
      ['prompts', payload.prompts, 'Configured prompts'],
      ['generation_limits', payload.generationLimits, 'Generation limits'],
    ] as const) {
      await db.run(sql`
        INSERT INTO settings (key, user_id, value, description, updated_at)
        VALUES (${key}, NULL, ${JSON.stringify(value)}, ${description}, ${updatedAt})
        ON CONFLICT (key) WHERE user_id IS NULL
        DO UPDATE SET value = EXCLUDED.value, description = EXCLUDED.description,
          updated_at = EXCLUDED.updated_at
      `);
    }
    return context.json(payload);
  });

  return router;
};
