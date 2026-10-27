import { requireAuth } from '../../middleware/auth';
import type { CatalogEntry } from '../../services/catalog/types';
import type { CompositeCatalogRegistry } from '../../services/catalog/composite-registry';
import { resolveHttpCatalogContext } from '../../services/catalog/request-authority';
import { compositeCatalogRegistry } from '../../services/skills/catalog';
import type {
  CatalogDiscoveryPort,
  CatalogEntryProjection,
  CatalogNamespacePorts,
} from './catalog';

const projectEntry = (entry: CatalogEntry): CatalogEntryProjection => ({
  kind: entry.kind,
  sourceId: entry.sourceId,
  metadata: {
    name: entry.metadata.name,
    description: entry.metadata.description,
    ...(entry.metadata.version === undefined ? {} : { version: entry.metadata.version }),
    ...(entry.metadata.category === undefined ? {} : { category: entry.metadata.category }),
  },
});

export const createCatalogDiscovery = (registry: CompositeCatalogRegistry): CatalogDiscoveryPort => ({
  list(filter, context) {
    return registry.list(context)
      .filter((entry) => filter.kind === undefined || entry.kind === filter.kind)
      .filter((entry) => filter.sourceId === undefined || entry.sourceId === filter.sourceId)
      .map(projectEntry);
  },
  get(name, context) {
    const entry = registry.get(name, context);
    return entry === null ? null : projectEntry(entry);
  },
  search(input, context) {
    return registry.search(input.query, {
      ...(input.kind === undefined ? {} : { kindHint: input.kind }),
      ...(input.category === undefined ? {} : { categoryHint: input.category }),
      ...(input.limit === undefined ? {} : { topK: input.limit }),
    }, context).map((hit) => ({
      entry: projectEntry(hit.entry),
      score: hit.score,
      matchedFields: hit.matchedFields,
    }));
  },
  sources(context) {
    return registry.getSources(context).map(({ id, kind }) => ({ id, kind }));
  },
});
export const productCatalogDiscovery = createCatalogDiscovery(compositeCatalogRegistry);

export const productCatalogPorts: CatalogNamespacePorts = {
  catalog: productCatalogDiscovery,
  authenticate: requireAuth,
  resolveContext: context => resolveHttpCatalogContext(context.get('user')),
};
