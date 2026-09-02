import { Hono } from 'hono';
import { healthRouter } from './health';
import { adminRouter, tenantResolutionMetricsRouter } from './admin';
import { chromeExtensionRouter } from './chrome-extension';
import { vscodeExtensionRouter } from './vscode-extension';
import { coworkDesktopRouter } from './cowork-desktop';
import { clientSettingsRouter } from './client-settings';
import { requireAuth } from '../../middleware/auth';
import { requireRole, requireAdmin } from '../../middleware/rbac';

export const apiRouter = new Hono();

// Public routes (no authentication required)
apiRouter.route('/health', healthRouter);

// Chrome extension metadata route for authenticated users.
apiRouter.use('/chrome-extension/*', requireAuth);
apiRouter.route('/chrome-extension', chromeExtensionRouter);

// VSCode extension metadata route for authenticated users.
apiRouter.use('/vscode-extension/*', requireAuth);
apiRouter.route('/vscode-extension', vscodeExtensionRouter);

// Cowork desktop binary metadata route for authenticated users.
apiRouter.use('/cowork-desktop/*', requireAuth);
apiRouter.route('/cowork-desktop', coworkDesktopRouter);

// Client bootstrap configuration remains with the future /clients extraction.
apiRouter.use('/settings/vscode-extension-token', requireAuth, requireAdmin);
apiRouter.route('/settings', clientSettingsRouter);

// Tenant-resolution strict-cutover gate (available to both admin roles).
apiRouter.use('/admin/tenant-resolution-metrics/*', requireAuth, requireAdmin);
apiRouter.route('/admin/tenant-resolution-metrics', tenantResolutionMetricsRouter);

// Admin app only routes (require admin_app)
apiRouter.use('/admin/*', requireAuth, requireRole('admin_app'));
apiRouter.route('/admin', adminRouter);
