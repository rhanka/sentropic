import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { z } from 'zod';
import type { CatalogRequestContext } from '../../services/catalog/request-context';

export const CATALOG_ROUTES = [
  ['GET', '/catalog/entries'],
  ['GET', '/catalog/entries/:name'],
  ['GET', '/catalog/search'],
  ['GET', '/catalog/sources'],
] as const;

export const CATALOG_PATHS = [...new Set(CATALOG_ROUTES.map(([, path]) => path))];

export type CatalogKind = 'skill' | 'tool' | 'agent' | 'workflow' | 'canvas';

export interface CatalogEntryProjection {
  readonly kind: CatalogKind;
  readonly sourceId: string;
  readonly metadata: {
    readonly name: string;
    readonly description: string;
    readonly version?: string;
    readonly category?: string;
  };
}

export interface CatalogSearchProjection {
  readonly entry: CatalogEntryProjection;
  readonly score: number;
  readonly matchedFields: readonly string[];
}

export interface CatalogDiscoveryPort {
  list(filter: { kind?: CatalogKind; sourceId?: string }, context: CatalogRequestContext): readonly CatalogEntryProjection[];
  get(name: string, context: CatalogRequestContext): CatalogEntryProjection | null;
  search(input: {
    query: string;
    kind?: CatalogKind;
    category?: string;
    limit?: number;
  }, context: CatalogRequestContext): readonly CatalogSearchProjection[];
  sources(context: CatalogRequestContext): readonly { id: string; kind: string }[];
}

export interface CatalogNamespacePorts {
  readonly catalog: CatalogDiscoveryPort;
  readonly authenticate: MiddlewareHandler;
  readonly resolveContext: (context: Context) => Promise<CatalogRequestContext>;
}

const kind = z.enum(['skill', 'tool', 'agent', 'workflow', 'canvas']);
const listQuery = z.object({
  kind: kind.optional(),
  sourceId: z.string().min(1).optional(),
});
const searchQuery = z.object({
  query: z.string().trim().min(1),
  kind: kind.optional(),
  category: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});

export const assertCatalogPorts = (ports: CatalogNamespacePorts): void => {
  if (!ports.catalog || !ports.authenticate || !ports.resolveContext) {
    throw new Error('catalog product ports are unavailable');
  }
};

export const createCatalogTransportRouter = (ports: CatalogNamespacePorts): Hono => {
  assertCatalogPorts(ports);
  const router = new Hono();
  const trusted = (handler: (context: Context, authority: CatalogRequestContext) => Response) =>
    async (context: Context) => {
      let authority: CatalogRequestContext;
      try { authority = await ports.resolveContext(context); }
      catch { return context.json({ error: 'catalog_access_denied' }, 403); }
      context.header('Cache-Control', 'private, no-store');
      return handler(context, authority);
    };

  router.get('/catalog/entries', ports.authenticate, trusted((context, authority) => {
    const parsed = listQuery.safeParse(context.req.query());
    if (!parsed.success) return context.json({ error: 'invalid_catalog_request' }, 400);
    return context.json({ items: ports.catalog.list(parsed.data, authority) });
  }));
  router.get('/catalog/entries/:name', ports.authenticate, trusted((context, authority) => {
    const entry = ports.catalog.get(context.req.param('name'), authority);
    return entry
      ? context.json({ item: entry })
      : context.json({ error: 'catalog_entry_not_found' }, 404);
  }));
  router.get('/catalog/search', ports.authenticate, trusted((context, authority) => {
    const parsed = searchQuery.safeParse(context.req.query());
    if (!parsed.success) return context.json({ error: 'invalid_catalog_request' }, 400);
    return context.json({ hits: ports.catalog.search(parsed.data, authority) });
  }));
  router.get('/catalog/sources', ports.authenticate, trusted((context, authority) =>
    context.json({ items: ports.catalog.sources(authority) })));

  return router;
};
