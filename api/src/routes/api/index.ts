import { Hono } from 'hono';
import { organizationsRouter } from './organizations';
import { foldersRouter } from './folders';
import { useCasesRouter } from './use-cases';
import { healthRouter } from './health';
import { settingsRouter } from './settings';
import { businessConfigRouter } from './business-config';
import { analyticsRouter } from './analytics';
import { adminRouter } from './admin';
import { meRouter } from './me';
import { streamsRouter } from './streams';
import { chatRouter } from './chat';
import { documentsRouter } from './documents';
import promptsRouter from './prompts';
import queueRouter from './queue';
import aiSettingsRouter from './ai-settings';
import { workspacesRouter } from './workspaces';
import { locksRouter } from './locks';
import { commentsRouter } from './comments';
import { exportsRouter, importsRouter } from './import-export';
import { docxRouter } from './docx';
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

apiRouter.use('/use-cases/*', requireAuth);
apiRouter.route('/use-cases', useCasesRouter);

// DOCX export routes (nested under /use-cases, shares auth middleware above)
apiRouter.use('/docx/*', requireAuth);
apiRouter.route('/', docxRouter);

apiRouter.use('/analytics/*', requireAuth);
apiRouter.route('/analytics', analyticsRouter);

// User self-service routes
apiRouter.use('/me/*', requireAuth);
apiRouter.route('/me', meRouter);

// Workspace routes (authenticated; role checks are enforced per endpoint)
apiRouter.use('/workspaces/*', requireAuth);
apiRouter.route('/workspaces', workspacesRouter);

// Locks (authenticated; read is allowed, mutations require workspace editor/admin)
apiRouter.use('/locks/*', requireAuth);
apiRouter.route('/locks', locksRouter);

// Streaming routes: read-only for users; allow any authenticated user.
apiRouter.use('/streams/*', requireAuth);
apiRouter.route('/streams', streamsRouter);

// Chat routes: allow reads for any authenticated user. Mutations are gated inside the router by workspace role.
apiRouter.use('/chat/*', requireAuth);
apiRouter.route('/chat', chatRouter);

// Documents routes: allow reads for any authenticated user. Upload/delete are gated inside the router by workspace role.
apiRouter.use('/documents/*', requireAuth);
apiRouter.route('/documents', documentsRouter);

// Comments routes: allow reads for any authenticated user. Mutations are gated inside the router by workspace role.
apiRouter.use('/comments/*', requireAuth);
apiRouter.route('/comments', commentsRouter);

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

apiRouter.use('/prompts/*', requireAuth, requireAdmin);
apiRouter.route('/prompts', promptsRouter);

apiRouter.use('/ai-settings/*', requireAuth, requireAdmin);
apiRouter.route('/ai-settings', aiSettingsRouter);

// Admin app only routes (require admin_app)
apiRouter.use('/admin/*', requireAuth, requireRole('admin_app'));
apiRouter.route('/admin', adminRouter);

// Queue monitoring is workspace-scoped and available to authenticated users.
// Destructive actions remain admin-only at the router level.
apiRouter.use('/queue/*', requireAuth);
apiRouter.route('/queue', queueRouter);
