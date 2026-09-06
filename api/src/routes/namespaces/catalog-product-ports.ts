import { requireAuth } from '../../middleware/auth';
import type { CatalogEntry } from '../../services/catalog/types';
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

export const productCatalogDiscovery: CatalogDiscoveryPort = {
  list(filter) {
    return compositeCatalogRegistry.list()
      .filter((entry) => filter.kind === undefined || entry.kind === filter.kind)
      .filter((entry) => filter.sourceId === undefined || entry.sourceId === filter.sourceId)
      .map(projectEntry);
  },
  get(name) {
    const entry = compositeCatalogRegistry.get(name);
    return entry === null ? null : projectEntry(entry);
  },
  search(input) {
    return compositeCatalogRegistry.search(input.query, {
      ...(input.kind === undefined ? {} : { kindHint: input.kind }),
      ...(input.category === undefined ? {} : { categoryHint: input.category }),
      ...(input.limit === undefined ? {} : { topK: input.limit }),
    }).map((hit) => ({
      entry: projectEntry(hit.entry),
      score: hit.score,
      matchedFields: hit.matchedFields,
    }));
  },
  sources() {
    return compositeCatalogRegistry.getSources().map(({ id, kind }) => ({ id, kind }));
  },
};

export const productCatalogPorts: CatalogNamespacePorts = {
  catalog: productCatalogDiscovery,
  authenticate: requireAuth,
};
