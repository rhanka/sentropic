import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { z } from 'zod';

export const APP_ROUTES = [
  ['GET', '/apps/templates'],
  ['POST', '/apps/templates'],
  ['GET', '/apps/templates/:id'],
  ['PATCH', '/apps/templates/:id'],
  ['POST', '/apps/templates/:id/publish'],
  ['POST', '/apps/templates/:id/deprecate'],
  ['GET', '/apps/instances'],
  ['POST', '/apps/instances'],
  ['GET', '/apps/instances/:id'],
  ['POST', '/apps/instances/:id/transition'],
] as const;

export const APP_PATHS = [...new Set(APP_ROUTES.map(([, path]) => path))];

const templateInput = z.object({
  familyId: z.string().min(1).optional(),
  appSlug: z.string().min(1),
  version: z.string().min(1),
  blueprint: z.record(z.string(), z.unknown()),
  blueprintSchemaVersion: z.number().int().positive().optional(),
});
const draftPatch = z.object({
  blueprint: z.record(z.string(), z.unknown()).optional(),
  blueprintSchemaVersion: z.number().int().positive().optional(),
}).refine((value) => value.blueprint !== undefined || value.blueprintSchemaVersion !== undefined);
const templateFilter = z.object({
  familyId: z.string().min(1).optional(),
  appSlug: z.string().min(1).optional(),
  status: z.enum(['draft', 'published', 'deprecated']).optional(),
});
const instanceInput = z.object({
  templateFamilyId: z.string().min(1),
  templateVersion: z.string().min(1),
  tenantId: z.string().min(1),
  environment: z.enum(['prod', 'preview', 'local']).optional(),
  desiredState: z.unknown().optional(),
});
const instanceFilter = z.object({
  tenantId: z.string().min(1).optional(),
  templateFamilyId: z.string().min(1).optional(),
});
const transitionInput = z.object({
  status: z.enum(['provisioning', 'active', 'suspended', 'retired']),
});

export interface AppsControlPlanePort {
  createTemplate(input: z.infer<typeof templateInput>): Promise<unknown>;
  updateDraft(id: string, patch: z.infer<typeof draftPatch>): Promise<unknown>;
  publishTemplate(id: string): Promise<unknown>;
  deprecateTemplate(id: string): Promise<unknown>;
  getTemplate(id: string): Promise<unknown | null>;
  listTemplates(filter?: z.infer<typeof templateFilter>): Promise<unknown[]>;
  createInstance(input: z.infer<typeof instanceInput>): Promise<unknown>;
  transitionInstance(id: string, status: z.infer<typeof transitionInput>['status']): Promise<unknown>;
  getInstance(id: string): Promise<unknown | null>;
  listInstances(filter?: z.infer<typeof instanceFilter>): Promise<unknown[]>;
}

export interface AppsHttpError {
  readonly status: 400 | 404 | 409 | 500;
  readonly error: string;
}

export interface AppsNamespacePorts {
  readonly controlPlane: AppsControlPlanePort;
  readonly authenticate: MiddlewareHandler;
  readonly authorizeAdminApp: MiddlewareHandler;
  mapError(error: unknown): AppsHttpError;
}

export const assertAppsPorts = (ports: AppsNamespacePorts): void => {
  if (!ports.controlPlane || !ports.authenticate || !ports.authorizeAdminApp || !ports.mapError) {
    throw new Error('apps product ports are unavailable');
  }
};

const respond = async (
  context: Context,
  ports: AppsNamespacePorts,
  action: () => Promise<unknown>,
  collection = false,
  created = false,
) => {
  try {
    const value = await action();
    return context.json(collection ? { items: value } : { item: value }, created ? 201 : 200);
  } catch (error) {
    const mapped = ports.mapError(error);
    return context.json({ error: mapped.error }, mapped.status);
  }
};

export const createAppsTransportRouter = (ports: AppsNamespacePorts): Hono => {
  assertAppsPorts(ports);
  const router = new Hono();
  router.get('/apps/templates', (c) => respond(c, ports, () =>
    ports.controlPlane.listTemplates(templateFilter.parse(c.req.query())), true));
  router.post('/apps/templates', (c) => respond(c, ports, async () =>
    ports.controlPlane.createTemplate(templateInput.parse(await c.req.json())), false, true));
  router.get('/apps/templates/:id', (c) => respond(c, ports, async () => {
    const item = await ports.controlPlane.getTemplate(c.req.param('id'));
    if (item === null) throw new Error('app_template_not_found');
    return item;
  }));
  router.patch('/apps/templates/:id', (c) => respond(c, ports, async () =>
    ports.controlPlane.updateDraft(c.req.param('id'), draftPatch.parse(await c.req.json()))));
  router.post('/apps/templates/:id/publish', (c) => respond(c, ports, () =>
    ports.controlPlane.publishTemplate(c.req.param('id'))));
  router.post('/apps/templates/:id/deprecate', (c) => respond(c, ports, () =>
    ports.controlPlane.deprecateTemplate(c.req.param('id'))));
  router.get('/apps/instances', (c) => respond(c, ports, () =>
    ports.controlPlane.listInstances(instanceFilter.parse(c.req.query())), true));
  router.post('/apps/instances', (c) => respond(c, ports, async () =>
    ports.controlPlane.createInstance(instanceInput.parse(await c.req.json())), false, true));
  router.get('/apps/instances/:id', (c) => respond(c, ports, async () => {
    const item = await ports.controlPlane.getInstance(c.req.param('id'));
    if (item === null) throw new Error('app_instance_not_found');
    return item;
  }));
  router.post('/apps/instances/:id/transition', (c) => respond(c, ports, async () => {
    const { status } = transitionInput.parse(await c.req.json());
    return ports.controlPlane.transitionInstance(c.req.param('id'), status);
  }));
  return router;
};
