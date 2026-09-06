import { Hono } from 'hono';

export const CONFIG_ROUTES = [
  ['GET', '/settings'],
  ['PUT', '/settings'],
  ['GET', '/business-config'],
  ['PUT', '/business-config'],
  ['GET', '/ai-settings'],
  ['PUT', '/ai-settings'],
  ['GET', '/ai-settings/all'],
  ['GET', '/ai-settings/:key'],
  ['PUT', '/ai-settings/:key'],
  ['PATCH', '/me'],
] as const;

export const CONFIG_PATHS = [
  '/settings',
  '/business-config',
  '/ai-settings',
  '/ai-settings/all',
  '/ai-settings/:key',
  '/me',
] as const;

export const CONFIG_ADMIN_PATHS = CONFIG_PATHS.filter((path) => path !== '/me');

export interface ConfigRouterPort {
  createRouter(): Hono;
}

export interface ConfigNamespacePorts {
  readonly settings: ConfigRouterPort;
  readonly business: ConfigRouterPort;
  readonly ai: ConfigRouterPort;
  readonly workspace: ConfigRouterPort;
}

const assertConfigPorts = (ports: ConfigNamespacePorts): void => {
  if (!ports.settings?.createRouter
    || !ports.business?.createRouter
    || !ports.ai?.createRouter
    || !ports.workspace?.createRouter) {
    throw new Error('config product ports are unavailable');
  }
};

export const createConfigTransportRouter = (ports: ConfigNamespacePorts): Hono => {
  assertConfigPorts(ports);
  return new Hono()
    .route('/settings', ports.settings.createRouter())
    .route('/business-config', ports.business.createRouter())
    .route('/ai-settings', ports.ai.createRouter())
    .route('/me', ports.workspace.createRouter());
};
