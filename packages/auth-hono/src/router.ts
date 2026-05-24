import { Hono } from 'hono';

export interface CreateAuthRouterOptions {
  serviceName?: string;
}

export const createAuthRouter = (options: CreateAuthRouterOptions = {}): Hono => {
  const router = new Hono();
  const serviceName = options.serviceName ?? 'auth';

  router.get('/health', (c) => c.json({ status: 'ok', service: serviceName }));

  return router;
};
