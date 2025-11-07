import { Hono } from 'hono';
import { companiesRouter } from './companies';
import { foldersRouter } from './folders';
import { useCasesRouter } from './use-cases';
import { healthRouter } from './health';
import { settingsRouter } from './settings';
import { businessConfigRouter } from './business-config';
import { analyticsRouter } from './analytics';
import { adminRouter } from './admin';
import promptsRouter from './prompts';
import queueRouter from './queue';
import aiSettingsRouter from './ai-settings';
import { testRouter } from './test';
import { requireAuth } from '../../middleware/auth';
import { requireRole, requireAdmin, requireEditor } from '../../middleware/rbac';

export const apiRouter = new Hono();

// Public routes (no authentication required)
apiRouter.route('/health', healthRouter);
apiRouter.route('/test', testRouter);

// Editor routes (require editor role or higher)
apiRouter.use('/companies/*', requireAuth, requireEditor);
apiRouter.route('/companies', companiesRouter);

apiRouter.use('/folders/*', requireAuth, requireEditor);
apiRouter.route('/folders', foldersRouter);

apiRouter.use('/use-cases/*', requireAuth, requireEditor);
apiRouter.route('/use-cases', useCasesRouter);

apiRouter.use('/analytics/*', requireAuth, requireEditor);
apiRouter.route('/analytics', analyticsRouter);

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

apiRouter.use('/queue/*', requireAuth, requireRole('admin_app'));
apiRouter.route('/queue', queueRouter);
