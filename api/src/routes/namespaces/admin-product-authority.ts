import { Hono } from 'hono';
import { cmAdminIdentityRouter } from './admin-identity';
import { db } from '../../db/client';
import { folders, organizations, initiatives, workspaces } from '../../db/schema';
import { sql } from 'drizzle-orm';
import { getTenantResolutionMetrics } from '../../services/tenancy/tenant-resolution-metrics';

export const adminRouter = new Hono();
export const tenantResolutionMetricsRouter = new Hono();

tenantResolutionMetricsRouter.get('/', (c) => c.json(getTenantResolutionMetrics()));

adminRouter.post('/reset', async (c) => {
  try {
    // Supprimer toutes les données dans l'ordre inverse des dépendances
    await db.delete(initiatives);
    await db.delete(folders);
    await db.delete(organizations);

    return c.json({
      message: 'All data has been reset successfully',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error resetting data:', error);
    return c.json(
      {
        message: 'Failed to reset data',
        error: error instanceof Error ? error.message : 'Unknown error'
      },
      500
    );
  }
});

adminRouter.get('/stats', async (c) => {
  try {
    const [organizationsCount] = await db.select({ count: sql`count(*)` }).from(organizations);
    const [foldersCount] = await db.select({ count: sql`count(*)` }).from(folders);
    const [initiativesCount] = await db.select({ count: sql`count(*)` }).from(initiatives);

    return c.json({
      organizations: organizationsCount.count,
      folders: foldersCount.count,
      initiatives: initiativesCount.count,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error getting stats:', error);
    return c.json(
      {
        message: 'Failed to get statistics',
        error: error instanceof Error ? error.message : 'Unknown error'
      },
      500
    );
  }
});

adminRouter.route('/', cmAdminIdentityRouter);
