
import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { db } from '../../db/client';
import { folders, useCases, companies } from '../../db/schema';
import { eq } from 'drizzle-orm';
import { createId } from '../../utils/id';
import { parseMatrixConfig } from '../../utils/matrix';
import { calculateScores, type ScoreEntry } from '../../utils/scoring';
import type { MatrixConfig } from '../../types/matrix';
import { defaultMatrixConfig } from '../../config/default-matrix';
import { defaultPrompts } from '../../config/default-prompts';
import { queueManager } from '../../services/queue-manager';

// Récupération des prompts depuis la configuration centralisée
const folderNamePrompt = defaultPrompts.find(p => p.id === 'folder_name')?.content || '';

const scoreEntry = z.object({
  axisId: z.string(),
  rating: z.number().min(1).max(5),
  description: z.string()
});

const useCaseInput = z.object({
  folderId: z.string(),
  companyId: z.string().optional(),
  name: z.string().min(1),
  description: z.string().optional(),
  process: z.string().optional(),
  technologies: z.array(z.string()).optional(),
  deadline: z.string().optional(),
  contact: z.string().optional(),
  benefits: z.array(z.string()).optional(),
  metrics: z.array(z.string()).optional(),
  risks: z.array(z.string()).optional(),
  nextSteps: z.array(z.string()).optional(),
  sources: z.array(z.string()).optional(),
  relatedData: z.array(z.string()).optional(),
  valueScores: z.array(scoreEntry).optional(),
  complexityScores: z.array(scoreEntry).optional()
});

type UseCaseInput = z.infer<typeof useCaseInput>;

type SerializedUseCase = typeof useCases.$inferSelect;

const serializeArray = (values?: string[]) => (values ? JSON.stringify(values) : null);
const serializeScores = (values?: ScoreEntry[]) => (values ? JSON.stringify(values) : null);

const parseJson = <T>(value: string | null): T | undefined => {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as T;
  } catch (error) {
    return undefined;
  }
};

const withComputedScores = (matrix: MatrixConfig | null, payload: UseCaseInput) => {
  if (!matrix) {
    return {
      totalValueScore: null,
      totalComplexityScore: null
    };
  }
  const valueScores = payload.valueScores ?? [];
  const complexityScores = payload.complexityScores ?? [];
  const computed = calculateScores(matrix, valueScores, complexityScores);
  return {
    totalValueScore: computed.totalValueScore,
    totalComplexityScore: computed.totalComplexityScore
  };
};

const hydrateUseCase = (row: SerializedUseCase) => ({
  ...row,
  benefits: parseJson<string[]>(row.benefits) ?? [],
  metrics: parseJson<string[]>(row.metrics) ?? [],
  risks: parseJson<string[]>(row.risks) ?? [],
  nextSteps: parseJson<string[]>(row.nextSteps) ?? [],
  sources: parseJson<string[]>(row.sources) ?? [],
  relatedData: parseJson<string[]>(row.relatedData) ?? [],
  references: parseJson<Array<{title: string; url: string}>>(row.references) ?? [],
  technologies: parseJson<string[]>(row.technologies) ?? [],
  valueScores: parseJson<ScoreEntry[]>(row.valueScores) ?? [],
  complexityScores: parseJson<ScoreEntry[]>(row.complexityScores) ?? []
});

export const useCasesRouter = new Hono();

useCasesRouter.get('/', async (c) => {
  const folderId = c.req.query('folder_id');
  const rows = folderId
    ? await db.select().from(useCases).where(eq(useCases.folderId, folderId))
    : await db.select().from(useCases);
  return c.json({ items: rows.map(hydrateUseCase) });
});

useCasesRouter.post('/', zValidator('json', useCaseInput), async (c) => {
  const payload = c.req.valid('json');
  const [folder] = await db.select().from(folders).where(eq(folders.id, payload.folderId));
  if (!folder) {
    return c.json({ message: 'Folder not found' }, 404);
  }
  const matrix = parseMatrixConfig(folder.matrixConfig ?? null);
  const computed = withComputedScores(matrix, payload);
  const id = createId();
  await db.insert(useCases).values({
    id,
    folderId: payload.folderId,
    companyId: payload.companyId,
    name: payload.name,
    description: payload.description,
    process: payload.process,
    technologies: serializeArray(payload.technologies),
    deadline: payload.deadline,
    contact: payload.contact,
    benefits: serializeArray(payload.benefits),
    metrics: serializeArray(payload.metrics),
    risks: serializeArray(payload.risks),
    nextSteps: serializeArray(payload.nextSteps),
    sources: serializeArray(payload.sources),
    relatedData: serializeArray(payload.relatedData),
    valueScores: serializeScores(payload.valueScores),
    complexityScores: serializeScores(payload.complexityScores),
    totalValueScore: computed.totalValueScore ?? null,
    totalComplexityScore: computed.totalComplexityScore ?? null
  });
  const [record] = await db.select().from(useCases).where(eq(useCases.id, id));
  return c.json(hydrateUseCase(record), 201);
});

useCasesRouter.get('/:id', async (c) => {
  const id = c.req.param('id');
  const [record] = await db.select().from(useCases).where(eq(useCases.id, id));
  if (!record) {
    return c.json({ message: 'Not found' }, 404);
  }
  return c.json(hydrateUseCase(record));
});

useCasesRouter.put('/:id', zValidator('json', useCaseInput.partial()), async (c) => {
  const id = c.req.param('id');
  const payload = c.req.valid('json');
  const [record] = await db.select().from(useCases).where(eq(useCases.id, id));
  if (!record) {
    return c.json({ message: 'Not found' }, 404);
  }
  const folderId = payload.folderId ?? record.folderId;
  const [folder] = await db.select().from(folders).where(eq(folders.id, folderId));
  const matrix = parseMatrixConfig(folder?.matrixConfig ?? null);
  const computed = withComputedScores(matrix, {
    ...hydrateUseCase(record),
    ...payload
  } as UseCaseInput);
  await db
    .update(useCases)
    .set({
      folderId,
      companyId: payload.companyId ?? record.companyId,
      name: payload.name ?? record.name,
      description: payload.description ?? record.description,
      process: payload.process ?? record.process,
      technologies: serializeArray(payload.technologies) ?? record.technologies,
      deadline: payload.deadline ?? record.deadline,
      contact: payload.contact ?? record.contact,
      benefits: payload.benefits ? serializeArray(payload.benefits) : record.benefits,
      metrics: payload.metrics ? serializeArray(payload.metrics) : record.metrics,
      risks: payload.risks ? serializeArray(payload.risks) : record.risks,
      nextSteps: payload.nextSteps ? serializeArray(payload.nextSteps) : record.nextSteps,
      sources: payload.sources ? serializeArray(payload.sources) : record.sources,
      relatedData: payload.relatedData ? serializeArray(payload.relatedData) : record.relatedData,
      valueScores: payload.valueScores ? serializeScores(payload.valueScores) : record.valueScores,
      complexityScores: payload.complexityScores
        ? serializeScores(payload.complexityScores)
        : record.complexityScores,
      totalValueScore: computed.totalValueScore ?? record.totalValueScore,
      totalComplexityScore: computed.totalComplexityScore ?? record.totalComplexityScore
    })
    .where(eq(useCases.id, id));
  const [updated] = await db.select().from(useCases).where(eq(useCases.id, id));
  return c.json(hydrateUseCase(updated));
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
    const selectedModel = model || 'gpt-4.1-nano';
    
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
        status: 'generating',
        createdAt: new Date().toISOString()
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
    const selectedModel = model || 'gpt-4.1-nano';
    
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
