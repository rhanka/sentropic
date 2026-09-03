import { Hono } from 'hono';
import { healthRouter } from './health';
import {
  adminRouter,
  tenantResolutionMetricsRouter,
} from '../namespaces/admin-product-authority';
import { requireAuth } from '../../middleware/auth';
import { requireRole, requireAdmin } from '../../middleware/rbac';

export const apiRouter = new Hono();

// Public routes (no authentication required)
apiRouter.route('/health', healthRouter);

// Tenant-resolution strict-cutover gate (available to both admin roles).
apiRouter.use('/admin/tenant-resolution-metrics/*', requireAuth, requireAdmin);
apiRouter.route('/admin/tenant-resolution-metrics', tenantResolutionMetricsRouter);

// Admin app only routes (require admin_app)
apiRouter.use('/admin/*', requireAuth, requireRole('admin_app'));
apiRouter.route('/admin', adminRouter);
