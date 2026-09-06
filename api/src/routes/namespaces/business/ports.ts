import { Hono } from 'hono';

export interface BusinessRouterPort {
  createRouter(): Hono;
}

export interface BusinessNamespacePorts {
  readonly organizations: BusinessRouterPort;
  readonly folders: BusinessRouterPort;
  readonly initiatives: BusinessRouterPort;
  readonly solutions: BusinessRouterPort;
  readonly products: BusinessRouterPort;
  readonly proposals: BusinessRouterPort;
  readonly bids: BusinessRouterPort;
  readonly viewTemplates: BusinessRouterPort;
}

export const createInjectedBusinessRouter = (port: BusinessRouterPort): Hono => {
  const router = new Hono();
  router.route('/', port.createRouter());
  return router;
};
