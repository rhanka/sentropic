import { Hono, type Context, type MiddlewareHandler } from 'hono';

export type ConnectorAdminPrincipal = {
  userId: string;
  workspaceId: string;
  role?: string;
};

export type ConnectorAdminHandlerInput = {
  context: Context;
  principal: ConnectorAdminPrincipal;
};

type ConnectorAdminHandler = (
  input: ConnectorAdminHandlerInput,
) => Response | Promise<Response>;

export type ConnectorAdminProviderAdapter = {
  /** Literal public prefix, for example `/google-drive`. */
  path: `/${string}`;
  readConnection: ConnectorAdminHandler;
  startOAuth: ConnectorAdminHandler;
  completeOAuth: ConnectorAdminHandler;
  disconnect: ConnectorAdminHandler;
  picker?: {
    readConfig: ConnectorAdminHandler;
    resolveSelection: ConnectorAdminHandler;
  };
};

export type ConnectorAccountLimitAdapter = {
  /** Literal public path for the account-limit setting. */
  path: `/${string}`;
  validateUpdate?: MiddlewareHandler;
  read: ConnectorAdminHandler;
  update: ConnectorAdminHandler;
};

export type CreateConnectorAdminRouterOptions = {
  resolvePrincipal(
    context: Context,
  ): ConnectorAdminPrincipal | undefined | Promise<ConnectorAdminPrincipal | undefined>;
  providers: readonly ConnectorAdminProviderAdapter[];
  accountLimits?: ConnectorAccountLimitAdapter;
};

const withPrincipal = (
  options: CreateConnectorAdminRouterOptions,
  handler: ConnectorAdminHandler,
) => async (context: Context): Promise<Response> => {
  const principal = await options.resolvePrincipal(context);
  if (!principal?.userId || !principal.workspaceId) {
    return context.json({ message: 'Authentication required' }, 401);
  }
  return handler({ context, principal });
};

const assertUniqueLiteralPaths = (options: CreateConnectorAdminRouterOptions): void => {
  const paths = [
    ...options.providers.map(({ path }) => path),
    ...(options.accountLimits ? [options.accountLimits.path] : []),
  ];
  if (new Set(paths).size !== paths.length || paths.some((path) => path.includes('*'))) {
    throw new Error('connector administration paths must be unique and literal');
  }
};

/**
 * Builds the provider-account administration surface from injected product ports.
 *
 * Provider execution, codecs and secret resolution remain behind connector-host
 * services. This transport factory never receives a credential or provider client.
 */
export const createConnectorAdminRouter = (
  options: CreateConnectorAdminRouterOptions,
): Hono => {
  assertUniqueLiteralPaths(options);
  const router = new Hono();

  for (const provider of options.providers) {
    const providerRouter = new Hono();
    providerRouter.get('/connection', withPrincipal(options, provider.readConnection));
    providerRouter.post('/oauth/start', withPrincipal(options, provider.startOAuth));
    providerRouter.get('/oauth/callback', withPrincipal(options, provider.completeOAuth));
    providerRouter.post('/disconnect', withPrincipal(options, provider.disconnect));
    if (provider.picker) {
      providerRouter.get('/picker-config', withPrincipal(options, provider.picker.readConfig));
      providerRouter.post(
        '/files/resolve-picker-selection',
        withPrincipal(options, provider.picker.resolveSelection),
      );
    }
    router.route(provider.path, providerRouter);
  }

  if (options.accountLimits) {
    router.get(
      options.accountLimits.path,
      withPrincipal(options, options.accountLimits.read),
    );
    const update = withPrincipal(options, options.accountLimits.update);
    if (options.accountLimits.validateUpdate) {
      router.put(options.accountLimits.path, options.accountLimits.validateUpdate, update);
    } else {
      router.put(options.accountLimits.path, update);
    }
  }

  return router;
};
