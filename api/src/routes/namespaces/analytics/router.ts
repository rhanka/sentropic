import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';

import type { AnalyticsNamespacePorts } from './ports';

export const ANALYTICS_PATHS = [
  '/analytics/summary',
  '/analytics/scatter',
  '/analytics/executive-summary',
] as const;

const executiveSummarySchema = z.object({
  folder_id: z.string(),
  value_threshold: z.number().optional().nullable(),
  complexity_threshold: z.number().optional().nullable(),
  model: z.string().optional(),
});

const assertAnalyticsPorts = (ports: AnalyticsNamespacePorts): void => {
  if (!ports.query?.folderExists
    || !ports.query.listItems
    || !ports.query.markFolderGenerating
    || !ports.queue?.enqueueExecutiveSummary
    || !ports.settings?.getDefaultModel
    || !ports.locale?.resolve) {
    throw new Error('analytics product ports are unavailable');
  }
};

export const createAnalyticsTransportRouter = (ports: AnalyticsNamespacePorts): Hono => {
  assertAnalyticsPorts(ports);
  const router = new Hono();

  router.get('/analytics/summary', async (context) => {
    const { workspaceId } = context.get('user') as { workspaceId: string };
    const folderId = context.req.query('folder_id');
    if (!folderId) return context.json({ message: 'folder_id is required' }, 400);
    if (!await ports.query.folderExists({ workspaceId, folderId })) {
      return context.json({ message: 'Folder not found' }, 404);
    }

    const items = await ports.query.listItems({ workspaceId, folderId });
    const totals = items.reduce(
      (result, item) => ({
        total: result.total + 1,
        value: result.value + item.valueScore,
        complexity: result.complexity + item.complexityScore,
      }),
      { total: 0, value: 0, complexity: 0 },
    );
    return context.json({
      total_use_cases: totals.total,
      avg_value: totals.total ? totals.value / totals.total : 0,
      avg_complexity: totals.total ? totals.complexity / totals.total : 0,
    });
  });

  router.get('/analytics/scatter', async (context) => {
    const { workspaceId } = context.get('user') as { workspaceId: string };
    const folderId = context.req.query('folder_id');
    if (!folderId) return context.json({ message: 'folder_id is required' }, 400);
    if (!await ports.query.folderExists({ workspaceId, folderId })) {
      return context.json({ message: 'Folder not found' }, 404);
    }

    const items = await ports.query.listItems({ workspaceId, folderId });
    return context.json({
      items: items.map((item) => ({
        id: item.id,
        name: item.name,
        process: item.process,
        value_norm: item.valueScore,
        ease: item.complexityScore ? 100 - item.complexityScore : 0,
        original_value: item.valueScore,
        original_ease: item.complexityScore,
        value_scores: item.valueScores,
        complexity_scores: item.complexityScores,
      })),
    });
  });

  router.post(
    '/analytics/executive-summary',
    zValidator('json', executiveSummarySchema),
    async (context) => {
      try {
        const { workspaceId, userId } = context.get('user') as {
          workspaceId: string;
          userId: string;
        };
        const input = context.req.valid('json');
        const locale = ports.locale.resolve({
          appLocaleHeader: context.req.header('x-app-locale'),
          acceptLanguageHeader: context.req.header('accept-language'),
        });
        if (!await ports.query.folderExists({ workspaceId, folderId: input.folder_id })) {
          return context.json({ message: 'Folder not found' }, 404);
        }

        const model = input.model || await ports.settings.getDefaultModel();
        await ports.query.markFolderGenerating({ workspaceId, folderId: input.folder_id });
        const jobId = await ports.queue.enqueueExecutiveSummary({
          workspaceId,
          userId,
          folderId: input.folder_id,
          valueThreshold: input.value_threshold,
          complexityThreshold: input.complexity_threshold,
          model,
          locale,
        });
        return context.json({
          success: true,
          message: 'Génération de la synthèse exécutive démarrée',
          folder_id: input.folder_id,
          jobId,
          status: 'generating',
        });
      } catch (error) {
        console.error('Error queuing executive summary generation:', error);
        return context.json({
          message: 'Error queuing executive summary generation',
          error: error instanceof Error ? error.message : 'Unknown error',
        }, 500);
      }
    },
  );

  return router;
};
