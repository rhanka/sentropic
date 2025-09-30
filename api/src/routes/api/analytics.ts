import { Hono } from 'hono';
import { db } from '../../db/client';
import { useCases } from '../../db/schema';
import { eq } from 'drizzle-orm';
import { parseJson } from '../../utils/json';
import type { ScoreEntry } from '../../utils/scoring';

export const analyticsRouter = new Hono();

analyticsRouter.get('/summary', async (c) => {
  const folderId = c.req.query('folder_id');
  if (!folderId) {
    return c.json({ message: 'folder_id is required' }, 400);
  }
  const items = await db.select().from(useCases).where(eq(useCases.folderId, folderId));
  const totals = items.reduce(
    (acc, item) => {
      acc.total += 1;
      acc.value += item.totalValueScore ?? 0;
      acc.complexity += item.totalComplexityScore ?? 0;
      return acc;
    },
    { total: 0, value: 0, complexity: 0 }
  );
  return c.json({
    total_use_cases: totals.total,
    avg_value: totals.total ? totals.value / totals.total : 0,
    avg_complexity: totals.total ? totals.complexity / totals.total : 0
  });
});

analyticsRouter.get('/scatter', async (c) => {
  const folderId = c.req.query('folder_id');
  if (!folderId) {
    return c.json({ message: 'folder_id is required' }, 400);
  }
  const items = await db.select().from(useCases).where(eq(useCases.folderId, folderId));
  const mapped = items.map((item) => ({
    id: item.id,
    name: item.name,
    process: item.process,
    value_norm: item.totalValueScore ?? 0,
    ease: item.totalComplexityScore ? 100 - item.totalComplexityScore : 0,
    original_value: item.totalValueScore ?? 0,
    original_ease: item.totalComplexityScore ?? 0,
    value_scores: parseJson<ScoreEntry[]>(item.valueScores) ?? [],
    complexity_scores: parseJson<ScoreEntry[]>(item.complexityScores) ?? []
  }));
  return c.json({ items: mapped });
});
