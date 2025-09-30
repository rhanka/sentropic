import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { db } from '../../db/client';
import { settings } from '../../db/schema';
import { createId } from '../../utils/id';

const settingsSchema = z.object({
  openaiModels: z.record(z.string()).default({}),
  prompts: z.record(z.any()).default({}),
  generationLimits: z.record(z.any()).default({})
});

export const settingsRouter = new Hono();

settingsRouter.get('/', async (c) => {
  const [record] = await db.select().from(settings).limit(1);
  if (!record) {
    return c.json({
      openaiModels: {},
      prompts: {},
      generationLimits: {}
    });
  }
  return c.json({
    openaiModels: record.openaiModels ? JSON.parse(record.openaiModels) : {},
    prompts: record.prompts ? JSON.parse(record.prompts) : {},
    generationLimits: record.generationLimits ? JSON.parse(record.generationLimits) : {}
  });
});

settingsRouter.put('/', zValidator('json', settingsSchema), async (c) => {
  const payload = c.req.valid('json');
  const [record] = await db.select().from(settings).limit(1);
  if (!record) {
    await db.insert(settings).values({
      id: createId(),
      openaiModels: JSON.stringify(payload.openaiModels),
      prompts: JSON.stringify(payload.prompts),
      generationLimits: JSON.stringify(payload.generationLimits)
    });
  } else {
    await db
      .update(settings)
      .set({
        openaiModels: JSON.stringify(payload.openaiModels),
        prompts: JSON.stringify(payload.prompts),
        generationLimits: JSON.stringify(payload.generationLimits)
      })
      .where(eq(settings.id, record.id));
  }
  return c.json(payload);
});
