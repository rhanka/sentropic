import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { db } from '../../db/client';
import { folders } from '../../db/schema';
import { createId } from '../../utils/id';
import { eq } from 'drizzle-orm';
import { defaultMatrixConfig } from '../../config/default-matrix';

const matrixSchema = z.object({
  valueAxes: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      weight: z.number(),
      description: z.string().optional(),
      levelDescriptions: z.array(
        z.object({
          level: z.number(),
          description: z.string()
        })
      ).optional()
    })
  ),
  complexityAxes: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      weight: z.number(),
      description: z.string().optional(),
      levelDescriptions: z.array(
        z.object({
          level: z.number(),
          description: z.string()
        })
      ).optional()
    })
  ),
  valueThresholds: z.array(
    z.object({
      level: z.number(),
      points: z.number(),
      cases: z.number().optional()
    })
  ),
  complexityThresholds: z.array(
    z.object({
      level: z.number(),
      points: z.number(),
      cases: z.number().optional()
    })
  )
});

const folderInput = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  companyId: z.string().optional(),
  matrixConfig: matrixSchema.optional()
});

export const foldersRouter = new Hono();

const parseMatrix = (value: string | null) => {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch (error) {
    return null;
  }
};

foldersRouter.get('/', async (c) => {
  const companyId = c.req.query('company_id');
  const rows = companyId
    ? await db.select().from(folders).where(eq(folders.companyId, companyId))
    : await db.select().from(folders);
  const items = rows.map((folder) => ({
    ...folder,
    matrixConfig: parseMatrix(folder.matrixConfig ?? null)
  }));
  return c.json({ items });
});

foldersRouter.post('/', zValidator('json', folderInput), async (c) => {
  const payload = c.req.valid('json');
  const id = createId();
  
  // Utiliser la matrice fournie ou la matrice par défaut
  const matrixToUse = payload.matrixConfig || defaultMatrixConfig;
  
  await db.insert(folders).values({
    id,
    name: payload.name,
    description: payload.description,
    companyId: payload.companyId,
    matrixConfig: JSON.stringify(matrixToUse)
  });
  const [folder] = await db.select().from(folders).where(eq(folders.id, id));
  return c.json({
    ...folder,
    matrixConfig: parseMatrix(folder.matrixConfig ?? null)
  }, 201);
});

foldersRouter.get('/:id', async (c) => {
  const id = c.req.param('id');
  const [folder] = await db.select().from(folders).where(eq(folders.id, id));
  if (!folder) {
    return c.json({ message: 'Not found' }, 404);
  }
  return c.json({
    ...folder,
    matrixConfig: parseMatrix(folder.matrixConfig ?? null)
  });
});

foldersRouter.put('/:id', zValidator('json', folderInput.partial()), async (c) => {
  const id = c.req.param('id');
  const payload = c.req.valid('json');
  const updatePayload = {
    ...payload,
    matrixConfig: payload.matrixConfig ? JSON.stringify(payload.matrixConfig) : undefined
  };
  const result = await db.update(folders).set(updatePayload).where(eq(folders.id, id)).run();
  if (result.changes === 0) {
    return c.json({ message: 'Not found' }, 404);
  }
  const [folder] = await db.select().from(folders).where(eq(folders.id, id));
  return c.json({
    ...folder,
    matrixConfig: parseMatrix(folder.matrixConfig ?? null)
  });
});

foldersRouter.delete('/:id', async (c) => {
  const id = c.req.param('id');
  await db.delete(folders).where(eq(folders.id, id));
  return c.body(null, 204);
});

foldersRouter.get('/:id/matrix', async (c) => {
  const id = c.req.param('id');
  const [folder] = await db.select().from(folders).where(eq(folders.id, id));
  if (!folder) {
    return c.json({ message: 'Not found' }, 404);
  }
  return c.json(
    parseMatrix(folder.matrixConfig ?? null) ?? defaultMatrixConfig
  );
});

// Endpoint pour récupérer la matrice de base par défaut
foldersRouter.get('/matrix/default', async (c) => {
  return c.json(defaultMatrixConfig);
});

// Endpoint pour lister les dossiers avec leurs matrices (pour copier)
foldersRouter.get('/list/with-matrices', async (c) => {
  const rows = await db.select().from(folders);
  const items = rows.map((folder) => ({
    id: folder.id,
    name: folder.name,
    description: folder.description,
    hasMatrix: !!folder.matrixConfig
  }));
  return c.json({ items });
});


foldersRouter.put('/:id/matrix', zValidator('json', matrixSchema), async (c) => {
  const id = c.req.param('id');
  const matrix = c.req.valid('json');
  const result = await db
    .update(folders)
    .set({ matrixConfig: JSON.stringify(matrix) })
    .where(eq(folders.id, id))
    .run();
  if (result.changes === 0) {
    return c.json({ message: 'Not found' }, 404);
  }
  return c.json(matrix);
});
