import { Hono } from 'hono';
import { healthRouter } from './health';

export const apiRouter = new Hono();

// Public routes (no authentication required)
apiRouter.route('/health', healthRouter);
