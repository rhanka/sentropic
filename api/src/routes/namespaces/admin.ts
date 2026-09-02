import { Hono, type MiddlewareHandler } from 'hono';

export const ADMIN_ROUTES = [
  ['POST', '/admin/reset'],
  ['GET', '/admin/stats'],
  ['GET', '/admin/users'],
  ['POST', '/admin/users/:id/approve'],
  ['POST', '/admin/users/:id/disable'],
  ['POST', '/admin/users/:id/reactivate'],
  ['DELETE', '/admin/users/:id'],
  ['GET', '/admin/tenant-resolution-metrics'],
] as const;

export const ADMIN_PATHS = [...new Set(ADMIN_ROUTES.map(([, path]) => path))];
export const ADMIN_APP_ROUTES = ADMIN_ROUTES.filter(
  ([, path]) => path !== '/admin/tenant-resolution-metrics',
);
export const ADMIN_APP_PATHS = [...new Set(ADMIN_APP_ROUTES.map(([, path]) => path))];
export const ADMIN_TENANT_METRICS_PATHS = ['/admin/tenant-resolution-metrics'] as const;

export interface AdminRouterPort {
  createRouter(): Hono;
}

export interface AdminNamespacePorts {
  readonly admin: AdminRouterPort;
  readonly tenantMetrics: AdminRouterPort;
  readonly authenticate: MiddlewareHandler;
  readonly authorizeAdmin: MiddlewareHandler;
  readonly authorizeAppAdmin: MiddlewareHandler;
}

export const assertAdminPorts = (ports: AdminNamespacePorts): void => {
  if (!ports.admin?.createRouter
    || !ports.tenantMetrics?.createRouter
    || !ports.authenticate
    || !ports.authorizeAdmin
    || !ports.authorizeAppAdmin) {
    throw new Error('admin product ports are unavailable');
  }
};

export const createAdminTransportRouter = (ports: AdminNamespacePorts): Hono => {
  assertAdminPorts(ports);
  return new Hono()
    .route('/admin/tenant-resolution-metrics', ports.tenantMetrics.createRouter())
    .route('/admin', ports.admin.createRouter());
};
