import type { Hono } from 'hono';

import { createInjectedBusinessRouter, type BusinessRouterPort } from './ports';

export const createViewTemplatesBusinessRouter = (port: BusinessRouterPort): Hono =>
  createInjectedBusinessRouter(port);
