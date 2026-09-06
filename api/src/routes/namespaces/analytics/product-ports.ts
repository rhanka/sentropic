import { and, eq } from 'drizzle-orm';

import { db } from '../../../db/client';
import { folders, initiatives } from '../../../db/schema';
import { hydrateInitiatives } from '../../../services/business/initiatives';
import { queueManager } from '../../../services/queue-manager';
import { settingsService } from '../../../services/settings';
import { resolveLocaleFromHeaders } from '../../../utils/locale';
import type { AnalyticsNamespacePorts } from './ports';

export const productAnalyticsPorts: AnalyticsNamespacePorts = {
  query: {
    async folderExists({ workspaceId, folderId }) {
      const [folder] = await db
        .select({ id: folders.id })
        .from(folders)
        .where(and(eq(folders.id, folderId), eq(folders.workspaceId, workspaceId)))
        .limit(1);
      return folder !== undefined;
    },
    async listItems({ workspaceId, folderId }) {
      const rows = await db
        .select()
        .from(initiatives)
        .where(and(
          eq(initiatives.workspaceId, workspaceId),
          eq(initiatives.folderId, folderId),
        ));
      const items = await hydrateInitiatives(rows);
      return items.map((item) => ({
        id: item.id,
        name: item.data.name,
        process: item.data.process,
        valueScore: item.totalValueScore ?? 0,
        complexityScore: item.totalComplexityScore ?? 0,
        valueScores: item.data.valueScores ?? [],
        complexityScores: item.data.complexityScores ?? [],
      }));
    },
    async markFolderGenerating({ workspaceId, folderId }) {
      await db
        .update(folders)
        .set({ status: 'generating' })
        .where(and(eq(folders.id, folderId), eq(folders.workspaceId, workspaceId)));
    },
  },
  queue: {
    enqueueExecutiveSummary(input) {
      return queueManager.addJob('executive_summary', {
        folderId: input.folderId,
        valueThreshold: input.valueThreshold,
        complexityThreshold: input.complexityThreshold,
        model: input.model,
        initiatedByUserId: input.userId,
        locale: input.locale,
      }, { workspaceId: input.workspaceId });
    },
  },
  settings: {
    async getDefaultModel() {
      return (await settingsService.getAISettings()).defaultModel;
    },
  },
  locale: {
    resolve: resolveLocaleFromHeaders,
  },
};
