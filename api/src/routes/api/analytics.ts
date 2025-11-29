import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { db } from '../../db/client';
import { useCases, folders } from '../../db/schema';
import { eq } from 'drizzle-orm';
import { queueManager } from '../../services/queue-manager';
import { settingsService } from '../../services/settings';
import { hydrateUseCases } from './use-cases';

export const analyticsRouter = new Hono();

analyticsRouter.get('/summary', async (c) => {
  const folderId = c.req.query('folder_id');
  if (!folderId) {
    return c.json({ message: 'folder_id is required' }, 400);
  }
  const rows = await db.select().from(useCases).where(eq(useCases.folderId, folderId));
  const items = await hydrateUseCases(rows);
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
  const rows = await db.select().from(useCases).where(eq(useCases.folderId, folderId));
  const items = await hydrateUseCases(rows);
  const mapped = items.map((item) => ({
    id: item.id,
    name: item.name,
    process: item.data.process,
    value_norm: item.totalValueScore ?? 0,
    ease: item.totalComplexityScore ? 100 - item.totalComplexityScore : 0,
    original_value: item.totalValueScore ?? 0,
    original_ease: item.totalComplexityScore ?? 0,
    value_scores: item.data.valueScores ?? [],
    complexity_scores: item.data.complexityScores ?? []
  }));
  return c.json({ items: mapped });
});

// Schéma pour la requête de synthèse exécutive
const executiveSummarySchema = z.object({
  folder_id: z.string(),
  value_threshold: z.number().optional().nullable(),
  complexity_threshold: z.number().optional().nullable(),
  model: z.string().optional()
});

analyticsRouter.post('/executive-summary', zValidator('json', executiveSummarySchema), async (c) => {
  try {
    const { folder_id, value_threshold, complexity_threshold, model } = c.req.valid('json');

    // Vérifier que le dossier existe
    const [folder] = await db.select().from(folders).where(eq(folders.id, folder_id));
    if (!folder) {
      return c.json({ message: 'Folder not found' }, 404);
    }

    // Récupérer le modèle par défaut si non fourni
    const aiSettings = await settingsService.getAISettings();
    const selectedModel = model || aiSettings.defaultModel;

    // Mettre à jour le statut du dossier à 'generating'
    await db.update(folders)
      .set({ status: 'generating' })
      .where(eq(folders.id, folder_id));

    // Ajouter le job à la queue
    const jobId = await queueManager.addJob('executive_summary', {
      folderId: folder_id,
      valueThreshold: value_threshold,
      complexityThreshold: complexity_threshold,
      model: selectedModel
    });

    return c.json({
      success: true,
      message: 'Génération de la synthèse exécutive démarrée',
      folder_id,
      jobId,
      status: 'generating'
    });
  } catch (error) {
    console.error('Error queuing executive summary generation:', error);
    
    // Gérer les erreurs spécifiques
    if (error instanceof Error) {
      if (error.message === 'Folder not found') {
        return c.json({ message: 'Folder not found' }, 404);
      }
    }
    
    return c.json({ 
      message: 'Error queuing executive summary generation',
      error: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
});
