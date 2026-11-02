import { Hono } from 'hono';
import { cmAdminIdentityRouter } from './admin-identity';
import { z } from 'zod';
import { zValidator } from '../../utils/zod-validator';
import { db } from '../../db/client';
import { folders, organizations, initiatives, workspaces } from '../../db/schema';
import { sql } from 'drizzle-orm';
import { getTenantResolutionMetrics } from '../../services/tenancy/tenant-resolution-metrics';
import { revokeAllSessions } from '../../services/session-manager';
import { remoteRevocationError } from '../../services/auth/remote-revocation-error';
import { findCmUserById, listCmUsers, updateCmUser } from '../../services/identity/cm-users';
import { cmStoreClient } from '../../services/identity/cm-identity';
import { deleteCmAccountAsAdmin } from '../../services/identity/cm-account-deletion';
import { runCmAccountDeletionHttp } from './auth/cm-deletion-http';

// Lot A4: the identity parts of this router run over the CM stores — user
// listing/approval/disable read and write cm_identity via the cm-users facade,
// and account deletion goes through the A2.3 atomic cascade. The legacy
// public.users / user_sessions / webauthn_* / magic_links tables are dropped
// by control migration 0014. Business-data endpoints (/reset, /stats) are
// unchanged.

export const adminRouter = new Hono();
adminRouter.onError(remoteRevocationError);
export const tenantResolutionMetricsRouter = new Hono();

tenantResolutionMetricsRouter.get('/', (c) => c.json(getTenantResolutionMetrics()));

const userRoleSchema = z.enum(['admin_app', 'admin_org', 'editor', 'guest']);
const userStatusSchema = z.enum([
  'active',
  'pending_admin_approval',
  'approval_expired_readonly',
  'disabled_by_user',
  'disabled_by_admin',
]);

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
