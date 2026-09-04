import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { z } from 'zod';

export const RESOURCE_ROUTES = [
  ['POST', '/resources/list'],
  ['POST', '/resources/stat'],
  ['POST', '/resources/read'],
  ['POST', '/resources/grep'],
  ['POST', '/resources/edit'],
  ['POST', '/resources/invoke'],
] as const;
export const RESOURCE_PATHS = RESOURCE_ROUTES.map(([, path]) => path);
export type ResourceHttpVerb = (typeof RESOURCE_ROUTES)[number][1] extends `/resources/${infer V}` ? V : never;

const ref = z.object({
  provider: z.string().min(1),
  type: z.string().min(1),
  id: z.string(),
  etag: z.string().min(1).optional(),
}).strict();
const targetShape = {
  path: z.string().startsWith('/').optional(),
  ref: ref.optional(),
};
const withTarget = <T extends z.ZodRawShape>(shape: T) => z.object({
  ...targetShape,
  ...shape,
}).strict().refine((value) => (value.path === undefined) !== (value.ref === undefined));
const schemas = {
  list: withTarget({
    limit: z.number().int().positive().optional(),
    pageToken: z.string().min(1).optional(),
    maxDepth: z.number().int().nonnegative().optional(),
  }),
  stat: withTarget({}),
  read: withTarget({ maxBytes: z.number().int().positive().optional() }),
  grep: withTarget({ query: z.string().trim().min(1), limit: z.number().int().positive().optional() }),
  edit: withTarget({
    etag: z.string().min(1).optional(),
    content: z.string(),
    contentType: z.string().min(1).optional(),
  }),
  invoke: withTarget({
    args: z.record(z.string(), z.unknown()),
    idempotencyKey: z.string().min(1).optional(),
  }),
} as const;

export interface ResourceHttpPrincipal {
  readonly userId: string;
  readonly scope: { readonly tenantId: string; readonly workspaceId: string };
  readonly context: {
    readonly userId: string;
    readonly role: string;
    readonly workspaceType?: string;
    readonly roles: readonly string[];
    readonly permissions: readonly string[];
    readonly permissionMode: 'allowlist' | 'open';
    readonly allowedTools: readonly string[];
  };
}

export interface ResourceProjectionPort {
  dispatch(input: {
    readonly verb: ResourceHttpVerb;
    readonly target: { readonly path?: string; readonly ref?: z.infer<typeof ref> };
    readonly args: Record<string, unknown>;
    readonly principal: ResourceHttpPrincipal;
  }): Promise<unknown>;
}

export interface ResourcesNamespacePorts {
  readonly resources: ResourceProjectionPort;
  readonly principal: { resolve(context: Context): Promise<ResourceHttpPrincipal | null> };
  readonly authenticate: MiddlewareHandler;
}

export const assertResourcesPorts = (ports: ResourcesNamespacePorts): void => {
  if (!ports.resources || !ports.principal || !ports.authenticate) {
    throw new Error('resources product ports are unavailable');
  }
};

const errorStatus = (error: unknown): 400 | 403 | 404 | 409 | 413 | 422 | 500 | 503 => {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
  if (code === 'not_found') return 404;
  if (code === 'denied') return 403;
  if (code === 'provider_unavailable') return 503;
  if (code === 'cas_conflict' || code === 'ambiguous_alias') return 409;
  if (code === 'too_large') return 413;
  if (code === 'not_searchable' || code === 'unsupported') return 422;
  if (code === 'invalid_args' || error instanceof z.ZodError || error instanceof SyntaxError) return 400;
  return 500;
};

const handle = async (context: Context, ports: ResourcesNamespacePorts, verb: ResourceHttpVerb) => {
  try {
    const parsed = schemas[verb].parse(await context.req.json());
    const principal = await ports.principal.resolve(context);
    if (!principal) return context.json({ error: 'resource_not_found' }, 404);
    const { path, ref: parsedRef, ...args } = parsed;
    const result = await ports.resources.dispatch({
      verb,
      target: path === undefined ? { ref: parsedRef } : { path },
      args,
      principal,
    });
    return context.json({ result });
  } catch (error) {
    const status = errorStatus(error);
    return context.json({ error: status === 500 ? 'resource_dispatch_unavailable' : 'resource_request_refused' }, status);
  }
};

export const createResourcesTransportRouter = (ports: ResourcesNamespacePorts): Hono => {
  assertResourcesPorts(ports);
  const router = new Hono();
  for (const [, path] of RESOURCE_ROUTES) {
    const verb = path.slice('/resources/'.length) as ResourceHttpVerb;
    router.post(path, (context) => handle(context, ports, verb));
  }
  return router;
};
