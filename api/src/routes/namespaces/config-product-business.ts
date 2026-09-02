import { zValidator } from '@hono/zod-validator';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import { db } from '../../db/client';
import { businessConfig } from '../../db/schema';
import { createId } from '../../utils/id';

const businessSchema = z.object({
  sectors: z.array(z.any()).default([]),
  processes: z.array(z.any()).default([]),
});

export const createProductBusinessConfigRouter = (): Hono => {
  const router = new Hono();

  router.get('/', async (context) => {
    const [record] = await db.select().from(businessConfig).limit(1);
    if (!record) return context.json({ sectors: [], processes: [] });
    return context.json({
      sectors: record.sectors ? JSON.parse(record.sectors) : [],
      processes: record.processes ? JSON.parse(record.processes) : [],
    });
  });

  router.put('/', zValidator('json', businessSchema), async (context) => {
    const payload = context.req.valid('json');
    const [record] = await db.select().from(businessConfig).limit(1);
    const values = {
      sectors: JSON.stringify(payload.sectors),
      processes: JSON.stringify(payload.processes),
    };
    if (!record) {
      await db.insert(businessConfig).values({ id: createId(), ...values });
    } else {
      await db.update(businessConfig).set(values).where(eq(businessConfig.id, record.id));
    }
    return context.json(payload);
  });

  return router;
};
