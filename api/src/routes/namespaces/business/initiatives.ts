import type { Hono } from 'hono';

import { createInjectedBusinessRouter, type BusinessRouterPort } from './ports';

export const createInitiativesBusinessRouter = (port: BusinessRouterPort): Hono =>
  createInjectedBusinessRouter(port);
