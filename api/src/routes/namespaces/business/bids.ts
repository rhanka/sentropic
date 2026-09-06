import type { Hono } from 'hono';

import { createInjectedBusinessRouter, type BusinessRouterPort } from './ports';

export const createBidsBusinessRouter = (port: BusinessRouterPort): Hono =>
  createInjectedBusinessRouter(port);
