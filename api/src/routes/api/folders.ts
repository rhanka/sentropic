import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { db, pool } from '../../db/client';
import { folders, organizations, useCases } from '../../db/schema';
import { createId } from '../../utils/id';
import { and, desc, eq, sql } from 'drizzle-orm';
import { defaultMatrixConfig } from '../../config/default-matrix';
import { requireEditor } from '../../middleware/rbac';
import { requireWorkspaceEditorRole } from '../../middleware/workspace-rbac';
import { isObjectLockedError, requireLockOwnershipForMutation } from '../../services/lock-service';
import { queueManager } from '../../services/queue-manager';

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
  // Preferred naming
  organizationId: z.string().optional(),
  matrixConfig: matrixSchema.optional(),
  executiveSummary: executiveSummaryDataSchema.optional(),
  // Status is intentionally optional; default remains 'completed'.
  // Used by the "draft folder" flow in UI (similar to organizations draft).
  status: z.enum(['draft', 'generating', 'completed']).optional(),
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
  const user = c.get('user') as { role?: string; workspaceId: string };
  const targetWorkspaceId = user.workspaceId;
  const organizationId = c.req.query('organization_id');
  const includeUseCaseCounts = c.req.query('include_usecase_counts') === 'true';
  
  if (includeUseCaseCounts) {
    const rows = organizationId
      ? await db.select({
          id: folders.id,
          name: folders.name,
          description: folders.description,
          organizationId: folders.organizationId,
          organizationName: organizations.name,
          matrixConfig: folders.matrixConfig,
          status: folders.status,
          createdAt: folders.createdAt,
          useCaseCount: sql<number>`count(${useCases.id})`.mapWith(Number)
        })
        .from(folders)
        .leftJoin(organizations, and(eq(folders.organizationId, organizations.id), eq(organizations.workspaceId, targetWorkspaceId)))
        .leftJoin(useCases, and(eq(useCases.folderId, folders.id), eq(useCases.workspaceId, targetWorkspaceId)))
        .where(and(eq(folders.workspaceId, targetWorkspaceId), eq(folders.organizationId, organizationId)))
        .groupBy(
          folders.id,
          folders.name,
          folders.description,
          folders.organizationId,
          organizations.name,
          folders.matrixConfig,
          folders.status,
          folders.createdAt
        )
        .orderBy(desc(folders.createdAt))
      : await db.select({
          id: folders.id,
          name: folders.name,
          description: folders.description,
          organizationId: folders.organizationId,
          organizationName: organizations.name,
          matrixConfig: folders.matrixConfig,
          status: folders.status,
          createdAt: folders.createdAt,
          useCaseCount: sql<number>`count(${useCases.id})`.mapWith(Number)
        })
        .from(folders)
        .leftJoin(organizations, and(eq(folders.organizationId, organizations.id), eq(organizations.workspaceId, targetWorkspaceId)))
        .leftJoin(useCases, and(eq(useCases.folderId, folders.id), eq(useCases.workspaceId, targetWorkspaceId)))
        .where(eq(folders.workspaceId, targetWorkspaceId))
        .groupBy(
          folders.id,
          folders.name,
          folders.description,
          folders.organizationId,
          organizations.name,
          folders.matrixConfig,
          folders.status,
          folders.createdAt
        )
        .orderBy(desc(folders.createdAt));

    const items = rows.map((folder) => ({
      ...folder,
      matrixConfig: parseMatrix(folder.matrixConfig ?? null)
    }));
    return c.json({ items });
  }

  // LEFT JOIN with organizations to retrieve organization name
  const rows = organizationId
    ? await db.select({
        id: folders.id,
        name: folders.name,
        description: folders.description,
        organizationId: folders.organizationId,
        organizationName: organizations.name,
        matrixConfig: folders.matrixConfig,
        status: folders.status,
        createdAt: folders.createdAt
      })
      .from(folders)
      .leftJoin(organizations, and(eq(folders.organizationId, organizations.id), eq(organizations.workspaceId, targetWorkspaceId)))
      .where(and(eq(folders.workspaceId, targetWorkspaceId), eq(folders.organizationId, organizationId)))
      .orderBy(desc(folders.createdAt))
    : await db.select({
        id: folders.id,
        name: folders.name,
        description: folders.description,
        organizationId: folders.organizationId,
        organizationName: organizations.name,
        matrixConfig: folders.matrixConfig,
        status: folders.status,
        createdAt: folders.createdAt
      })
      .from(folders)
      .leftJoin(organizations, and(eq(folders.organizationId, organizations.id), eq(organizations.workspaceId, targetWorkspaceId)))
      .where(eq(folders.workspaceId, targetWorkspaceId))
      .orderBy(desc(folders.createdAt));
      
  const items = rows.map((folder) => ({
    ...folder,
    matrixConfig: parseMatrix(folder.matrixConfig ?? null)
  }));
  return c.json({ items });
});

foldersRouter.post('/', requireEditor, requireWorkspaceEditorRole(), zValidator('json', folderInput), async (c) => {
  const { workspaceId } = c.get('user') as { workspaceId: string };
  const payload = c.req.valid('json');
  const id = createId();
  const organizationId = payload.organizationId;
  
  // Utiliser la matrice fournie ou la matrice par défaut
  const matrixToUse = payload.matrixConfig || defaultMatrixConfig;

  // Validate organization belongs to workspace (if provided)
  if (organizationId) {
    const [org] = await db
      .select({ id: organizations.id })
      .from(organizations)
      .where(and(eq(organizations.id, organizationId), eq(organizations.workspaceId, workspaceId)))
      .limit(1);
    if (!org) {
      return c.json({ message: 'Not found' }, 404);
    }
  }
  
  await db.insert(folders).values({
    id,
    workspaceId,
    name: payload.name,
    description: payload.description,
    organizationId,
    matrixConfig: JSON.stringify(matrixToUse),
    status: payload.status ?? 'completed',
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

// POST /api/v1/folders/draft - Create a folder as draft (so documents can be attached before generation)
foldersRouter.post(
  '/draft',
  requireEditor,
  zValidator(
    'json',
    z.object({
      name: z.string().min(1),
      description: z.string().optional(),
      organizationId: z.string().optional(),
    })
  ),
  async (c) => {
    const { workspaceId } = c.get('user') as { workspaceId: string };
    const { name, description, organizationId } = c.req.valid('json');
    const id = createId();

    // Validate organization belongs to workspace (if provided)
    if (organizationId) {
      const [org] = await db
        .select({ id: organizations.id })
        .from(organizations)
        .where(and(eq(organizations.id, organizationId), eq(organizations.workspaceId, workspaceId)))
        .limit(1);
      if (!org) {
        return c.json({ message: 'Not found' }, 404);
      }
    }

    await db.insert(folders).values({
      id,
      workspaceId,
      name,
      description,
      organizationId,
      matrixConfig: JSON.stringify(defaultMatrixConfig),
      status: 'draft',
    });

    const [folder] = await db
      .select()
      .from(folders)
      .where(and(eq(folders.id, id), eq(folders.workspaceId, workspaceId)));
    await notifyFolderEvent(id);
    return c.json(
      {
        ...folder,
        matrixConfig: parseMatrix(folder.matrixConfig ?? null),
      },
      201
    );
  }
);

foldersRouter.get('/:id', async (c) => {
  const user = c.get('user') as { role?: string; workspaceId: string };
  const targetWorkspaceId = user.workspaceId;
  const id = c.req.param('id');
  const [folder] = await db.select({
    id: folders.id,
    name: folders.name,
    description: folders.description,
    organizationId: folders.organizationId,
    organizationName: organizations.name,
    matrixConfig: folders.matrixConfig,
    executiveSummary: folders.executiveSummary,
    status: folders.status,
    createdAt: folders.createdAt
  })
  .from(folders)
  .leftJoin(organizations, and(eq(folders.organizationId, organizations.id), eq(organizations.workspaceId, targetWorkspaceId)))
  .where(and(eq(folders.id, id), eq(folders.workspaceId, targetWorkspaceId)));
  
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

foldersRouter.put('/:id', requireEditor, requireWorkspaceEditorRole(), zValidator('json', folderInput.partial()), async (c) => {
  const { workspaceId, userId } = c.get('user') as { workspaceId: string; userId: string };
  const id = c.req.param('id');
  const payload = c.req.valid('json');
  const organizationId = payload.organizationId;

  try {
    await requireLockOwnershipForMutation({
      userId,
      workspaceId,
      objectType: 'folder',
      objectId: id,
    });
  } catch (e: unknown) {
    if (isObjectLockedError(e)) return c.json({ message: 'Object is locked', code: 'OBJECT_LOCKED', lock: e.lock }, 409);
    throw e;
  }

  // Validate organization belongs to workspace (if provided)
  if (organizationId) {
    const [org] = await db
      .select({ id: organizations.id })
      .from(organizations)
      .where(and(eq(organizations.id, organizationId), eq(organizations.workspaceId, workspaceId)))
      .limit(1);
    if (!org) {
      return c.json({ message: 'Not found' }, 404);
    }
  }

  const updatePayload = {
    ...payload,
    organizationId,
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
  const shouldInvalidateExecutiveDocx =
    payload.executiveSummary !== undefined ||
    payload.name !== undefined ||
    payload.matrixConfig !== undefined;
  if (shouldInvalidateExecutiveDocx) {
    await queueManager.invalidateDocxCacheForEntity({
      workspaceId,
      templateId: 'executive-synthesis-multipage',
      entityType: 'folder',
      entityId: id,
    });
  }
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

foldersRouter.delete('/:id', requireEditor, requireWorkspaceEditorRole(), async (c) => {
  const { workspaceId, userId } = c.get('user') as { workspaceId: string; userId: string };
  const id = c.req.param('id');
  try {
    await requireLockOwnershipForMutation({
      userId,
      workspaceId,
      objectType: 'folder',
      objectId: id,
    });
  } catch (e: unknown) {
    if (isObjectLockedError(e)) return c.json({ message: 'Object is locked', code: 'OBJECT_LOCKED', lock: e.lock }, 409);
    throw e;
  }
  await db.delete(folders).where(and(eq(folders.id, id), eq(folders.workspaceId, workspaceId)));
  await notifyFolderEvent(id);
  return c.body(null, 204);
});

foldersRouter.get('/:id/matrix', async (c) => {
  const user = c.get('user') as { role?: string; workspaceId: string };
  const targetWorkspaceId = user.workspaceId;
  const id = c.req.param('id');
  const [folder] = await db
    .select()
    .from(folders)
    .where(and(eq(folders.id, id), eq(folders.workspaceId, targetWorkspaceId)));
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
  const user = c.get('user') as { role?: string; workspaceId: string };
  const targetWorkspaceId = user.workspaceId;
  const rows = await db.select().from(folders).where(eq(folders.workspaceId, targetWorkspaceId));
  const items = rows.map((folder) => ({
    id: folder.id,
    name: folder.name,
    description: folder.description,
    hasMatrix: !!folder.matrixConfig
  }));
  return c.json({ items });
});


foldersRouter.put('/:id/matrix', requireEditor, requireWorkspaceEditorRole(), zValidator('json', matrixSchema), async (c) => {
  const { workspaceId, userId } = c.get('user') as { workspaceId: string; userId: string };
  const id = c.req.param('id');
  const matrix = c.req.valid('json');
  try {
    await requireLockOwnershipForMutation({
      userId,
      workspaceId,
      objectType: 'folder',
      objectId: id,
    });
  } catch (e: unknown) {
    if (isObjectLockedError(e)) return c.json({ message: 'Object is locked', code: 'OBJECT_LOCKED', lock: e.lock }, 409);
    throw e;
  }
  const updated = await db
    .update(folders)
    .set({ matrixConfig: JSON.stringify(matrix) })
    .where(and(eq(folders.id, id), eq(folders.workspaceId, workspaceId)))
    .returning({ matrixConfig: folders.matrixConfig });
  if (updated.length === 0) {
    return c.json({ message: 'Not found' }, 404);
  }
  await notifyFolderEvent(id);
  return c.json(matrix);
});
