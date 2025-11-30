
import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { db } from '../../db/client';
import { folders, useCases } from '../../db/schema';
import { eq } from 'drizzle-orm';
import { createId } from '../../utils/id';
import { parseMatrixConfig } from '../../utils/matrix';
import { calculateUseCaseScores, type ScoreEntry } from '../../utils/scoring';
import type { UseCaseData, UseCase } from '../../types/usecase';
import { defaultMatrixConfig } from '../../config/default-matrix';
// import { defaultPrompts } from '../../config/default-prompts'; // Commented out - unused
import { queueManager } from '../../services/queue-manager';
import { settingsService } from '../../services/settings';

// Récupération des prompts depuis la configuration centralisée (désactivé - non utilisé)
// const folderNamePrompt = defaultPrompts.find(p => p.id === 'folder_name')?.content || '';

const scoreEntry = z.object({
  axisId: z.string(),
  rating: z.number().min(0).max(100),
  description: z.string()
});

const useCaseInput = z.object({
  folderId: z.string(),
  companyId: z.string().optional(),
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
    url: z.string()
  })).optional(),
  valueScores: z.array(scoreEntry).optional(),
  complexityScores: z.array(scoreEntry).optional()
});

type UseCaseInput = z.infer<typeof useCaseInput>;

type SerializedUseCase = typeof useCases.$inferSelect;

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
const hydrateUseCase = async (row: SerializedUseCase): Promise<UseCase> => {
  // Récupérer la matrice du dossier pour calculer les scores
  const [folder] = await db.select().from(folders).where(eq(folders.id, row.folderId));
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
  const rowAny = row as any;
  if (!data.name && rowAny.name) {
    data.name = rowAny.name;
  }
  if (!data.description && rowAny.description) {
    data.description = rowAny.description;
  }
  if (!data.process && rowAny.process) {
    data.process = rowAny.process;
  }
  if (!data.domain && rowAny.domain) {
    data.domain = rowAny.domain;
  }
  if (!data.technologies && rowAny.technologies) {
    data.technologies = parseJson<string[]>(rowAny.technologies) ?? [];
  }
  if (!data.prerequisites && rowAny.prerequisites) {
    data.prerequisites = rowAny.prerequisites;
  }
  if (!data.deadline && rowAny.deadline) {
    data.deadline = rowAny.deadline;
  }
  if (!data.contact && rowAny.contact) {
    data.contact = rowAny.contact;
  }
  if (!data.benefits && rowAny.benefits) {
    data.benefits = parseJson<string[]>(rowAny.benefits) ?? [];
  }
  if (!data.metrics && rowAny.metrics) {
    data.metrics = parseJson<string[]>(rowAny.metrics) ?? [];
  }
  if (!data.risks && rowAny.risks) {
    data.risks = parseJson<string[]>(rowAny.risks) ?? [];
  }
  if (!data.nextSteps && rowAny.nextSteps) {
    data.nextSteps = parseJson<string[]>(rowAny.nextSteps) ?? [];
  }
  if (!data.dataSources && rowAny.dataSources) {
    data.dataSources = parseJson<string[]>(rowAny.dataSources) ?? [];
  }
  if (!data.dataObjects && rowAny.dataObjects) {
    data.dataObjects = parseJson<string[]>(rowAny.dataObjects) ?? [];
  }
  if (!data.references && rowAny.references) {
    data.references = parseJson<Array<{title: string; url: string}>>(rowAny.references) ?? [];
  }
  if (!data.valueScores && rowAny.valueScores) {
    data.valueScores = parseJson<ScoreEntry[]>(rowAny.valueScores) ?? [];
  }
  if (!data.complexityScores && rowAny.complexityScores) {
    data.complexityScores = parseJson<ScoreEntry[]>(rowAny.complexityScores) ?? [];
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
    companyId: row.companyId,
    status: row.status ?? 'completed',
    model: row.model,
    createdAt: row.createdAt ?? new Date(),
    data: data as UseCaseData,
    totalValueScore: computedScores?.totalValueScore ?? null,
    totalComplexityScore: computedScores?.totalComplexityScore ?? null
  };
};

/**
 * Hydrate plusieurs use cases en une fois (optimisé pour les listes)
 */
export const hydrateUseCases = async (rows: SerializedUseCase[]): Promise<UseCase[]> => {
  // Récupérer tous les dossiers uniques pour éviter les requêtes multiples
  const folderIds = [...new Set(rows.map(r => r.folderId))];
  const foldersMap = new Map<string, typeof folders.$inferSelect>();
  
  for (const folderId of folderIds) {
    const [folder] = await db.select().from(folders).where(eq(folders.id, folderId));
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
    const rowAny = row as any;
    if (!data.name && rowAny.name) {
      data.name = rowAny.name;
    }
    if (!data.description && rowAny.description) {
      data.description = rowAny.description;
    }
    if (!data.process && rowAny.process) data.process = rowAny.process;
    if (!data.domain && rowAny.domain) data.domain = rowAny.domain;
    if (!data.technologies && rowAny.technologies) data.technologies = parseJson<string[]>(rowAny.technologies) ?? [];
    if (!data.prerequisites && rowAny.prerequisites) data.prerequisites = rowAny.prerequisites;
    if (!data.deadline && rowAny.deadline) data.deadline = rowAny.deadline;
    if (!data.contact && rowAny.contact) data.contact = rowAny.contact;
    if (!data.benefits && rowAny.benefits) data.benefits = parseJson<string[]>(rowAny.benefits) ?? [];
    if (!data.metrics && rowAny.metrics) data.metrics = parseJson<string[]>(rowAny.metrics) ?? [];
    if (!data.risks && rowAny.risks) data.risks = parseJson<string[]>(rowAny.risks) ?? [];
    if (!data.nextSteps && rowAny.nextSteps) data.nextSteps = parseJson<string[]>(rowAny.nextSteps) ?? [];
    if (!data.dataSources && rowAny.dataSources) data.dataSources = parseJson<string[]>(rowAny.dataSources) ?? [];
    if (!data.dataObjects && rowAny.dataObjects) data.dataObjects = parseJson<string[]>(rowAny.dataObjects) ?? [];
    if (!data.references && rowAny.references) data.references = parseJson<Array<{title: string; url: string}>>(rowAny.references) ?? [];
    if (!data.valueScores && rowAny.valueScores) data.valueScores = parseJson<ScoreEntry[]>(rowAny.valueScores) ?? [];
    if (!data.complexityScores && rowAny.complexityScores) data.complexityScores = parseJson<ScoreEntry[]>(rowAny.complexityScores) ?? [];
    
    // S'assurer que name est présent (obligatoire)
    if (!data.name) {
      data.name = 'Cas d\'usage sans nom';
    }
    
    // Calculer les scores dynamiquement
    const computedScores = calculateUseCaseScores(matrix, data as UseCaseData);
    
    return {
      id: row.id,
      folderId: row.folderId,
      companyId: row.companyId,
      status: row.status ?? 'completed',
      model: row.model,
      createdAt: row.createdAt ?? new Date(),
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
  const folderId = c.req.query('folder_id');
  const rows = folderId
    ? await db.select().from(useCases).where(eq(useCases.folderId, folderId))
    : await db.select().from(useCases);
  const hydrated = await Promise.all(rows.map(row => hydrateUseCase(row)));
  return c.json({ items: hydrated });
});

useCasesRouter.post('/', zValidator('json', useCaseInput), async (c) => {
  const payload = c.req.valid('json');
  const [folder] = await db.select().from(folders).where(eq(folders.id, payload.folderId));
  if (!folder) {
    return c.json({ message: 'Folder not found' }, 404);
  }
  const id = createId();
  const data = buildUseCaseData(payload);
  
  // S'assurer que name est présent dans data (obligatoire)
  if (!data.name) {
    data.name = payload.name;
  }
  
  await db.insert(useCases).values({
    id,
    folderId: payload.folderId,
    companyId: payload.companyId,
    data: data as any // Toutes les données métier sont dans data JSONB (inclut name, description, process, technologies, etc.)
  });
  const [record] = await db.select().from(useCases).where(eq(useCases.id, id));
  const hydrated = await hydrateUseCase(record);
  return c.json(hydrated, 201);
});

useCasesRouter.get('/:id', async (c) => {
  const id = c.req.param('id');
  const [record] = await db.select().from(useCases).where(eq(useCases.id, id));
  if (!record) {
    return c.json({ message: 'Not found' }, 404);
  }
  const hydrated = await hydrateUseCase(record);
  return c.json(hydrated);
});

useCasesRouter.put('/:id', zValidator('json', useCaseInput.partial()), async (c) => {
  const id = c.req.param('id');
  const payload = c.req.valid('json');
  const [record] = await db.select().from(useCases).where(eq(useCases.id, id));
  if (!record) {
    return c.json({ message: 'Not found' }, 404);
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
  if (!newData.name && (record as any).name) {
    newData = { ...newData, name: (record as any).name };
  }
  
  const folderId = payload.folderId ?? record.folderId;
  
  await db
    .update(useCases)
    .set({
      folderId,
      companyId: payload.companyId ?? record.companyId,
      data: newData as any // Toutes les données métier sont dans data JSONB (inclut name, description, process, technologies, etc.)
    })
    .where(eq(useCases.id, id));
  const [updated] = await db.select().from(useCases).where(eq(useCases.id, id));
  const hydrated = await hydrateUseCase(updated);
  return c.json(hydrated);
});

useCasesRouter.delete('/:id', async (c) => {
  const id = c.req.param('id');
  await db.delete(useCases).where(eq(useCases.id, id));
  return c.body(null, 204);
});

const generateInput = z.object({
  input: z.string().min(1),
  create_new_folder: z.boolean(),
  company_id: z.string().optional(),
  model: z.string().optional()
});

useCasesRouter.post('/generate', zValidator('json', generateInput), async (c) => {
  try {
    const { input, create_new_folder, company_id, model } = c.req.valid('json');
    
    // Récupérer le modèle par défaut depuis les settings si non fourni
    const aiSettings = await settingsService.getAISettings();
    const selectedModel = model || aiSettings.defaultModel;
    
    let folderId: string | undefined;
    
    // Créer un dossier si demandé
    if (create_new_folder) {
      const folderName = `Génération - ${new Date().toLocaleDateString('fr-FR')}`;
      const folderDescription = `Dossier généré automatiquement pour: ${input}`;
      
      folderId = createId();
      await db.insert(folders).values({
        id: folderId,
        name: folderName,
        description: folderDescription,
        companyId: company_id || null,
        matrixConfig: JSON.stringify(defaultMatrixConfig),
        status: 'generating'
        // createdAt omitted to use defaultNow() in Postgres
      });
    }
    
    // Ajouter le job à la queue
    const jobId = await queueManager.addJob('usecase_list', {
      folderId: folderId!,
      input,
      companyId: company_id,
      model: selectedModel
    });
    
    return c.json({
      success: true,
      message: 'Génération démarrée',
      status: 'generating',
      created_folder_id: folderId,
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

useCasesRouter.post('/:id/detail', zValidator('json', detailInput), async (c) => {
  try {
    const id = c.req.param('id');
    const { model } = c.req.valid('json');
    
    // Récupérer le modèle par défaut depuis les settings si non fourni
    const aiSettings = await settingsService.getAISettings();
    const selectedModel = model || aiSettings.defaultModel;
    
    // Récupérer le cas d'usage
    const [useCase] = await db.select().from(useCases).where(eq(useCases.id, id));
    if (!useCase) {
      return c.json({ message: 'Cas d\'usage non trouvé' }, 404);
    }
    
    // Récupérer la configuration de la matrice du dossier
    const [folder] = await db.select().from(folders).where(eq(folders.id, useCase.folderId));
    if (!folder) {
      return c.json({ message: 'Dossier non trouvé' }, 404);
    }
    
    // matrixConfig parsed but not used in this endpoint
    // const matrixConfig = parseMatrixConfig(folder.matrixConfig ?? null);
    
    // Mettre à jour le statut à "detailing"
    await db.update(useCases)
      .set({ status: 'detailing' })
      .where(eq(useCases.id, id));
    
    // Extraire le nom depuis data JSONB (avec rétrocompatibilité)
    const useCaseData = useCase.data && typeof useCase.data === 'object' 
      ? useCase.data as Partial<UseCaseData>
      : {};
    const useCaseName = useCaseData.name || (useCase as any).name || 'Cas d\'usage sans nom';
    
    // Ajouter le job à la queue
    const jobId = await queueManager.addJob('usecase_detail', {
      useCaseId: id,
      useCaseName,
      folderId: useCase.folderId,
      model: selectedModel
    });
    
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
