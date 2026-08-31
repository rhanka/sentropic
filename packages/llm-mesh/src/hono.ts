import { Hono, type Context } from 'hono';

export interface LlmMeshHttpPrincipal {
  readonly userId: string;
  readonly role?: string;
}

export interface LlmMeshPortRequest {
  readonly principal: LlmMeshHttpPrincipal;
  readonly request: Request;
}

export interface LlmMeshCatalogPort {
  readCatalog(input: LlmMeshPortRequest): Promise<Response>;
  readUserSettings(input: LlmMeshPortRequest): Promise<Response>;
  updateUserSettings(input: LlmMeshPortRequest): Promise<Response>;
}

export interface LlmMeshPoolPort {
  readAvailability(input: LlmMeshPortRequest): Promise<Response>;
  readConnections(input: LlmMeshPortRequest): Promise<Response>;
  updateTransportMode(input: LlmMeshPortRequest & { readonly providerId: string }): Promise<Response>;
}

export interface LlmMeshEnrollmentPort {
  handle(input: LlmMeshPortRequest & {
    readonly providerId: string;
    readonly action: string;
  }): Promise<Response>;
}

export interface CreateLlmMeshRouterOptions {
  readonly resolvePrincipal: (
    context: Context,
  ) => LlmMeshHttpPrincipal | undefined | Promise<LlmMeshHttpPrincipal | undefined>;
  readonly catalog: LlmMeshCatalogPort;
  readonly pool: LlmMeshPoolPort;
  readonly enrollment: LlmMeshEnrollmentPort;
}

const requestFor = async (context: Context, options: CreateLlmMeshRouterOptions) => {
  try {
    const principal = await options.resolvePrincipal(context);
    return principal ? { principal, request: context.req.raw } : undefined;
  } catch {
    return undefined;
  }
};

const dispatch = async (
  context: Context,
  options: CreateLlmMeshRouterOptions,
  handler: (input: LlmMeshPortRequest) => Promise<Response>,
): Promise<Response> => {
  const input = await requestFor(context, options);
  if (!input) return context.json({ error: 'Authentication required' }, 401);
  return handler(input);
};

export const createLlmMeshRouter = (options: CreateLlmMeshRouterOptions): Hono => {
  const router = new Hono();

  router.get('/models/catalog', (c) => dispatch(c, options, options.catalog.readCatalog.bind(options.catalog)));
  router.get('/models/provider-readiness', (c) => dispatch(c, options, options.pool.readAvailability.bind(options.pool)));
  router.get('/me/ai-settings', (c) => dispatch(c, options, options.catalog.readUserSettings.bind(options.catalog)));
  router.put('/me/ai-settings', (c) => dispatch(c, options, options.catalog.updateUserSettings.bind(options.catalog)));
  router.get('/provider-connections', (c) => dispatch(c, options, options.pool.readConnections.bind(options.pool)));
  router.post('/provider-connections/openai/mode', (c) => dispatch(
    c,
    options,
    (input) => options.pool.updateTransportMode({ ...input, providerId: 'openai' }),
  ));
  router.post('/provider-connections/:providerId/enrollment/:action', (c) => dispatch(
    c,
    options,
    (input) => options.enrollment.handle({
      ...input,
      providerId: c.req.param('providerId'),
      action: c.req.param('action'),
    }),
  ));

  return router;
};
