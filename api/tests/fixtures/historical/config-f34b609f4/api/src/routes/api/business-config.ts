import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { db } from '../../db/client';
import { businessConfig } from '../../db/schema';
import { createId } from '../../utils/id';
import { eq } from 'drizzle-orm';

const businessSchema = z.object({
  sectors: z.array(z.any()).default([]),
  processes: z.array(z.any()).default([])
});

export const businessConfigRouter = new Hono();

businessConfigRouter.get('/', async (c) => {
  const [record] = await db.select().from(businessConfig).limit(1);
  if (!record) {
    return c.json({ sectors: [], processes: [] });
  }
  return c.json({
    sectors: record.sectors ? JSON.parse(record.sectors) : [],
    processes: record.processes ? JSON.parse(record.processes) : []
  });
});

businessConfigRouter.put('/', zValidator('json', businessSchema), async (c) => {
  const payload = c.req.valid('json');
  const [record] = await db.select().from(businessConfig).limit(1);
  if (!record) {
    await db.insert(businessConfig).values({
      id: createId(),
      sectors: JSON.stringify(payload.sectors),
      processes: JSON.stringify(payload.processes)
    });
  } else {
    await db
      .update(businessConfig)
      .set({
        sectors: JSON.stringify(payload.sectors),
        processes: JSON.stringify(payload.processes)
      })
      .where(eq(businessConfig.id, record.id));
  }
  return c.json(payload);
});
