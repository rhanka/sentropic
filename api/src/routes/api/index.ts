import { Hono } from 'hono';
import { companiesRouter } from './companies';
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
import promptsRouter from './prompts';
import queueRouter from './queue';
import aiSettingsRouter from './ai-settings';
import { requireAuth } from '../../middleware/auth';
import { requireRole, requireAdmin, requireEditor } from '../../middleware/rbac';

export const apiRouter = new Hono();

// Public routes (no authentication required)
apiRouter.route('/health', healthRouter);

// Editor routes (require editor role or higher)
apiRouter.use('/companies/*', requireAuth);
apiRouter.route('/companies', companiesRouter);

// New naming (preferred)
apiRouter.use('/organizations/*', requireAuth);
apiRouter.route('/organizations', organizationsRouter);

apiRouter.use('/folders/*', requireAuth);
apiRouter.route('/folders', foldersRouter);

apiRouter.use('/use-cases/*', requireAuth);
apiRouter.route('/use-cases', useCasesRouter);

apiRouter.use('/analytics/*', requireAuth);
apiRouter.route('/analytics', analyticsRouter);

// User self-service routes
apiRouter.use('/me/*', requireAuth);
apiRouter.route('/me', meRouter);

// Streaming routes (require editor role or higher)
apiRouter.use('/streams/*', requireAuth, requireEditor);
apiRouter.route('/streams', streamsRouter);

// Chat routes (require editor role or higher)
apiRouter.use('/chat/*', requireAuth, requireEditor);
apiRouter.route('/chat', chatRouter);

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
