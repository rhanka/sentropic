import type { Hono } from 'hono';

import { createInjectedBusinessRouter, type BusinessRouterPort } from './ports';

export const createProposalsBusinessRouter = (port: BusinessRouterPort): Hono =>
  createInjectedBusinessRouter(port);
