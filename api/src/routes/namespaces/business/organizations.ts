import type { Hono } from 'hono';

import { createInjectedBusinessRouter, type BusinessRouterPort } from './ports';

export const createOrganizationsBusinessRouter = (port: BusinessRouterPort): Hono =>
  createInjectedBusinessRouter(port);
