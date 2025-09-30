
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
  let query = db.select().from(useCases);
  if (folderId) {
    query = query.where(eq(useCases.folderId, folderId));
  }
  const rows = await query;
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

useCasesRouter.post('/generate', async (c) => {
  return c.json({ message: 'Generation endpoint not yet implemented' }, 501);
});
