import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { db } from '../../db/client';
import { companies } from '../../db/schema';
import { eq } from 'drizzle-orm';
import { createId } from '../../utils/id';
import { enrichCompany } from '../../services/openai';

const companyInput = z.object({
  name: z.string().min(1),
  industry: z.string().optional(),
  size: z.string().optional(),
  products: z.string().optional(),
  processes: z.string().optional(),
  challenges: z.string().optional(),
  objectives: z.string().optional(),
  technologies: z.string().optional()
});

export const companiesRouter = new Hono();

companiesRouter.get('/', async (c) => {
  const rows = await db.select().from(companies);
  return c.json({ items: rows });
});

companiesRouter.post('/', zValidator('json', companyInput), async (c) => {
  const payload = c.req.valid('json');
  const id = createId();
  await db.insert(companies).values({ id, ...payload });
  const [company] = await db.select().from(companies).where(eq(companies.id, id));
  return c.json(company, 201);
});

companiesRouter.get('/:id', async (c) => {
  const id = c.req.param('id');
  const [company] = await db.select().from(companies).where(eq(companies.id, id));
  if (!company) {
    return c.json({ message: 'Not found' }, 404);
  }
  return c.json(company);
});

companiesRouter.put('/:id', zValidator('json', companyInput.partial()), async (c) => {
  const id = c.req.param('id');
  const payload = c.req.valid('json');
  const result = await db.update(companies).set(payload).where(eq(companies.id, id)).run();
  if (result.changes === 0) {
    return c.json({ message: 'Not found' }, 404);
  }
  const [company] = await db.select().from(companies).where(eq(companies.id, id));
  return c.json(company);
});

companiesRouter.delete('/:id', async (c) => {
  const id = c.req.param('id');
  await db.delete(companies).where(eq(companies.id, id));
  return c.body(null, 204);
});

// Endpoint pour l'enrichissement automatique des entreprises
const aiEnrichInput = z.object({
  name: z.string().min(1)
});

companiesRouter.post('/ai-enrich', zValidator('json', aiEnrichInput), async (c) => {
  try {
    const { name } = c.req.valid('json');
    const enrichedData = await enrichCompany({ companyName: name });
    return c.json(enrichedData);
  } catch (error) {
    console.error('Error in ai-enrich endpoint:', error);
    return c.json(
      { 
        message: 'Failed to enrich company data', 
        error: error instanceof Error ? error.message : 'Unknown error' 
      }, 
      500
    );
  }
});
