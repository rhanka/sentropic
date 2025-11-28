
import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { db } from '../../db/client';
import { folders, useCases, companies } from '../../db/schema';
import { eq } from 'drizzle-orm';
import { createId } from '../../utils/id';
import { parseMatrixConfig } from '../../utils/matrix';
import { calculateUseCaseScores, type ScoreEntry } from '../../utils/scoring';
import type { UseCaseData, UseCase } from '../../types/usecase';
import { defaultMatrixConfig } from '../../config/default-matrix';
import { defaultPrompts } from '../../config/default-prompts';
import { queueManager } from '../../services/queue-manager';
import { settingsService } from '../../services/settings';

// Récupération des prompts depuis la configuration centralisée
const folderNamePrompt = defaultPrompts.find(p => p.id === 'folder_name')?.content || '';

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
  let data: UseCaseData = {};
  try {
    if (row.data && typeof row.data === 'object') {
      data = row.data as UseCaseData;
    } else if (typeof row.data === 'string') {
      data = JSON.parse(row.data) as UseCaseData;
    }
  } catch (error) {
    // Si data n'est pas valide, on part d'un objet vide
    data = {};
  }
  
  // Rétrocompatibilité : migrer depuis les colonnes natives si data.name ou data.description manquent
  // (pour les anciens enregistrements qui ont encore name/description en colonnes natives)
  if (!data.name && (row as any).name) {
    data.name = (row as any).name;
  }
  if (!data.description && (row as any).description) {
    data.description = (row as any).description;
  }
  
  // Rétrocompatibilité : migrer depuis les colonnes temporaires si data est vide
  if (!data.process && row.process) {
    data.process = row.process;
  }
  if (!data.domain && row.domain) {
    data.domain = row.domain;
  }
  if (!data.technologies && row.technologies) {
    data.technologies = parseJson<string[]>(row.technologies) ?? [];
  }
  if (!data.prerequisites && row.prerequisites) {
    data.prerequisites = row.prerequisites;
  }
  if (!data.deadline && row.deadline) {
    data.deadline = row.deadline;
  }
  if (!data.contact && row.contact) {
    data.contact = row.contact;
  }
  if (!data.benefits && row.benefits) {
    data.benefits = parseJson<string[]>(row.benefits) ?? [];
  }
  if (!data.metrics && row.metrics) {
    data.metrics = parseJson<string[]>(row.metrics) ?? [];
  }
  if (!data.risks && row.risks) {
    data.risks = parseJson<string[]>(row.risks) ?? [];
  }
  if (!data.nextSteps && row.nextSteps) {
    data.nextSteps = parseJson<string[]>(row.nextSteps) ?? [];
  }
  if (!data.dataSources && row.dataSources) {
    data.dataSources = parseJson<string[]>(row.dataSources) ?? [];
  }
  if (!data.dataObjects && row.dataObjects) {
    data.dataObjects = parseJson<string[]>(row.dataObjects) ?? [];
  }
  if (!data.references && row.references) {
    data.references = parseJson<Array<{title: string; url: string}>>(row.references) ?? [];
  }
  if (!data.valueScores && row.valueScores) {
    data.valueScores = parseJson<ScoreEntry[]>(row.valueScores) ?? [];
  }
  if (!data.complexityScores && row.complexityScores) {
    data.complexityScores = parseJson<ScoreEntry[]>(row.complexityScores) ?? [];
  }
  
  // S'assurer que name est présent (obligatoire)
  if (!data.name) {
    data.name = 'Cas d\'usage sans nom';
  }
  
  // Calculer les scores dynamiquement
  const computedScores = calculateUseCaseScores(matrix, data);
  
  return {
    id: row.id,
    folderId: row.folderId,
    companyId: row.companyId,
    status: row.status ?? 'completed',
    model: row.model,
    createdAt: row.createdAt,
    data,
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
    let data: UseCaseData = {};
    try {
      if (row.data && typeof row.data === 'object') {
        data = row.data as UseCaseData;
      } else if (typeof row.data === 'string') {
        data = JSON.parse(row.data) as UseCaseData;
      }
    } catch (error) {
      data = {};
    }
    
    // Rétrocompatibilité : migrer depuis les colonnes natives si data.name ou data.description manquent
    if (!data.name && (row as any).name) {
      data.name = (row as any).name;
    }
    if (!data.description && (row as any).description) {
      data.description = (row as any).description;
    }
    
    // Rétrocompatibilité : migrer depuis les colonnes temporaires si data est vide
    if (!data.process && row.process) data.process = row.process;
    if (!data.domain && row.domain) data.domain = row.domain;
    if (!data.technologies && row.technologies) data.technologies = parseJson<string[]>(row.technologies) ?? [];
    if (!data.prerequisites && row.prerequisites) data.prerequisites = row.prerequisites;
    if (!data.deadline && row.deadline) data.deadline = row.deadline;
    if (!data.contact && row.contact) data.contact = row.contact;
    if (!data.benefits && row.benefits) data.benefits = parseJson<string[]>(row.benefits) ?? [];
    if (!data.metrics && row.metrics) data.metrics = parseJson<string[]>(row.metrics) ?? [];
    if (!data.risks && row.risks) data.risks = parseJson<string[]>(row.risks) ?? [];
    if (!data.nextSteps && row.nextSteps) data.nextSteps = parseJson<string[]>(row.nextSteps) ?? [];
    if (!data.dataSources && row.dataSources) data.dataSources = parseJson<string[]>(row.dataSources) ?? [];
    if (!data.dataObjects && row.dataObjects) data.dataObjects = parseJson<string[]>(row.dataObjects) ?? [];
    if (!data.references && row.references) data.references = parseJson<Array<{title: string; url: string}>>(row.references) ?? [];
    if (!data.valueScores && row.valueScores) data.valueScores = parseJson<ScoreEntry[]>(row.valueScores) ?? [];
    if (!data.complexityScores && row.complexityScores) data.complexityScores = parseJson<ScoreEntry[]>(row.complexityScores) ?? [];
    
    // S'assurer que name est présent (obligatoire)
    if (!data.name) {
      data.name = 'Cas d\'usage sans nom';
    }
    
    // Calculer les scores dynamiquement
    const computedScores = calculateUseCaseScores(matrix, data);
    
    return {
      id: row.id,
      folderId: row.folderId,
      companyId: row.companyId,
      status: row.status ?? 'completed',
      model: row.model,
      createdAt: row.createdAt,
      data,
      totalValueScore: computedScores?.totalValueScore ?? null,
      totalComplexityScore: computedScores?.totalComplexityScore ?? null
    };
  }));
};

/**
 * Construit l'objet data JSONB à partir d'un UseCaseInput
 */
const buildUseCaseData = (payload: UseCaseInput, existingData?: UseCaseData): UseCaseData => {
  const data: UseCaseData = existingData ? { ...existingData } : { name: '' };
  
  // Champs principaux (obligatoires)
  if (payload.name !== undefined) data.name = payload.name;
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
    data: data as any, // Drizzle accepte JSONB directement (inclut name et description)
    // Colonnes temporaires pour rétrocompatibilité (seront supprimées après migration)
    process: payload.process,
    technologies: payload.technologies ? JSON.stringify(payload.technologies) : null,
    deadline: payload.deadline,
    contact: payload.contact,
    benefits: payload.benefits ? JSON.stringify(payload.benefits) : null,
    metrics: payload.metrics ? JSON.stringify(payload.metrics) : null,
    risks: payload.risks ? JSON.stringify(payload.risks) : null,
    nextSteps: payload.nextSteps ? JSON.stringify(payload.nextSteps) : null,
    dataSources: payload.dataSources ? JSON.stringify(payload.dataSources) : null,
    dataObjects: payload.dataObjects ? JSON.stringify(payload.dataObjects) : null,
    references: payload.references ? JSON.stringify(payload.references) : null,
    valueScores: payload.valueScores ? JSON.stringify(payload.valueScores) : null,
    complexityScores: payload.complexityScores ? JSON.stringify(payload.complexityScores) : null
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
  let existingData: UseCaseData = {};
  try {
    if (record.data && typeof record.data === 'object') {
      existingData = record.data as UseCaseData;
    } else if (typeof record.data === 'string') {
      existingData = JSON.parse(record.data) as UseCaseData;
    }
  } catch (error) {
    existingData = {};
  }
  
  // Construire le nouveau data en mergeant avec l'existant
  const newData = buildUseCaseData(payload, existingData);
  
  // S'assurer que name est présent dans data (obligatoire)
  if (!newData.name && existingData.name) {
    newData.name = existingData.name;
  } else if (!newData.name && (record as any).name) {
    // Rétrocompatibilité : utiliser la colonne native si data.name n'existe pas
    newData.name = (record as any).name;
  } else if (!newData.name && payload.name) {
    newData.name = payload.name;
  } else if (!newData.name) {
    newData.name = 'Cas d\'usage sans nom';
  }
  
  const folderId = payload.folderId ?? record.folderId;
  
  await db
    .update(useCases)
    .set({
      folderId,
      companyId: payload.companyId ?? record.companyId,
      data: newData as any, // Drizzle accepte JSONB directement (inclut name et description)
      // Colonnes temporaires pour rétrocompatibilité (seront supprimées après migration)
      process: payload.process ?? record.process,
      technologies: payload.technologies ? JSON.stringify(payload.technologies) : record.technologies,
      deadline: payload.deadline ?? record.deadline,
      contact: payload.contact ?? record.contact,
      benefits: payload.benefits ? JSON.stringify(payload.benefits) : record.benefits,
      metrics: payload.metrics ? JSON.stringify(payload.metrics) : record.metrics,
      risks: payload.risks ? JSON.stringify(payload.risks) : record.risks,
      nextSteps: payload.nextSteps ? JSON.stringify(payload.nextSteps) : record.nextSteps,
      dataSources: payload.dataSources ? JSON.stringify(payload.dataSources) : record.dataSources,
      dataObjects: payload.dataObjects ? JSON.stringify(payload.dataObjects) : record.dataObjects,
      references: payload.references ? JSON.stringify(payload.references) : record.references,
      valueScores: payload.valueScores ? JSON.stringify(payload.valueScores) : record.valueScores,
      complexityScores: payload.complexityScores
        ? JSON.stringify(payload.complexityScores)
        : record.complexityScores
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
    
    const matrixConfig = parseMatrixConfig(folder.matrixConfig ?? null);
    
    // Mettre à jour le statut à "detailing"
    await db.update(useCases)
      .set({ status: 'detailing' })
      .where(eq(useCases.id, id));
    
    // Ajouter le job à la queue
    const jobId = await queueManager.addJob('usecase_detail', {
      useCaseId: id,
      useCaseName: useCase.name,
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
