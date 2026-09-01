import type { Hono } from 'hono';

import { createInjectedBusinessRouter, type BusinessRouterPort } from './ports';

export const createFoldersBusinessRouter = (port: BusinessRouterPort): Hono =>
  createInjectedBusinessRouter(port);
