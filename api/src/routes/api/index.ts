import { Hono } from 'hono';
import { companiesRouter } from './companies';
import { foldersRouter } from './folders';
import { useCasesRouter } from './use-cases';
import { healthRouter } from './health';
import { settingsRouter } from './settings';
import { businessConfigRouter } from './business-config';
import { analyticsRouter } from './analytics';

export const apiRouter = new Hono();

apiRouter.route('/health', healthRouter);
apiRouter.route('/companies', companiesRouter);
apiRouter.route('/folders', foldersRouter);
apiRouter.route('/use-cases', useCasesRouter);
apiRouter.route('/settings', settingsRouter);
apiRouter.route('/business-config', businessConfigRouter);
apiRouter.route('/analytics', analyticsRouter);
