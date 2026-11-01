import { createClusterMeshPlugin } from '@sentropic/cluster-mesh';
import { and, eq } from 'drizzle-orm';
import { readFileSync, readdirSync } from 'node:fs';
import { Hono, type MiddlewareHandler } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  app as productApp,
  PRODUCT_CLUSTER_MESH_MOUNTS,
  ROOT_MOUNTED_NAMESPACE_REGISTRY,
} from '../../src/app';
import { db } from '../../src/db/client';
import { chatMessages, chatSessions } from '../../src/db/schema';
import { setCmMembershipState } from '../../src/services/identity/cm-tenancy';
import { listCmSessionsForUser, revokeCmSession } from '../../src/services/identity/cm-sessions';
import { PLATFORM_TENANT_ID } from '../../src/services/workspace-service';
import { cmDeleteTenantMembershipsForUser } from '../utils/cm-identity-test-store';
import { resolveHttpCatalogContext } from '../../src/services/catalog/request-authority';
import { revalidateCatalogInvocation } from '../../src/services/catalog/request-context';
import { compositeCatalogRegistry, resolveFoundationChatTools, executeFoundationSearchCatalog } from '../../src/services/skills/catalog';
import { productArtifactTransport } from '../../src/services/artifacts/instance';
import { testCatalogContext } from '../services/catalog/test-context';
import { chatService } from '../../src/services/chat-service';
import { standaloneToolSource } from '../../src/services/catalog/sources/standalone-tool-source';
import { clusterMeshNamespaceCutovers } from '../../src/db/control-schema';
import {
  CATALOG_AUTHOR,
  CATALOG_PATHS,
  CATALOG_PREDECESSOR,
  CATALOG_ROUTES,
  createCatalogNamespaceModule,
  createCatalogTransportRouter,
  type CatalogDiscoveryPort,
  type CatalogNamespacePorts,
} from '../../src/routes/namespaces/catalog-module';
import type { CatalogCutoverControl } from '../../src/routes/namespaces/catalog-cutover';
import { productCatalogDiscovery } from '../../src/routes/namespaces/catalog-product-ports';
import { clusterMeshAdapter } from '../../src/services/cluster-mesh-adapter';
import { PostgresClusterMeshCutoverStore } from '../../src/services/cluster-mesh/postgres-cutover-store';
import {
  authenticatedRequest,
  cleanupAuthData,
  createAuthenticatedUser,
  type TestUser,
} from '../utils/auth-helper';

const pass: MiddlewareHandler = async (_context, next) => next();
const planner = {
  kind: 'skill' as const,
  sourceId: 'foundation',
  metadata: { name: 'planner', description: 'Plan work', category: 'workflow' },
};

const createDiscovery = (): CatalogDiscoveryPort => ({
  list: vi.fn(() => [planner]),
  get: vi.fn((name) => name === planner.metadata.name ? planner : null),
  search: vi.fn(() => [{ entry: planner, score: 5, matchedFields: ['name'] }]),
  sources: vi.fn(() => [{ id: 'foundation', kind: 'static' }]),
});

const createPorts = (catalog = createDiscovery()): CatalogNamespacePorts => ({
  catalog,
  authenticate: pass,
  resolveContext: () => testCatalogContext(['planner']),
});

describe('cluster mesh catalog transport', () => {
  it('requires injected authority and enumerates exact read-only routes', async () => {
    expect(() => createCatalogTransportRouter({
      ...createPorts(), catalog: undefined,
    } as unknown as CatalogNamespacePorts)).toThrowError('catalog product ports are unavailable');

    const router = createCatalogTransportRouter(createPorts());
    expect([...new Map(router.routes.map(({ method, path }) => [path, [method, path]])).values()]).toEqual(CATALOG_ROUTES);
    expect(CATALOG_PATHS).toHaveLength(4);
    expect(CATALOG_PATHS).not.toContain('/*');
    expect(CATALOG_ROUTES.every(([method]) => method === 'GET')).toBe(true);

    const source = readFileSync(
      new URL('../../src/routes/namespaces/catalog.ts', import.meta.url), 'utf8',
    );
    expect(source).not.toMatch(/^import (?!type)[^\n]*from ['"][^'"]*(?:\/db\/|\/services\/|\/schema)/m);

    const app = new Hono().route('/api/v1', router);
    expect((await app.request('/api/v1/catalog/entries/planner', { method: 'POST' })).status)
      .toBe(404);
  });

  it('projects deterministic list, detail, search, and source discovery', async () => {
    const catalog = createDiscovery();
    const app = new Hono().route('/api/v1', createCatalogTransportRouter(createPorts(catalog)));

    const list = await app.request('/api/v1/catalog/entries?kind=skill&sourceId=foundation');
    await expect(list.json()).resolves.toEqual({ items: [planner] });
    expect(catalog.list).toHaveBeenCalledWith({ kind: 'skill', sourceId: 'foundation' }, expect.objectContaining({ subjectId: 'user-test' }));

    const detail = await app.request('/api/v1/catalog/entries/planner');
    await expect(detail.json()).resolves.toEqual({ item: planner });
    const search = await app.request('/api/v1/catalog/search?query=planner&kind=skill&limit=3');
    await expect(search.json()).resolves.toEqual({
      hits: [{ entry: planner, score: 5, matchedFields: ['name'] }],
    });
    expect(catalog.search).toHaveBeenCalledWith({ query: 'planner', kind: 'skill', limit: 3 }, expect.objectContaining({ subjectId: 'user-test' }));
    await expect((await app.request('/api/v1/catalog/sources')).json()).resolves.toEqual({
      items: [{ id: 'foundation', kind: 'static' }],
    });

    expect((await app.request('/api/v1/catalog/search?query=')).status).toBe(400);
    expect((await app.request('/api/v1/catalog/entries/missing')).status).toBe(404);
  });
});

const key = { compositionRoot: 'product' as const, namespace: '/catalog' as const };
const cutovers = new PostgresClusterMeshCutoverStore();
const candidate = (enabled = true, control?: CatalogCutoverControl) => new Hono()
  .route('/api/v1', createClusterMeshPlugin({
    runtime: clusterMeshAdapter.sessionControl!.runtime,
    namespaces: [createCatalogNamespaceModule({ enabled, cutoverControl: control })],
    mounts: { '/catalog': '/' },
  }));

const clearCutover = async () => {
  await db.delete(clusterMeshNamespaceCutovers).where(and(
    eq(clusterMeshNamespaceCutovers.compositionRoot, key.compositionRoot),
    eq(clusterMeshNamespaceCutovers.namespace, key.namespace),
  ));
};

describe('cluster mesh catalog product authority', () => {
  let user: TestUser;

  beforeEach(async () => {
    await clearCutover();
    user = await createAuthenticatedUser('editor');
    await setCmMembershipState(user.id, PLATFORM_TENANT_ID, { status: 'approved', role: 'member', decidedBy: 'test' });
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    standaloneToolSource.unregister('catalog_context_probe');
    await clearCutover();
    await cleanupAuthData();
  });

  it('should expose compiled host tools through mounted discovery, search and model selection', async () => {
    vi.stubEnv('APP_ARTIFACT_HOST_ENABLED', '1');
    const [session] = await listCmSessionsForUser(user.id);
    const context = await resolveHttpCatalogContext({ userId: user.id, sessionId: session.id,
      workspaceId: user.workspaceId!, role: 'editor' });
    expect(compositeCatalogRegistry.getSources(context).filter(source => source.kind === 'mcp')
      .map(source => source.id)).toEqual(['host-registry']);
    const names = [...(await productArtifactTransport.ready).tools.keys()];
    const response = await authenticatedRequest(productApp, 'GET',
      '/api/v1/catalog/entries?sourceId=host-registry', user.sessionToken!);
    expect(response.status).toBe(200);
    expect((await response.json()).items.map((item: { metadata: { name: string } }) => item.metadata.name)).toEqual(names);
    expect(executeFoundationSearchCatalog({ payload: { query: 'artifacts', limit: 10 }, context }).hits
      .map(hit => hit.name)).toEqual(expect.arrayContaining(names));
    const tools = resolveFoundationChatTools({ userId: user.id, workspaceId: user.workspaceId!,
      allowedTools: [], context });
    expect(tools.filter(tool => tool.type === 'function').map(tool => tool.function.name)).toEqual(expect.arrayContaining(names));
    const other = await createAuthenticatedUser('guest');
    await setCmMembershipState(other.id, PLATFORM_TENANT_ID, { status: 'approved', role: 'member', decidedBy: 'test' });
    const denied = await authenticatedRequest(productApp, 'GET',
      '/api/v1/catalog/entries/artifacts_publish', other.sessionToken!);
    expect(denied.status).toBe(404);
    vi.stubEnv('APP_ARTIFACT_HOST_ENABLED', '0');
    expect(productCatalogDiscovery.list({ sourceId: 'host-registry' }, context)).toEqual([]);
  });

  it('should route one verified chat tool to the shared transport and deny a revoked retry', async () => {
    vi.stubEnv('APP_ARTIFACT_HOST_ENABLED', '1');
    const sessionId = crypto.randomUUID();
    const messageId = crypto.randomUUID();
    await db.insert(chatSessions).values({ id: sessionId, userId: user.id, workspaceId: user.workspaceId });
    await db.insert(chatMessages).values({ id: messageId, sessionId, role: 'assistant', sequence: 0 });
    const invoke = vi.spyOn(productArtifactTransport, 'invoke').mockResolvedValue({ status: 201, body: { artifactId: 'one' } });
    // Await request-bound plan preparation through the same authority entry as HTTP discovery.
    const [session] = await listCmSessionsForUser(user.id);
    await resolveHttpCatalogContext({ userId: user.id, sessionId: session.id, workspaceId: user.workspaceId!, role: 'editor' });
    const args = { bindingName: 'report', idempotencyKey: 'one' };
    let sequence = 0;
    const call = () => (chatService as unknown as { executeServerToolInternal(input: unknown): Promise<unknown> })
      .executeServerToolInternal({ toolCall: { id: 'ensure', name: 'artifacts_ensure', args: JSON.stringify(args) }, args,
        options: { userId: user.id, sessionId, assistantMessageId: messageId }, streamSeq: sequence++,
        sessionWorkspaceId: user.workspaceId, currentUserRole: 'editor', readOnly: false,
        allowedFolderIds: new Set(), allowedByType: { organization: new Set(), folder: new Set(),
          usecase: new Set(), executive_summary: new Set() }, hasContextType: () => false,
        isAllowedOrganizationId: async () => false,
        tools: [{ type: 'function', function: { name: 'artifacts_ensure', parameters: {} } }] });
    await expect(call()).resolves.toMatchObject({ result: { status: 201, body: { artifactId: 'one' } } });
    expect(invoke).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ subject: user.id,
      tenantId: 'sentropic', clientId: 'sentropic-turn',
      credentialId: JSON.stringify(['turn', sessionId, user.workspaceId, []]) }), user.workspaceId,
    ['mcp:tools:invoke'], 'artifacts_ensure', args);
    await cmDeleteTenantMembershipsForUser(user.id);
    await expect(call()).resolves.toMatchObject({ result: { error: 'catalog_access_denied' } });
    expect(invoke).toHaveBeenCalledOnce();
  });

  it('matches direct canonical deterministic discovery without a predecessor shadow', async () => {
    const [session] = await listCmSessionsForUser(user.id);
    const context = await resolveHttpCatalogContext({ userId: user.id, sessionId: session.id,
      workspaceId: user.workspaceId!, role: 'editor' });
    const directSearch = productCatalogDiscovery.search({
      query: 'workspace', kind: 'skill', limit: 3,
    }, context);
    const directSources = productCatalogDiscovery.sources(context);
    const search = await authenticatedRequest(
      productApp,
      'GET',
      '/api/v1/catalog/search?query=workspace&kind=skill&limit=3',
      user.sessionToken!,
    );
    const sources = await authenticatedRequest(
      productApp, 'GET', '/api/v1/catalog/sources', user.sessionToken!,
    );
    expect({ status: search.status, body: await search.json() }).toEqual({
      status: 200, body: { hits: JSON.parse(JSON.stringify(directSearch)) },
    });
    await expect(sources.json()).resolves.toEqual({
      items: JSON.parse(JSON.stringify(directSources)),
    });
    expect(CATALOG_PREDECESSOR).toMatchObject({
      historicalFixture: 'not_applicable', replayIdempotencyClaim: false,
    });
  });

  it('selects one direct author and fails closed after the exact no-HTTP rollback', async () => {
    const app = candidate();
    const path = '/api/v1/catalog/entries';
    expect((await authenticatedRequest(app, 'GET', path, user.sessionToken!)).status).toBe(200);
    const active = await cutovers.find(key);
    expect(active).toMatchObject({
      status: 'active',
      activeAuthor: CATALOG_AUTHOR,
      selectedGenerationId: clusterMeshAdapter.sessionControl!.runtime.generation.generationId,
      previousGenerationId: CATALOG_PREDECESSOR.previousGenerationId,
      rollbackCheckpoint: { activeAuthor: CATALOG_PREDECESSOR.rollbackAuthor },
    });
    expect(active?.shadowComparison).toBeUndefined();

    await cutovers.rollback(key, active!.previousGenerationId!);
    await expect(cutovers.verifyRollback(key)).resolves.toMatchObject({ reversible: true });
    const blocked = await authenticatedRequest(app, 'GET', path, user.sessionToken!);
    expect(blocked.status).toBe(503);
    await expect(blocked.json()).resolves.toEqual({ error: 'wrong_author' });
  });

  it('should deny all mounted discovery paths after tenant membership is revoked', async () => {
    await cmDeleteTenantMembershipsForUser(user.id);
    for (const suffix of ['entries', 'entries/workspace', 'search?query=workspace', 'sources']) {
      const response = await authenticatedRequest(productApp, 'GET', `/api/v1/catalog/${suffix}`, user.sessionToken!);
      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toEqual({ error: 'catalog_access_denied' });
    }
  });

  it('should isolate interleaved mounted discovery for two real users and workspaces', async () => {
    const other = await createAuthenticatedUser('guest');
    await setCmMembershipState(other.id, PLATFORM_TENANT_ID, { status: 'approved', role: 'member', decidedBy: 'test' });
    expect(other.workspaceId).not.toBe(user.workspaceId);
    standaloneToolSource.register({ tool: { name: 'catalog_context_probe', description: 'Private mutation probe',
      inputSchema: {}, sideEffect: true }, handler: vi.fn() });
    const discover = (actor: TestUser) => authenticatedRequest(productApp, 'GET',
      '/api/v1/catalog/entries/catalog_context_probe', actor.sessionToken!);
    const responses = await Promise.all([discover(user), discover(other), discover(other), discover(user)]);
    expect(responses.map(response => response.status)).toEqual([200, 404, 404, 200]);
    await expect(responses[0].json()).resolves.toMatchObject({ item: { metadata: { name: 'catalog_context_probe' } } });
    await cmDeleteTenantMembershipsForUser(other.id);
    const [denied, allowed] = await Promise.all([discover(other), discover(user)]);
    expect(denied.status).toBe(403);
    expect(allowed.status).toBe(200);
  });

  it('should reject stale session authority and foreign workspace selectors before execution', async () => {
    const [session] = await listCmSessionsForUser(user.id);
    const authenticated = { userId: user.id, sessionId: session.id, workspaceId: user.workspaceId!, role: 'editor' };
    const context = await resolveHttpCatalogContext(authenticated);
    await authenticatedRequest(productApp, 'GET', '/api/v1/catalog/sources', user.sessionToken!);
    await expect(revalidateCatalogInvocation(context, 'workspace_list', {})).resolves.toMatchObject({ subjectId: user.id });
    await expect(resolveHttpCatalogContext({ ...authenticated, workspaceId: 'foreign-workspace' }))
      .rejects.toThrow('catalog_access_denied');
    await revokeCmSession(session.id);
    await expect(revalidateCatalogInvocation(context, 'workspace_list', {})).rejects.toThrow('catalog_access_denied');
  });

  it('should carry verified chat-service authority through the real executor and deny a later revoked call', async () => {
    const sessionId = crypto.randomUUID();
    const messageId = crypto.randomUUID();
    await db.insert(chatSessions).values({ id: sessionId, userId: user.id, workspaceId: user.workspaceId });
    await db.insert(chatMessages).values({ id: messageId, sessionId, role: 'assistant', sequence: 0 });
    const handler = vi.fn((_args, context) => ({ actor: context.subjectId, workspace: context.workspaceId }));
    standaloneToolSource.register({ tool: { name: 'catalog_context_probe', description: 'Context probe',
      inputSchema: {}, sideEffect: false }, handler });
    let sequence = 0;
    const invoke = async () => (chatService as unknown as {
      executeServerToolInternal(input: unknown): Promise<unknown>;
    }).executeServerToolInternal({ toolCall: { id: 'probe', name: 'catalog_context_probe', args: '{}' }, args: {},
      options: { userId: user.id, sessionId, assistantMessageId: messageId }, streamSeq: sequence++,
      sessionWorkspaceId: user.workspaceId, currentUserRole: 'editor', readOnly: false,
      allowedFolderIds: new Set(), allowedByType: { organization: new Set(), folder: new Set(),
        usecase: new Set(), executive_summary: new Set() }, hasContextType: () => false,
      isAllowedOrganizationId: async () => false,
      tools: [{ type: 'function', function: { name: 'catalog_context_probe', parameters: {} } }] });
    await expect(invoke()).resolves.toMatchObject({ result: { actor: user.id, workspace: user.workspaceId } });
    await cmDeleteTenantMembershipsForUser(user.id);
    await expect(invoke()).resolves.toMatchObject({ result: { error: 'catalog_access_denied' } });
    expect(handler).toHaveBeenCalledOnce();
  });

  it('has no anonymous, disabled, duplicate, effect, or unavailable-control fallback', async () => {
    const path = '/api/v1/catalog/entries';
    expect((await candidate().request(path)).status).toBe(401);
    expect((await authenticatedRequest(candidate(false), 'GET', path, user.sessionToken!)).status)
      .toBe(404);
    expect((await authenticatedRequest(
      candidate(), 'GET', '/api/v1/catalog/catalog/entries', user.sessionToken!,
    )).status).toBe(404);
    expect((await authenticatedRequest(
      candidate(), 'POST', '/api/v1/catalog/entries/planner/execute', user.sessionToken!, {},
    )).status).toBe(404);

    const unavailable: CatalogCutoverControl = {
      runtime: { generation: clusterMeshAdapter.sessionControl!.runtime.generation },
      cutovers: {
        find: vi.fn(async () => { throw new Error('control unavailable'); }),
        activate: vi.fn(async () => undefined),
      },
    };
    const blocked = await authenticatedRequest(
      candidate(true, unavailable), 'GET', path, user.sessionToken!,
    );
    expect(blocked.status).toBe(503);
    await expect(blocked.json()).resolves.toEqual({ error: 'catalog_control_unavailable' });
  });

  it('registers the sole root author and confirms the prior HTTP surface is absent', () => {
    const registration = ROOT_MOUNTED_NAMESPACE_REGISTRY.find(
      ({ namespace }) => namespace === '/catalog',
    );
    expect(registration?.module.namespace).toBe('/catalog');
    expect(registration?.authPaths).toEqual(CATALOG_PATHS);
    expect('authorPaths' in registration! ? registration.authorPaths : undefined)
      .toEqual(CATALOG_PATHS);
    expect(PRODUCT_CLUSTER_MESH_MOUNTS['/catalog']).toBe('/');

    const apiIndex = readFileSync(new URL('../../src/routes/api/index.ts', import.meta.url), 'utf8');
    expect(apiIndex).not.toMatch(/catalog|search_catalog/);
    const productPorts = readFileSync(
      new URL('../../src/routes/namespaces/catalog-product-ports.ts', import.meta.url), 'utf8',
    );
    expect(productPorts).not.toMatch(/execution-seam|resource-plane|connector-host|mcp-source/);
  });

  it('should contain no legacy MCP source, sanitizer or registration entry point', () => {
    const sources = new URL('../../src/services/catalog/sources/', import.meta.url);
    const contents = readdirSync(sources).filter(file => file.endsWith('.ts'))
      .map(file => readFileSync(new URL(file, sources), 'utf8')).join('\n');
    expect(contents).not.toMatch(/McpCatalogSource|sanitizeMcpToolName/);
    const facade = readFileSync(new URL('../../src/services/skills/catalog.ts', import.meta.url), 'utf8');
    expect(facade).not.toMatch(/registerMcpSource|mcp-source/);
  });
});
