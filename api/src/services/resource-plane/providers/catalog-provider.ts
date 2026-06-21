/**
 * CatalogResourceProvider — projects the capability catalog (BR-42b) onto the
 * resource plane mounts `/tools /skills /agents /workflows /canvas` (SPEC §6).
 *
 * It enumerates entries PER-(kind, sourceId) from each source `snapshot()` rather
 * than `CompositeCatalogRegistry.list()`, which globally dedupes by `metadata.name`
 * and would hide a valid `/skills` entry behind a same-named `/tools` entry. The
 * canonical id is `kind:enc(sourceId):enc(name)` (an inode, not the path alias).
 * Read is authz-projected with deny-as-missing; `edit` is denied (read-only); `invoke`
 * stays `unsupported` in this slice (the invoke seam is chat-coupled, deferred).
 */

import { createHash } from 'node:crypto';
import type { CatalogEntry, CatalogEntryKind } from '../../catalog/types.js';
import type { CompositeCatalogRegistry } from '../../catalog/composite-registry.js';
import { ResourceProviderBase } from '../provider-base.js';
import { ResourceError } from '../contract.js';
import type {
  EditArgs,
  EditResult,
  GrepArgs,
  GrepHit,
  GrepResult,
  ListArgs,
  ListResult,
  ReadArgs,
  ReadResult,
  ResourceNode,
  ResourcePrincipal,
  StatResult,
} from '../contract.js';
import type { ResourceRef } from '../ref.js';
import { ResourceAuthzProjector, resourceAuthzProjector } from '../authz.js';

const MOUNT_BY_KIND: Record<CatalogEntryKind, string> = {
  tool: 'tools',
  skill: 'skills',
  agent: 'agents',
  workflow: 'workflows',
  canvas: 'canvas',
};

const KIND_BY_MOUNT: Record<string, CatalogEntryKind> = {
  tools: 'tool',
  skills: 'skill',
  agents: 'agent',
  workflows: 'workflow',
  canvas: 'canvas',
};

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function isCatalogKind(value: string): value is CatalogEntryKind {
  return value === 'tool' || value === 'skill' || value === 'agent' || value === 'workflow' || value === 'canvas';
}

function canonicalId(entry: CatalogEntry): string {
  return `${entry.kind}:${encodeURIComponent(entry.sourceId)}:${encodeURIComponent(entry.metadata.name)}`;
}

function parseCanonicalId(id: string): { kind: CatalogEntryKind; sourceId: string; name: string } | null {
  const parts = id.split(':');
  if (parts.length !== 3) return null;
  const [kind, encSource, encName] = parts;
  if (!isCatalogKind(kind)) return null;
  return { kind, sourceId: decodeURIComponent(encSource), name: decodeURIComponent(encName) };
}

/** Stable content projection of an entry — the `read` body and the etag input. */
function projectContent(entry: CatalogEntry): string {
  const base = {
    kind: entry.kind,
    name: entry.metadata.name,
    description: entry.metadata.description,
    version: entry.metadata.version,
    category: entry.metadata.category,
  };
  switch (entry.kind) {
    case 'skill':
      return JSON.stringify({
        ...base,
        tools: entry.skill.tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
      });
    case 'tool':
      return JSON.stringify({
        ...base,
        tool: {
          inputSchema: entry.tool.inputSchema,
          outputSchema: entry.tool.outputSchema,
          sideEffect: entry.tool.sideEffect,
          requiresApproval: entry.tool.requiresApproval,
        },
      });
    case 'agent':
      return JSON.stringify({ ...base, template: entry.template });
    case 'workflow':
      return JSON.stringify({ ...base, workflow: entry.workflow });
    case 'canvas':
      return JSON.stringify({ ...base, template: entry.template });
  }
}

function etagOf(content: string): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 16);
}

function decodeOffset(token?: string): number {
  if (!token) return 0;
  const n = Number.parseInt(Buffer.from(token, 'base64url').toString('utf8'), 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function encodeOffset(offset: number): string {
  return Buffer.from(String(offset), 'utf8').toString('base64url');
}

export class CatalogResourceProvider extends ResourceProviderBase {
  readonly provider = 'catalog';
  readonly mounts: ReadonlyArray<string> = Object.values(MOUNT_BY_KIND);

  constructor(
    private readonly registry: CompositeCatalogRegistry,
    private readonly authz: ResourceAuthzProjector = resourceAuthzProjector
  ) {
    super();
  }

  private entriesOfKind(kind: CatalogEntryKind): CatalogEntry[] {
    const out: CatalogEntry[] = [];
    for (const source of this.registry.getSources()) {
      for (const entry of source.snapshot()) {
        if (entry.kind === kind) out.push(entry);
      }
    }
    return out;
  }

  private findEntry(kind: CatalogEntryKind, sourceId: string, name: string): CatalogEntry | undefined {
    for (const source of this.registry.getSources()) {
      for (const entry of source.snapshot()) {
        if (entry.kind === kind && entry.sourceId === sourceId && entry.metadata.name === name) {
          return entry;
        }
      }
    }
    return undefined;
  }

  private nodeFor(entry: CatalogEntry, scope: ResourceRef['scope']): ResourceNode {
    const etag = etagOf(projectContent(entry));
    return {
      ref: { provider: 'catalog', scope, type: entry.kind, id: canonicalId(entry), etag },
      path: `/${MOUNT_BY_KIND[entry.kind]}/${entry.metadata.name}`,
      name: entry.metadata.name,
      nodeType: 'resource',
      resourceType: entry.kind,
      description: entry.metadata.description,
      etag,
    };
  }

  async list(ref: ResourceRef, args: ListArgs, principal: ResourcePrincipal): Promise<ListResult> {
    if (!isCatalogKind(ref.type) || ref.id !== '') {
      throw new ResourceError('invalid_args', `not a catalog directory: ${ref.type}/${ref.id}`, ref);
    }
    const all = this.entriesOfKind(ref.type)
      .filter((e) => this.authz.catalogAccess(e.metadata, principal).discover)
      .sort((a, b) => a.metadata.name.localeCompare(b.metadata.name));

    const limit = Math.min(Math.max(1, args.limit ?? DEFAULT_LIMIT), MAX_LIMIT);
    const offset = decodeOffset(args.pageToken);
    const page = all.slice(offset, offset + limit);
    const entries = page.map((e) => this.nodeFor(e, principal.scope));
    const nextOffset = offset + page.length;
    return { entries, ...(nextOffset < all.length ? { nextPageToken: encodeOffset(nextOffset) } : {}) };
  }

  async stat(ref: ResourceRef, principal: ResourcePrincipal): Promise<StatResult> {
    if (isCatalogKind(ref.type) && ref.id === '') {
      return {
        ref: { ...ref, scope: principal.scope },
        path: `/${MOUNT_BY_KIND[ref.type]}`,
        nodeType: 'dir',
        resourceType: ref.type,
      };
    }
    const parsed = parseCanonicalId(ref.id);
    if (!parsed) throw new ResourceError('invalid_args', `not a catalog id: ${ref.id}`, ref);
    const entry = this.findEntry(parsed.kind, parsed.sourceId, parsed.name);
    if (!entry || !this.authz.catalogAccess(entry.metadata, principal).discover) {
      throw new ResourceError('not_found', `not found: ${ref.id}`, ref);
    }
    const etag = etagOf(projectContent(entry));
    return {
      ref: { ...ref, scope: principal.scope, etag },
      path: `/${MOUNT_BY_KIND[entry.kind]}/${entry.metadata.name}`,
      nodeType: 'resource',
      resourceType: entry.kind,
      etag,
      contentType: 'application/json',
    };
  }

  async read(ref: ResourceRef, args: ReadArgs, principal: ResourcePrincipal): Promise<ReadResult> {
    const parsed = parseCanonicalId(ref.id);
    if (!parsed) throw new ResourceError('invalid_args', `not a catalog id: ${ref.id}`, ref);
    const entry = this.findEntry(parsed.kind, parsed.sourceId, parsed.name);
    if (!entry) throw new ResourceError('not_found', `not found: ${ref.id}`, ref);
    const access = this.authz.catalogAccess(entry.metadata, principal);
    if (!access.discover) throw new ResourceError('not_found', `not found: ${ref.id}`, ref);
    if (!access.read) throw new ResourceError('denied', `read denied: ${ref.id}`, ref);

    const full = projectContent(entry);
    const etag = etagOf(full);
    let content = full;
    let truncated = false;
    let summary: string | undefined;
    if (args.maxBytes !== undefined && Buffer.byteLength(full, 'utf8') > args.maxBytes) {
      content = Buffer.from(full, 'utf8').subarray(0, args.maxBytes).toString('utf8');
      truncated = true;
      summary = `${entry.kind} '${entry.metadata.name}': ${entry.metadata.description}`;
    }
    return {
      ref: { ...ref, scope: principal.scope, etag },
      content,
      contentType: 'application/json',
      provenance: { provider: 'catalog', trust: 'first-party', origin: entry.sourceId },
      etag,
      truncated,
      ...(summary !== undefined ? { summary } : {}),
    };
  }

  async grep(ref: ResourceRef, args: GrepArgs, principal: ResourcePrincipal): Promise<GrepResult> {
    const kindHint = isCatalogKind(ref.type) ? ref.type : undefined;
    const raw = this.registry.search(args.query, {
      topK: args.limit ?? 20,
      ...(kindHint !== undefined ? { kindHint } : {}),
    });
    const hits: GrepHit[] = raw
      .filter((h) => this.authz.catalogAccess(h.entry.metadata, principal).discover)
      .map((h) => ({
        ref: {
          provider: 'catalog',
          scope: principal.scope,
          type: h.entry.kind,
          id: canonicalId(h.entry),
          etag: etagOf(projectContent(h.entry)),
        },
        path: `/${MOUNT_BY_KIND[h.entry.kind]}/${h.entry.metadata.name}`,
        score: h.score,
        snippet: h.entry.metadata.description,
      }));
    return { hits };
  }

  async edit(ref: ResourceRef, _args: EditArgs, _principal: ResourcePrincipal): Promise<EditResult> {
    throw new ResourceError('denied', `catalog resources are read-only: ${ref.id}`, ref);
  }

  async resolvePath(segments: ReadonlyArray<string>, principal: ResourcePrincipal): Promise<ResourceRef | null> {
    if (segments.length === 1) return this.collectionRef(segments[0], principal.scope);
    if (segments.length === 2) return this.resolveAlias(segments[0], segments[1], principal.scope);
    return null;
  }

  /** Resolve a `/<mount>/<name>` path alias to the canonical ref (RF1 alias resolution). */
  resolveAlias(mount: string, name: string, scope: ResourceRef['scope']): ResourceRef | null {
    const kind = KIND_BY_MOUNT[mount];
    if (!kind) return null;
    for (const source of this.registry.getSources()) {
      for (const entry of source.snapshot()) {
        if (entry.kind === kind && entry.metadata.name === name) {
          return { provider: 'catalog', scope, type: kind, id: canonicalId(entry), etag: etagOf(projectContent(entry)) };
        }
      }
    }
    return null;
  }

  /** The collection (directory) ref for a mount segment, e.g. 'skills' → catalog/skill/''. */
  collectionRef(mount: string, scope: ResourceRef['scope']): ResourceRef | null {
    const kind = KIND_BY_MOUNT[mount];
    if (!kind) return null;
    return { provider: 'catalog', scope, type: kind, id: '' };
  }
}
