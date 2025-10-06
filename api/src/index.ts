import { serve } from '@hono/node-server';
import { app } from './app';
import { env } from './config/env';
import { logger } from './logger';

const port = env.PORT;

serve({
  fetch: app.fetch,
  port
});

logger.info(`API server listening on http://0.0.0.0:${port}`);
