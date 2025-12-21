import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { db, pool } from '../../db/client';
import { folders, companies } from '../../db/schema';
import { createId } from '../../utils/id';
import { and, desc, eq } from 'drizzle-orm';
import { defaultMatrixConfig } from '../../config/default-matrix';
import { requireEditor } from '../../middleware/rbac';

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

const executiveSummaryDataSchema = z.object({
  introduction: z.string().optional(),
  analyse: z.string().optional(),
  recommandation: z.string().optional(),
  synthese_executive: z.string().optional(),
  references: z.array(
    z.object({
      title: z.string(),
      url: z.string()
    })
  ).optional()
});

const folderInput = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  companyId: z.string().optional(),
  matrixConfig: matrixSchema.optional(),
  executiveSummary: executiveSummaryDataSchema.optional()
});

export const foldersRouter = new Hono();

async function notifyFolderEvent(folderId: string): Promise<void> {
  const notifyPayload = JSON.stringify({ folder_id: folderId });
  const client = await pool.connect();
  try {
    await client.query(`NOTIFY folder_events, '${notifyPayload.replace(/'/g, "''")}'`);
  } finally {
    client.release();
  }
}

const parseMatrix = (value: string | null) => {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch (error) {
    return null;
  }
};

// parseExecutiveSummary function (currently unused)
// const parseExecutiveSummary = (value: string | null) => {
//   if (!value) return null;
//   try {
//     return JSON.parse(value);
//   } catch (error) {
//     return null;
//   }
// };

foldersRouter.get('/', async (c) => {
  const { workspaceId } = c.get('user') as { workspaceId: string };
  const companyId = c.req.query('company_id');
  
  // Faire un LEFT JOIN avec la table companies pour récupérer le nom de l'entreprise
  const rows = companyId
    ? await db.select({
        id: folders.id,
        name: folders.name,
        description: folders.description,
        companyId: folders.companyId,
        companyName: companies.name,
        matrixConfig: folders.matrixConfig,
        status: folders.status,
        createdAt: folders.createdAt
      })
      .from(folders)
      .leftJoin(companies, and(eq(folders.companyId, companies.id), eq(companies.workspaceId, workspaceId)))
      .where(and(eq(folders.workspaceId, workspaceId), eq(folders.companyId, companyId)))
      .orderBy(desc(folders.createdAt))
    : await db.select({
        id: folders.id,
        name: folders.name,
        description: folders.description,
        companyId: folders.companyId,
        companyName: companies.name,
        matrixConfig: folders.matrixConfig,
        status: folders.status,
        createdAt: folders.createdAt
      })
      .from(folders)
      .leftJoin(companies, and(eq(folders.companyId, companies.id), eq(companies.workspaceId, workspaceId)))
      .where(eq(folders.workspaceId, workspaceId))
      .orderBy(desc(folders.createdAt));
      
  const items = rows.map((folder) => ({
    ...folder,
    matrixConfig: parseMatrix(folder.matrixConfig ?? null)
  }));
  return c.json({ items });
});

foldersRouter.post('/', requireEditor, zValidator('json', folderInput), async (c) => {
  const { workspaceId } = c.get('user') as { workspaceId: string };
  const payload = c.req.valid('json');
  const id = createId();
  
  // Utiliser la matrice fournie ou la matrice par défaut
  const matrixToUse = payload.matrixConfig || defaultMatrixConfig;

  // Validate company belongs to workspace (if provided)
  if (payload.companyId) {
    const [company] = await db
      .select({ id: companies.id })
      .from(companies)
      .where(and(eq(companies.id, payload.companyId), eq(companies.workspaceId, workspaceId)))
      .limit(1);
    if (!company) {
      return c.json({ message: 'Company not found' }, 404);
    }
  }
  
  await db.insert(folders).values({
    id,
    workspaceId,
    name: payload.name,
    description: payload.description,
    companyId: payload.companyId,
    matrixConfig: JSON.stringify(matrixToUse)
  });
  const [folder] = await db
    .select()
    .from(folders)
    .where(and(eq(folders.id, id), eq(folders.workspaceId, workspaceId)));
  await notifyFolderEvent(id);
  return c.json({
    ...folder,
    matrixConfig: parseMatrix(folder.matrixConfig ?? null)
  }, 201);
});

foldersRouter.get('/:id', async (c) => {
  const { workspaceId } = c.get('user') as { workspaceId: string };
  const id = c.req.param('id');
  const [folder] = await db.select({
    id: folders.id,
    name: folders.name,
    description: folders.description,
    companyId: folders.companyId,
    companyName: companies.name,
    matrixConfig: folders.matrixConfig,
    executiveSummary: folders.executiveSummary,
    status: folders.status,
    createdAt: folders.createdAt
  })
  .from(folders)
  .leftJoin(companies, and(eq(folders.companyId, companies.id), eq(companies.workspaceId, workspaceId)))
  .where(and(eq(folders.id, id), eq(folders.workspaceId, workspaceId)));
  
  if (!folder) {
    return c.json({ message: 'Not found' }, 404);
  }
  
  // Parser executiveSummary si présent
  let parsedExecutiveSummary = null;
  if (folder.executiveSummary) {
    try {
      parsedExecutiveSummary = typeof folder.executiveSummary === 'string' 
        ? JSON.parse(folder.executiveSummary) 
        : folder.executiveSummary;
    } catch (e) {
      console.error('Failed to parse executiveSummary:', e);
    }
  }
  
  return c.json({
    ...folder,
    matrixConfig: parseMatrix(folder.matrixConfig ?? null),
    executiveSummary: parsedExecutiveSummary
  });
});

foldersRouter.put('/:id', requireEditor, zValidator('json', folderInput.partial()), async (c) => {
  const { workspaceId } = c.get('user') as { workspaceId: string };
  const id = c.req.param('id');
  const payload = c.req.valid('json');

  // Validate company belongs to workspace (if provided)
  if (payload.companyId) {
    const [company] = await db
      .select({ id: companies.id })
      .from(companies)
      .where(and(eq(companies.id, payload.companyId), eq(companies.workspaceId, workspaceId)))
      .limit(1);
    if (!company) {
      return c.json({ message: 'Company not found' }, 404);
    }
  }

  const updatePayload = {
    ...payload,
    matrixConfig: payload.matrixConfig ? JSON.stringify(payload.matrixConfig) : undefined,
    executiveSummary: payload.executiveSummary ? JSON.stringify(payload.executiveSummary) : undefined
  };
  const updated = await db
    .update(folders)
    .set(updatePayload)
    .where(and(eq(folders.id, id), eq(folders.workspaceId, workspaceId)))
    .returning();
  if (updated.length === 0) {
    return c.json({ message: 'Not found' }, 404);
  }
  const folder = updated[0];
  await notifyFolderEvent(id);
  
  // Parser executiveSummary si présent
  let parsedExecutiveSummary = null;
  if (folder.executiveSummary) {
    try {
      parsedExecutiveSummary = typeof folder.executiveSummary === 'string' 
        ? JSON.parse(folder.executiveSummary) 
        : folder.executiveSummary;
    } catch (e) {
      console.error('Failed to parse executiveSummary:', e);
    }
  }
  
  return c.json({
    ...folder,
    matrixConfig: parseMatrix(folder.matrixConfig ?? null),
    executiveSummary: parsedExecutiveSummary
  });
});

foldersRouter.delete('/:id', requireEditor, async (c) => {
  const { workspaceId } = c.get('user') as { workspaceId: string };
  const id = c.req.param('id');
  await db.delete(folders).where(and(eq(folders.id, id), eq(folders.workspaceId, workspaceId)));
  await notifyFolderEvent(id);
  return c.body(null, 204);
});

foldersRouter.get('/:id/matrix', async (c) => {
  const { workspaceId } = c.get('user') as { workspaceId: string };
  const id = c.req.param('id');
  const [folder] = await db
    .select()
    .from(folders)
    .where(and(eq(folders.id, id), eq(folders.workspaceId, workspaceId)));
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
  const { workspaceId } = c.get('user') as { workspaceId: string };
  const rows = await db.select().from(folders).where(eq(folders.workspaceId, workspaceId));
  const items = rows.map((folder) => ({
    id: folder.id,
    name: folder.name,
    description: folder.description,
    hasMatrix: !!folder.matrixConfig
  }));
  return c.json({ items });
});


foldersRouter.put('/:id/matrix', requireEditor, zValidator('json', matrixSchema), async (c) => {
  const { workspaceId } = c.get('user') as { workspaceId: string };
  const id = c.req.param('id');
  const matrix = c.req.valid('json');
  const updated = await db
    .update(folders)
    .set({ matrixConfig: JSON.stringify(matrix) })
    .where(and(eq(folders.id, id), eq(folders.workspaceId, workspaceId)))
    .returning({ matrixConfig: folders.matrixConfig });
  if (updated.length === 0) {
    return c.json({ message: 'Not found' }, 404);
  }
  return c.json(matrix);
});
