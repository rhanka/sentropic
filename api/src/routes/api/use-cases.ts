
import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { db, pool } from '../../db/client';
import { organizations, folders, useCases } from '../../db/schema';
import { and, eq } from 'drizzle-orm';
import { createId } from '../../utils/id';
import { parseMatrixConfig } from '../../utils/matrix';
import { calculateUseCaseScores, type ScoreEntry } from '../../utils/scoring';
import type { UseCaseData, UseCase, UseCaseDataJson } from '../../types/usecase';
import { defaultMatrixConfig } from '../../config/default-matrix';
// import { defaultPrompts } from '../../config/default-prompts'; // Commented out - unused
import { queueManager } from '../../services/queue-manager';
import { settingsService } from '../../services/settings';
import { requireEditor } from '../../middleware/rbac';
import { requireWorkspaceEditorRole } from '../../middleware/workspace-rbac';
import { isObjectLockedError, requireLockOwnershipForMutation } from '../../services/lock-service';

async function notifyUseCaseEvent(useCaseId: string): Promise<void> {
  const notifyPayload = JSON.stringify({ use_case_id: useCaseId });
  const client = await pool.connect();
  try {
    await client.query(`NOTIFY usecase_events, '${notifyPayload.replace(/'/g, "''")}'`);
  } finally {
    client.release();
  }
}

async function notifyFolderEvent(folderId: string): Promise<void> {
  const notifyPayload = JSON.stringify({ folder_id: folderId });
  const client = await pool.connect();
  try {
    await client.query(`NOTIFY folder_events, '${notifyPayload.replace(/'/g, "''")}'`);
  } finally {
    client.release();
  }
}

// Récupération des prompts depuis la configuration centralisée (désactivé - non utilisé)
// const folderNamePrompt = defaultPrompts.find(p => p.id === 'folder_name')?.content || '';

const scoreEntry = z.object({
  axisId: z.string(),
  rating: z.number().min(0).max(100),
  description: z.string()
});

const useCaseInput = z.object({
  folderId: z.string(),
  organizationId: z.string().optional(),
  name: z.string().min(1),
  description: z.string().optional(), // 30-60 caractères
  // Nouveaux champs pour data JSONB
  problem: z.string().optional(), // 40-80 caractères
  solution: z.string().optional(), // 40-80 caractères
  // Champs métier (seront dans data JSONB)
  process: z.string().optional(),
  domain: z.string().optional(),
  technologies: z.array(z.string()).optional(),
  deadline: z.string().optional(),
  contact: z.string().optional(),
  benefits: z.array(z.string()).optional(),
  metrics: z.array(z.string()).optional(),
  risks: z.array(z.string()).optional(),
  nextSteps: z.array(z.string()).optional(),
  dataSources: z.array(z.string()).optional(),
  dataObjects: z.array(z.string()).optional(),
  references: z.array(z.object({
    title: z.string(),
    url: z.string(),
    excerpt: z.string().optional(),
  })).optional(),
  valueScores: z.array(scoreEntry).optional(),
  complexityScores: z.array(scoreEntry).optional()
});

type UseCaseInput = z.infer<typeof useCaseInput>;

export type SerializedUseCase = typeof useCases.$inferSelect;

// Type pour rétrocompatibilité avec les anciennes colonnes (avant migration 0008)
// Permet l'accès aux propriétés qui peuvent encore exister dans certains backups
type LegacyUseCaseRow = SerializedUseCase & {
  name?: string;
  description?: string;
  process?: string;
  domain?: string;
  technologies?: string | null;
  prerequisites?: string;
  deadline?: string;
  contact?: string;
  benefits?: string | null;
  metrics?: string | null;
  risks?: string | null;
  nextSteps?: string | null;
  dataSources?: string | null;
  dataObjects?: string | null;
  references?: string | null;
  valueScores?: string | null;
  complexityScores?: string | null;
};

const parseJson = <T>(value: string | null): T | undefined => {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as T;
  } catch (error) {
    return undefined;
  }
};

/**
 * Extrait les données de data JSONB et des colonnes temporaires (rétrocompatibilité)
 * Calcule les scores dynamiquement à partir de la matrice du dossier
 */
export const hydrateUseCase = async (row: SerializedUseCase): Promise<UseCase> => {
  // Récupérer la matrice du dossier pour calculer les scores
  const [folder] = await db
    .select()
    .from(folders)
    .where(and(eq(folders.id, row.folderId), eq(folders.workspaceId, row.workspaceId)));
  const matrix = parseMatrixConfig(folder?.matrixConfig ?? null);
  
  // Extraire data JSONB (peut être vide {} pour les anciens enregistrements)
  let data: Partial<UseCaseData> = {};
  try {
    if (row.data && typeof row.data === 'object') {
      data = row.data as Partial<UseCaseData>;
    } else if (typeof row.data === 'string') {
      data = JSON.parse(row.data) as Partial<UseCaseData>;
    }
  } catch (error) {
    // Si data n'est pas valide, on part d'un objet vide
    data = {};
  }
  
  // Rétrocompatibilité : migrer depuis les colonnes natives si elles existent encore dans la DB
  // (pour les backups de prod qui ont encore ces colonnes avant application de la migration 0008)
  // Note: Après la migration 0008, toutes les colonnes sont supprimées et toutes les données sont dans data
  const legacyRow = row as LegacyUseCaseRow;
  if (!data.name && legacyRow.name) {
    data.name = legacyRow.name;
  }
  if (!data.description && legacyRow.description) {
    data.description = legacyRow.description;
  }
  if (!data.process && legacyRow.process) {
    data.process = legacyRow.process;
  }
  if (!data.domain && legacyRow.domain) {
    data.domain = legacyRow.domain;
  }
  if (!data.technologies && legacyRow.technologies) {
    data.technologies = parseJson<string[]>(legacyRow.technologies) ?? [];
  }
  if (!data.prerequisites && legacyRow.prerequisites) {
    data.prerequisites = legacyRow.prerequisites;
  }
  if (!data.deadline && legacyRow.deadline) {
    data.deadline = legacyRow.deadline;
  }
  if (!data.contact && legacyRow.contact) {
    data.contact = legacyRow.contact;
  }
  if (!data.benefits && legacyRow.benefits) {
    data.benefits = parseJson<string[]>(legacyRow.benefits) ?? [];
  }
  if (!data.metrics && legacyRow.metrics) {
    data.metrics = parseJson<string[]>(legacyRow.metrics) ?? [];
  }
  if (!data.risks && legacyRow.risks) {
    data.risks = parseJson<string[]>(legacyRow.risks) ?? [];
  }
  if (!data.nextSteps && legacyRow.nextSteps) {
    data.nextSteps = parseJson<string[]>(legacyRow.nextSteps) ?? [];
  }
  if (!data.dataSources && legacyRow.dataSources) {
    data.dataSources = parseJson<string[]>(legacyRow.dataSources) ?? [];
  }
  if (!data.dataObjects && legacyRow.dataObjects) {
    data.dataObjects = parseJson<string[]>(legacyRow.dataObjects) ?? [];
  }
  if (!data.references && legacyRow.references) {
    data.references = parseJson<Array<{ title: string; url: string; excerpt?: string }>>(legacyRow.references) ?? [];
  }
  if (!data.valueScores && legacyRow.valueScores) {
    data.valueScores = parseJson<ScoreEntry[]>(legacyRow.valueScores) ?? [];
  }
  if (!data.complexityScores && legacyRow.complexityScores) {
    data.complexityScores = parseJson<ScoreEntry[]>(legacyRow.complexityScores) ?? [];
  }
  
  // S'assurer que name est présent (obligatoire)
  if (!data.name) {
    data.name = 'Cas d\'usage sans nom';
  }
  
  // Calculer les scores dynamiquement
  const computedScores = calculateUseCaseScores(matrix, data as UseCaseData);
  
  return {
    id: row.id,
    folderId: row.folderId,
    organizationId: row.organizationId,
    status: row.status ?? 'completed',
    model: row.model,
    createdAt: row.createdAt,
    data: data as UseCaseData,
    totalValueScore: computedScores?.totalValueScore ?? null,
    totalComplexityScore: computedScores?.totalComplexityScore ?? null
  };
};

/**
 * Hydrate plusieurs use cases en une fois (optimisé pour les listes)
 */
export const hydrateUseCases = async (rows: SerializedUseCase[]): Promise<UseCase[]> => {
  const workspaceId = rows[0]?.workspaceId;
  // Récupérer tous les dossiers uniques pour éviter les requêtes multiples
  const folderIds = [...new Set(rows.map(r => r.folderId))];
  const foldersMap = new Map<string, typeof folders.$inferSelect>();
  
  for (const folderId of folderIds) {
    const [folder] = workspaceId
      ? await db.select().from(folders).where(and(eq(folders.id, folderId), eq(folders.workspaceId, workspaceId)))
      : await db.select().from(folders).where(eq(folders.id, folderId));
    if (folder) {
      foldersMap.set(folderId, folder);
    }
  }
  
  return Promise.all(rows.map(async (row) => {
    const folder = foldersMap.get(row.folderId);
    const matrix = parseMatrixConfig(folder?.matrixConfig ?? null);
    
    // Extraire data JSONB
    let data: Partial<UseCaseData> = {};
    try {
      if (row.data && typeof row.data === 'object') {
        data = row.data as Partial<UseCaseData>;
      } else if (typeof row.data === 'string') {
        data = JSON.parse(row.data) as Partial<UseCaseData>;
      }
    } catch (error) {
      data = {};
    }
    
    // Rétrocompatibilité : migrer depuis les colonnes natives si elles existent encore dans la DB
    // (pour les backups de prod qui ont encore ces colonnes avant application de la migration 0008)
    const legacyRow = row as LegacyUseCaseRow;
    if (!data.name && legacyRow.name) {
      data.name = legacyRow.name;
    }
    if (!data.description && legacyRow.description) {
      data.description = legacyRow.description;
    }
    if (!data.process && legacyRow.process) data.process = legacyRow.process;
    if (!data.domain && legacyRow.domain) data.domain = legacyRow.domain;
    if (!data.technologies && legacyRow.technologies) data.technologies = parseJson<string[]>(legacyRow.technologies) ?? [];
    if (!data.prerequisites && legacyRow.prerequisites) data.prerequisites = legacyRow.prerequisites;
    if (!data.deadline && legacyRow.deadline) data.deadline = legacyRow.deadline;
    if (!data.contact && legacyRow.contact) data.contact = legacyRow.contact;
    if (!data.benefits && legacyRow.benefits) data.benefits = parseJson<string[]>(legacyRow.benefits) ?? [];
    if (!data.metrics && legacyRow.metrics) data.metrics = parseJson<string[]>(legacyRow.metrics) ?? [];
    if (!data.risks && legacyRow.risks) data.risks = parseJson<string[]>(legacyRow.risks) ?? [];
    if (!data.nextSteps && legacyRow.nextSteps) data.nextSteps = parseJson<string[]>(legacyRow.nextSteps) ?? [];
    if (!data.dataSources && legacyRow.dataSources) data.dataSources = parseJson<string[]>(legacyRow.dataSources) ?? [];
    if (!data.dataObjects && legacyRow.dataObjects) data.dataObjects = parseJson<string[]>(legacyRow.dataObjects) ?? [];
    if (!data.references && legacyRow.references) {
      data.references = parseJson<Array<{ title: string; url: string; excerpt?: string }>>(legacyRow.references) ?? [];
    }
    if (!data.valueScores && legacyRow.valueScores) data.valueScores = parseJson<ScoreEntry[]>(legacyRow.valueScores) ?? [];
    if (!data.complexityScores && legacyRow.complexityScores) data.complexityScores = parseJson<ScoreEntry[]>(legacyRow.complexityScores) ?? [];
    
    // S'assurer que name est présent (obligatoire)
    if (!data.name) {
      data.name = 'Cas d\'usage sans nom';
    }
    
    // Calculer les scores dynamiquement
    const computedScores = calculateUseCaseScores(matrix, data as UseCaseData);
    
    return {
      id: row.id,
      folderId: row.folderId,
      organizationId: row.organizationId,
      status: row.status ?? 'completed',
      model: row.model,
      createdAt: row.createdAt,
      data: data as UseCaseData,
      totalValueScore: computedScores?.totalValueScore ?? null,
      totalComplexityScore: computedScores?.totalComplexityScore ?? null
    };
  }));
};

/**
 * Construit l'objet data JSONB à partir d'un UseCaseInput (peut être partiel pour PUT)
 */
const buildUseCaseData = (payload: Partial<UseCaseInput>, existingData?: Partial<UseCaseData>): UseCaseData => {
  // S'assurer que name est toujours défini (obligatoire)
  const name: string = payload.name ?? existingData?.name ?? 'Cas d\'usage sans nom';
  const data: UseCaseData = existingData 
    ? { ...existingData, name } 
    : { name };
  
  // Champs principaux (obligatoires) - name est déjà défini ci-dessus
  if (payload.description !== undefined) data.description = payload.description;
  
  // Nouveaux champs
  if (payload.problem !== undefined) data.problem = payload.problem;
  if (payload.solution !== undefined) data.solution = payload.solution;
  
  // Champs métier
  if (payload.process !== undefined) data.process = payload.process;
  if (payload.domain !== undefined) data.domain = payload.domain;
  if (payload.technologies !== undefined) data.technologies = payload.technologies;
  if (payload.deadline !== undefined) data.deadline = payload.deadline;
  if (payload.contact !== undefined) data.contact = payload.contact;
  if (payload.benefits !== undefined) data.benefits = payload.benefits;
  if (payload.metrics !== undefined) data.metrics = payload.metrics;
  if (payload.risks !== undefined) data.risks = payload.risks;
  if (payload.nextSteps !== undefined) data.nextSteps = payload.nextSteps;
  if (payload.dataSources !== undefined) data.dataSources = payload.dataSources;
  if (payload.dataObjects !== undefined) data.dataObjects = payload.dataObjects;
  if (payload.references !== undefined) data.references = payload.references;
  if (payload.valueScores !== undefined) data.valueScores = payload.valueScores;
  if (payload.complexityScores !== undefined) data.complexityScores = payload.complexityScores;
  
  return data;
};

export const useCasesRouter = new Hono();

useCasesRouter.get('/', async (c) => {
  const user = c.get('user') as { role?: string; workspaceId: string };
  const targetWorkspaceId = user.workspaceId;
  const folderId = c.req.query('folder_id');
  const rows = folderId
    ? await db.select().from(useCases).where(and(eq(useCases.workspaceId, targetWorkspaceId), eq(useCases.folderId, folderId)))
    : await db.select().from(useCases).where(eq(useCases.workspaceId, targetWorkspaceId));
  const hydrated = await Promise.all(rows.map(row => hydrateUseCase(row)));
  return c.json({ items: hydrated });
});

useCasesRouter.post('/', requireEditor, requireWorkspaceEditorRole(), zValidator('json', useCaseInput), async (c) => {
  const { workspaceId } = c.get('user') as { workspaceId: string };
  const payload = c.req.valid('json');
  const [folder] = await db
    .select()
    .from(folders)
    .where(and(eq(folders.id, payload.folderId), eq(folders.workspaceId, workspaceId)));
  if (!folder) {
    return c.json({ message: 'Folder not found' }, 404);
  }

  if (payload.organizationId) {
    const [org] = await db
      .select({ id: organizations.id })
      .from(organizations)
      .where(and(eq(organizations.id, payload.organizationId), eq(organizations.workspaceId, workspaceId)))
      .limit(1);
    if (!org) return c.json({ message: 'Not found' }, 404);
  }

  const id = createId();
  const data = buildUseCaseData(payload);
  
  // S'assurer que name est présent dans data (obligatoire)
  if (!data.name) {
    data.name = payload.name;
  }
  
  await db.insert(useCases).values({
    id,
    workspaceId,
    folderId: payload.folderId,
    organizationId: payload.organizationId,
    // data est UseCaseData (garanti par buildUseCaseData), converti en UseCaseDataJson pour compatibilité Drizzle JSONB
    data: data as UseCaseDataJson // Toutes les données métier sont dans data JSONB (inclut name, description, process, technologies, etc.)
  });
  const [record] = await db
    .select()
    .from(useCases)
    .where(and(eq(useCases.id, id), eq(useCases.workspaceId, workspaceId)));
  const hydrated = await hydrateUseCase(record);
  return c.json(hydrated, 201);
});

useCasesRouter.get('/:id', async (c) => {
  const user = c.get('user') as { role?: string; workspaceId: string };
  const targetWorkspaceId = user.workspaceId;
  const id = c.req.param('id');
  const [record] = await db
    .select()
    .from(useCases)
    .where(and(eq(useCases.id, id), eq(useCases.workspaceId, targetWorkspaceId)));
  if (!record) {
    return c.json({ message: 'Not found' }, 404);
  }
  const hydrated = await hydrateUseCase(record);
  return c.json(hydrated);
});

useCasesRouter.put('/:id', requireEditor, requireWorkspaceEditorRole(), zValidator('json', useCaseInput.partial()), async (c) => {
  const { workspaceId, userId } = c.get('user') as { workspaceId: string; userId: string };
  const id = c.req.param('id');
  const payload = c.req.valid('json');
  const [record] = await db
    .select()
    .from(useCases)
    .where(and(eq(useCases.id, id), eq(useCases.workspaceId, workspaceId)));
  if (!record) {
    return c.json({ message: 'Not found' }, 404);
  }

  try {
    await requireLockOwnershipForMutation({
      userId,
      workspaceId,
      objectType: 'usecase',
      objectId: id,
    });
  } catch (e: unknown) {
    if (isObjectLockedError(e)) return c.json({ message: 'Object is locked', code: 'OBJECT_LOCKED', lock: e.lock }, 409);
    throw e;
  }
  
  // Extraire data existant pour le merge
  let existingData: Partial<UseCaseData> = {};
  try {
    if (record.data && typeof record.data === 'object') {
      existingData = record.data as Partial<UseCaseData>;
    } else if (typeof record.data === 'string') {
      existingData = JSON.parse(record.data) as Partial<UseCaseData>;
    }
  } catch (error) {
    existingData = {};
  }
  
  // Construire le nouveau data en mergeant avec l'existant
  // buildUseCaseData garantit toujours un name défini
  let newData = buildUseCaseData(payload, existingData);
  
  // Rétrocompatibilité : si name n'est toujours pas défini (cas edge), utiliser la colonne native
  const legacyRecord = record as LegacyUseCaseRow;
  if (!newData.name && legacyRecord.name) {
    newData = { ...newData, name: legacyRecord.name };
  }
  
  const folderId = payload.folderId ?? record.folderId;

  // If folderId changed, validate folder belongs to workspace
  if (payload.folderId) {
    const [folder] = await db
      .select({ id: folders.id })
      .from(folders)
      .where(and(eq(folders.id, payload.folderId), eq(folders.workspaceId, workspaceId)))
      .limit(1);
    if (!folder) return c.json({ message: 'Folder not found' }, 404);
  }

  if (payload.organizationId) {
    const [org] = await db
      .select({ id: organizations.id })
      .from(organizations)
      .where(and(eq(organizations.id, payload.organizationId), eq(organizations.workspaceId, workspaceId)))
      .limit(1);
    if (!org) return c.json({ message: 'Not found' }, 404);
  }
  
  await db
    .update(useCases)
    .set({
      folderId,
      organizationId: payload.organizationId ?? record.organizationId,
      // newData est UseCaseData (garanti par buildUseCaseData), converti en UseCaseDataJson pour compatibilité Drizzle JSONB
      data: newData as UseCaseDataJson // Toutes les données métier sont dans data JSONB (inclut name, description, process, technologies, etc.)
    })
    .where(and(eq(useCases.id, id), eq(useCases.workspaceId, workspaceId)));
  const [updated] = await db
    .select()
    .from(useCases)
    .where(and(eq(useCases.id, id), eq(useCases.workspaceId, workspaceId)));
  const hydrated = await hydrateUseCase(updated);
  return c.json(hydrated);
});

useCasesRouter.delete('/:id', requireEditor, requireWorkspaceEditorRole(), async (c) => {
  const { workspaceId, userId } = c.get('user') as { workspaceId: string; userId: string };
  const id = c.req.param('id');
  try {
    await requireLockOwnershipForMutation({
      userId,
      workspaceId,
      objectType: 'usecase',
      objectId: id,
    });
  } catch (e: unknown) {
    if (isObjectLockedError(e)) return c.json({ message: 'Object is locked', code: 'OBJECT_LOCKED', lock: e.lock }, 409);
    throw e;
  }
  await db.delete(useCases).where(and(eq(useCases.id, id), eq(useCases.workspaceId, workspaceId)));
  return c.body(null, 204);
});

const generateInput = z.object({
  input: z.string().min(1),
  folder_id: z.string().optional(),
  use_case_count: z.coerce.number().int().min(1).max(25).optional(),
  organization_id: z.string().optional(),
  model: z.string().optional()
});

useCasesRouter.post('/generate', requireEditor, requireWorkspaceEditorRole(), zValidator('json', generateInput), async (c) => {
  try {
    const { workspaceId } = c.get('user') as { workspaceId: string };
    const { input, folder_id, use_case_count, organization_id, model } = c.req.valid('json');
    const organizationId = organization_id;
    
    // Récupérer le modèle par défaut depuis les settings si non fourni
    const aiSettings = await settingsService.getAISettings();
    const selectedModel = model || aiSettings.defaultModel;
    
    let folderId: string | undefined;
    
    // Générer sur un dossier existant si fourni (ex: /dossier/new crée un brouillon)
    if (folder_id) {
      folderId = folder_id;

      const [folder] = await db
        .select({ id: folders.id })
        .from(folders)
        .where(and(eq(folders.id, folderId), eq(folders.workspaceId, workspaceId)))
        .limit(1);
      if (!folder) return c.json({ message: 'Not found' }, 404);

      if (organizationId) {
        const [org] = await db
          .select({ id: organizations.id })
          .from(organizations)
          .where(and(eq(organizations.id, organizationId), eq(organizations.workspaceId, workspaceId)))
          .limit(1);
        if (!org) return c.json({ message: 'Not found' }, 404);
      }

      await db
        .update(folders)
        .set({
          status: 'generating',
          // Garder la description synchronisée avec l'input (source de vérité côté UI pour /dossier/new)
          description: input
        })
        .where(and(eq(folders.id, folderId), eq(folders.workspaceId, workspaceId)));
      await notifyFolderEvent(folderId);
    } else {
      // Sinon, créer un nouveau dossier (comportement par défaut de /use-cases/generate)
      const folderName = `Génération - ${new Date().toLocaleDateString('fr-FR')}`;
      const folderDescription = `Dossier généré automatiquement pour: ${input}`;
      
      folderId = createId();

      if (organizationId) {
        const [org] = await db
          .select({ id: organizations.id })
          .from(organizations)
          .where(and(eq(organizations.id, organizationId), eq(organizations.workspaceId, workspaceId)))
          .limit(1);
        if (!org) return c.json({ message: 'Not found' }, 404);
      }

      await db.insert(folders).values({
        id: folderId,
        workspaceId,
        name: folderName,
        description: folderDescription,
        organizationId: organizationId || null,
        matrixConfig: JSON.stringify(defaultMatrixConfig),
        status: 'generating'
        // createdAt omitted to use defaultNow() in Postgres
      });
      await notifyFolderEvent(folderId);
    }
    
    // Ajouter le job à la queue
    const jobId = await queueManager.addJob('usecase_list', {
      folderId: folderId!,
      input,
      organizationId,
      model: selectedModel,
      useCaseCount: use_case_count
    }, { workspaceId, maxRetries: 1 });
    
    return c.json({
      success: true,
      message: 'Génération démarrée',
      status: 'generating',
      folder_id: folderId,
      created_folder_id: folder_id ? undefined : folderId,
      jobId
    });
    
  } catch (error) {
    console.error('Error in use-cases generate:', error);
    if (error instanceof Error) {
      console.error('Generate error message:', error.message);
      console.error('Generate error stack:', error.stack);
    }
    return c.json(
      { 
        message: 'Failed to generate use cases', 
        error: error instanceof Error ? error.message : 'Unknown error' 
      }, 
      500
    );
  }
});

// Endpoint pour détailler un cas d'usage
const detailInput = z.object({
  model: z.string().optional()
});

useCasesRouter.post('/:id/detail', requireEditor, requireWorkspaceEditorRole(), zValidator('json', detailInput), async (c) => {
  try {
    const { workspaceId } = c.get('user') as { workspaceId: string };
    const id = c.req.param('id');
    const { model } = c.req.valid('json');
    
    // Récupérer le modèle par défaut depuis les settings si non fourni
    const aiSettings = await settingsService.getAISettings();
    const selectedModel = model || aiSettings.defaultModel;
    
    // Récupérer le cas d'usage
    const [useCase] = await db
      .select()
      .from(useCases)
      .where(and(eq(useCases.id, id), eq(useCases.workspaceId, workspaceId)));
    if (!useCase) {
      return c.json({ message: 'Cas d\'usage non trouvé' }, 404);
    }
    
    // Récupérer la configuration de la matrice du dossier
    const [folder] = await db
      .select()
      .from(folders)
      .where(and(eq(folders.id, useCase.folderId), eq(folders.workspaceId, workspaceId)));
    if (!folder) {
      return c.json({ message: 'Dossier non trouvé' }, 404);
    }
    
    // matrixConfig parsed but not used in this endpoint
    // const matrixConfig = parseMatrixConfig(folder.matrixConfig ?? null);
    
    // Mettre à jour le statut à "detailing"
    await db.update(useCases)
      .set({ status: 'detailing' })
      .where(and(eq(useCases.id, id), eq(useCases.workspaceId, workspaceId)));
    await notifyUseCaseEvent(id);
    
    // Extraire le nom depuis data JSONB (avec rétrocompatibilité)
    const useCaseData = useCase.data && typeof useCase.data === 'object' 
      ? useCase.data as Partial<UseCaseData>
      : {};
    const legacyUseCase = useCase as LegacyUseCaseRow;
    const useCaseName = useCaseData.name || legacyUseCase.name || 'Cas d\'usage sans nom';
    
    // Ajouter le job à la queue
    const jobId = await queueManager.addJob('usecase_detail', {
      useCaseId: id,
      useCaseName,
      folderId: useCase.folderId,
      model: selectedModel
    }, { workspaceId, maxRetries: 1 });
    
    return c.json({
      success: true,
      message: 'Détail du cas d\'usage démarré',
      status: 'detailing',
      jobId
    });
    
  } catch (error) {
    console.error('Error starting use case detail:', error);
    return c.json({
      success: false,
      message: 'Erreur lors du démarrage du détail'
    }, 500);
  }
});


export default useCasesRouter;
