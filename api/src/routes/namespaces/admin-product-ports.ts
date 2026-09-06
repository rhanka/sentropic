import { requireAuth } from '../../middleware/auth';
import { requireAdmin, requireRole } from '../../middleware/rbac';
import {
  adminRouter,
  tenantResolutionMetricsRouter,
} from './admin-product-authority';
import type { AdminNamespacePorts } from './admin';

export const requireAdminApp = requireRole('admin_app');

export const productAdminPorts: AdminNamespacePorts = {
  admin: { createRouter: () => adminRouter },
  tenantMetrics: { createRouter: () => tenantResolutionMetricsRouter },
  authenticate: requireAuth,
  authorizeAdmin: requireAdmin,
  authorizeAppAdmin: requireAdminApp,
};
