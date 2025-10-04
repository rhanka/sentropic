
import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { db } from '../../db/client';
import { folders, useCases } from '../../db/schema';
import { eq } from 'drizzle-orm';
import { createId } from '../../utils/id';
import { parseMatrixConfig } from '../../utils/matrix';
import { calculateScores, type ScoreEntry } from '../../utils/scoring';
import type { MatrixConfig } from '../../types/matrix';
import { defaultMatrixConfig } from '../../config/default-matrix';
import { executePrompt, askWithWebSearch } from '../../services/openai';
import { defaultPrompts } from '../../config/default-prompts';

// Récupération des prompts depuis la configuration centralisée
const folderNamePrompt = defaultPrompts.find(p => p.id === 'folder_name')?.content || '';
const useCaseListPrompt = defaultPrompts.find(p => p.id === 'use_case_list')?.content || '';
const useCaseDetailPrompt = defaultPrompts.find(p => p.id === 'use_case_detail')?.content || '';

const scoreEntry = z.object({
  axisId: z.string(),
  rating: z.number().min(1).max(5),
  description: z.string().optional()
});

const useCaseInput = z.object({
  folderId: z.string(),
  companyId: z.string().optional(),
  name: z.string().min(1),
  description: z.string().optional(),
  process: z.string().optional(),
  technology: z.string().optional(),
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
    technology: payload.technology,
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
      technology: payload.technology ?? record.technology,
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
  company_id: z.string().optional()
});

useCasesRouter.post('/generate', zValidator('json', generateInput), async (c) => {
  try {
    const { input, create_new_folder, company_id } = c.req.valid('json');
    
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
    
    // Générer les cas d'usage via OpenAI avec recherche web
    // Générer la liste de cas d'usage avec recherche web
    const useCaseListPrompt_filled = useCaseListPrompt.replace('{{user_input}}', input);
    const useCaseListResponse = await askWithWebSearch(useCaseListPrompt_filled, 'gpt-5');
    
    // Extraire le contenu de la réponse OpenAI et parser le JSON
    const useCaseListContent = useCaseListResponse.choices[0]?.message?.content;
    if (!useCaseListContent) {
      throw new Error('Aucune réponse reçue pour la liste de cas d\'usage');
    }
    const useCaseList = JSON.parse(useCaseListContent);
    const matrixConfig = defaultMatrixConfig;
    
    const generatedUseCases = await Promise.all(
      useCaseList.useCases.map(async (title) => {
        // Générer le détail du cas d'usage avec recherche web
        const useCaseDetailPrompt_filled = useCaseDetailPrompt
          .replace(/\{\{use_case\}\}/g, title)
          .replace('{{user_input}}', input)
          .replace('{{matrix}}', JSON.stringify(matrixConfig));
        const useCaseDetailResponse = await askWithWebSearch(useCaseDetailPrompt_filled, 'gpt-5');
        
        // Extraire le contenu de la réponse OpenAI et parser le JSON
        const useCaseDetailContent = useCaseDetailResponse.choices[0]?.message?.content;
        if (!useCaseDetailContent) {
          throw new Error(`Aucune réponse reçue pour le cas d'usage: ${title}`);
        }
        const useCaseDetail = JSON.parse(useCaseDetailContent);
        const matrixString = JSON.stringify(matrixConfig);
        
        // Calculer les scores avec la matrice
        const computed = calculateScores(matrixConfig, useCaseDetail.valueScores, useCaseDetail.complexityScores);
        
        return {
          id: createId(),
          folderId: folderId!,
          companyId: company_id || null,
          name: useCaseDetail.name,
          description: useCaseDetail.description,
          process: useCaseDetail.process,
          technology: useCaseDetail.technology,
          deadline: useCaseDetail.deadline,
          contact: useCaseDetail.contact,
          benefits: JSON.stringify(useCaseDetail.benefits),
          metrics: JSON.stringify(useCaseDetail.metrics),
          risks: JSON.stringify(useCaseDetail.risks),
          nextSteps: JSON.stringify(useCaseDetail.nextSteps),
          sources: JSON.stringify(useCaseDetail.sources),
          relatedData: JSON.stringify(useCaseDetail.relatedData),
          valueScores: JSON.stringify(useCaseDetail.valueScores),
          complexityScores: JSON.stringify(useCaseDetail.complexityScores),
          totalValueScore: computed.totalValueScore,
          totalComplexityScore: computed.totalComplexityScore,
          createdAt: new Date().toISOString()
        };
      })
    );
    
    // Insérer les cas d'usage en base
    await db.insert(useCases).values(generatedUseCases);
    
    // Marquer le dossier comme "completed" après l'insertion des cas d'usage
    if (folderId) {
      await db.update(folders)
        .set({ status: 'completed' })
        .where(eq(folders.id, folderId));
    }
    
    const createdUseCaseIds = generatedUseCases.map(uc => uc.id);
    
    return c.json({
      created_folder_id: folderId,
      created_use_case_ids: createdUseCaseIds,
      summary: `Génération terminée : ${createdUseCaseIds.length} cas d'usage créés${folderId ? ` dans le dossier ${folderId}` : ''}`
    });
    
  } catch (error) {
    console.error('Error in use-cases generate:', error);
    return c.json(
      { 
        message: 'Failed to generate use cases', 
        error: error instanceof Error ? error.message : 'Unknown error' 
      }, 
      500
    );
  }
});
