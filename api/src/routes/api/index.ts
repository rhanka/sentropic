import { Hono } from 'hono';
import { organizationsRouter } from './organizations';
import { foldersRouter } from './folders';
import { initiativesRouter } from './initiatives';
import { healthRouter } from './health';
import { settingsRouter } from './settings';
import { businessConfigRouter } from './business-config';
import { analyticsRouter } from './analytics';
import { adminRouter, tenantResolutionMetricsRouter } from './admin';
import { tenantsRouter } from './tenants';
import { meRouter } from './me';
import { documentsRouter } from './documents';
import aiSettingsRouter from './ai-settings';
import { workspacesRouter } from './workspaces';
import { neutralRouter } from './neutral';
import { locksRouter } from './locks';
import { exportsRouter, importsRouter } from './import-export';
import { docxRouter } from './docx';
import { pptxRouter } from './pptx';
import { xlsxRouter } from './xlsx';
import { chromeExtensionRouter } from './chrome-extension';
import { vscodeExtensionRouter } from './vscode-extension';
import { coworkDesktopRouter } from './cowork-desktop';
import { solutionsRouter } from './solutions';
import { productsRouter } from './products';
import { bidsRouter } from './bids';
import { proposalsRouter } from './proposals';
import { viewTemplatesRouter } from './view-templates';
import { requireAuth } from '../../middleware/auth';
import { requireRole, requireAdmin } from '../../middleware/rbac';

export const apiRouter = new Hono();

// Public routes (no authentication required)
apiRouter.route('/health', healthRouter);

// Editor routes (require editor role or higher)
apiRouter.use('/organizations/*', requireAuth);
apiRouter.route('/organizations', organizationsRouter);

apiRouter.use('/folders/*', requireAuth);
apiRouter.route('/folders', foldersRouter);

apiRouter.use('/initiatives/*', requireAuth);
apiRouter.route('/initiatives', initiativesRouter);

// Backward-compatible alias: /use-cases/* → /initiatives/*
apiRouter.use('/use-cases/*', requireAuth);
apiRouter.route('/use-cases', initiativesRouter);

// Extended business objects (BR-04 Lot 6)
apiRouter.use('/solutions/*', requireAuth);
apiRouter.route('/solutions', solutionsRouter);

apiRouter.use('/products/*', requireAuth);
apiRouter.route('/products', productsRouter);

apiRouter.use('/proposals/*', requireAuth);
apiRouter.route('/proposals', proposalsRouter);

// Backward-compatible alias: /bids/* -> /proposals/*
apiRouter.use('/bids/*', requireAuth);
apiRouter.route('/bids', bidsRouter);

// View templates (authenticated; workspace role checks per endpoint)
apiRouter.use('/view-templates/*', requireAuth);
apiRouter.route('/view-templates', viewTemplatesRouter);

// DOCX export routes
apiRouter.use('/docx/*', requireAuth);
apiRouter.route('/', docxRouter);

// PPTX export routes (BR-21a: generated via chat tool)
apiRouter.use('/pptx/*', requireAuth);
apiRouter.route('/', pptxRouter);

// XLSX export routes (BR-40c: async folder multi-tab workbook)
apiRouter.use('/xlsx/*', requireAuth);
apiRouter.route('/', xlsxRouter);

apiRouter.use('/analytics/*', requireAuth);
apiRouter.route('/analytics', analyticsRouter);

// User self-service routes
apiRouter.use('/me/*', requireAuth);
apiRouter.route('/me', meRouter);

// Chrome extension metadata route for authenticated users.
apiRouter.use('/chrome-extension/*', requireAuth);
apiRouter.route('/chrome-extension', chromeExtensionRouter);

// VSCode extension metadata route for authenticated users.
apiRouter.use('/vscode-extension/*', requireAuth);
apiRouter.route('/vscode-extension', vscodeExtensionRouter);

// Cowork desktop binary metadata route for authenticated users.
apiRouter.use('/cowork-desktop/*', requireAuth);
apiRouter.route('/cowork-desktop', coworkDesktopRouter);

// Workspace routes (authenticated; role checks are enforced per endpoint)
apiRouter.use('/workspaces/*', requireAuth);
apiRouter.route('/workspaces', workspacesRouter);

// Neutral orchestrator routes (authenticated; workspace-agnostic dashboard)
apiRouter.use('/neutral/*', requireAuth);
apiRouter.route('/neutral', neutralRouter);

// Locks (authenticated; read is allowed, mutations require workspace editor/admin)
apiRouter.use('/locks/*', requireAuth);
apiRouter.route('/locks', locksRouter);

// Documents routes: allow reads for any authenticated user. Upload/delete are gated inside the router by workspace role.
apiRouter.use('/documents/*', requireAuth);
apiRouter.route('/documents', documentsRouter);

// Import/Export routes: authenticated, role checks enforced per endpoint.
apiRouter.use('/exports/*', requireAuth);
apiRouter.route('/exports', exportsRouter);
apiRouter.use('/imports/*', requireAuth);
apiRouter.route('/imports', importsRouter);

// Admin routes (require admin_org or admin_app)
apiRouter.use('/settings/*', requireAuth, requireAdmin);
apiRouter.route('/settings', settingsRouter);

apiRouter.use('/business-config/*', requireAuth, requireAdmin);
apiRouter.route('/business-config', businessConfigRouter);

apiRouter.use('/ai-settings/*', requireAuth, requireAdmin);
apiRouter.route('/ai-settings', aiSettingsRouter);

// Tenant-resolution strict-cutover gate (available to both admin roles).
apiRouter.use('/admin/tenant-resolution-metrics/*', requireAuth, requireAdmin);
apiRouter.route('/admin/tenant-resolution-metrics', tenantResolutionMetricsRouter);

// Admin app only routes (require admin_app)
apiRouter.use('/admin/*', requireAuth, requireRole('admin_app'));
apiRouter.route('/admin', adminRouter);

// BR-39e: tenant membership acceptance. Authenticated for all endpoints; tenant-scoped
// authorization (approve/reject/suspend/list) is enforced inside the service per path tenant.
apiRouter.use('/tenants/*', requireAuth);
apiRouter.route('/tenants', tenantsRouter);
