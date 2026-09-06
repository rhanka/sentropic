import { Hono, type MiddlewareHandler } from 'hono';
import { describe, expect, it } from 'vitest';

import { requireAuth } from '../../src/middleware/auth';
import { requireAdmin, requireEditor } from '../../src/middleware/rbac';
import { adminAuthorFence } from '../../src/routes/namespaces/admin-cutover';
import { appsAuthorFence } from '../../src/routes/namespaces/apps-cutover';
import { catalogAuthorFence } from '../../src/routes/namespaces/catalog-cutover';
import { healthAuthorFence } from '../../src/routes/namespaces/health-cutover';
import { resourcesAuthorFence } from '../../src/routes/namespaces/resources-cutover';
import { requireAdminApp } from '../../src/routes/namespaces/admin-product-ports';
import { requireAppsAdmin } from '../../src/routes/namespaces/apps-product-ports';
import {
  MOUNTED_NAMESPACE_REGISTRY,
  PREFIX_MOUNTED_NAMESPACE_REGISTRY,
  PRODUCT_CLUSTER_MESH_MOUNTS,
  ROOT_MOUNTED_NAMESPACE_REGISTRY,
  ROOT_MOUNT_REMAPS,
  type PrivilegedPathFence,
} from '../../src/app';

type RootMountedRouter = Pick<Hono, 'routes'>;

const IMMUTABLE_ANALYTICS_EDITOR_PATHS = ['/analytics/executive-summary'] as const;
const IMMUTABLE_HEALTH_ROUTES = [['GET', '/health']] as const;
const IMMUTABLE_APP_AUTH_ROUTES = [
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
const IMMUTABLE_APP_ADMIN_PATHS = [
  ...new Set(IMMUTABLE_APP_AUTH_ROUTES.map(([, path]) => path)),
];
const IMMUTABLE_CATALOG_AUTH_ROUTES = [
  ['GET', '/catalog/entries'],
  ['GET', '/catalog/entries/:name'],
  ['GET', '/catalog/search'],
  ['GET', '/catalog/sources'],
] as const;
const IMMUTABLE_RESOURCE_AUTH_ROUTES = [
  ['POST', '/resources/list'],
  ['POST', '/resources/stat'],
  ['POST', '/resources/read'],
  ['POST', '/resources/grep'],
  ['POST', '/resources/edit'],
  ['POST', '/resources/invoke'],
] as const;
const IMMUTABLE_ADMIN_AUTH_ROUTES = [
  ['POST', '/admin/reset'],
  ['GET', '/admin/stats'],
  ['GET', '/admin/users'],
  ['POST', '/admin/users/:id/approve'],
  ['POST', '/admin/users/:id/disable'],
  ['POST', '/admin/users/:id/reactivate'],
  ['DELETE', '/admin/users/:id'],
  ['GET', '/admin/tenant-resolution-metrics'],
] as const;
const IMMUTABLE_ADMIN_APP_PATHS = [
  '/admin/reset',
  '/admin/stats',
  '/admin/users',
  '/admin/users/:id/approve',
  '/admin/users/:id/disable',
  '/admin/users/:id/reactivate',
  '/admin/users/:id',
] as const;
const IMMUTABLE_ADMIN_PATHS = ['/admin/tenant-resolution-metrics'] as const;
const IMMUTABLE_CONFIG_ADMIN_PATHS = [
  '/settings',
  '/business-config',
  '/ai-settings',
  '/ai-settings/all',
  '/ai-settings/:key',
] as const;
const IMMUTABLE_WORKSPACE_EDITOR_PATHS = [
  '/workspaces',
  '/workspaces/:id',
  '/workspaces/:id/gate-config',
  '/workspaces/:id/hide',
  '/workspaces/:id/unhide',
  '/workspaces/:id/members',
  '/workspaces/:id/members/:userId',
] as const;
const IMMUTABLE_TRANSFER_AUTH_ROUTES = [
  ['POST', '/exports'],
  ['POST', '/imports/preview'],
  ['POST', '/imports'],
] as const;
const IMMUTABLE_CLIENT_AUTH_ROUTES = [
  ['GET', '/chrome-extension/download'],
  ['POST', '/chrome-extension/tabs/register'],
  ['POST', '/chrome-extension/tabs/keepalive'],
  ['DELETE', '/chrome-extension/tabs/:tabId'],
  ['GET', '/vscode-extension/download'],
  ['GET', '/vscode-extension/code-agent-prompt-profile'],
  ['GET', '/vscode-extension/workspace-mapping'],
  ['PUT', '/vscode-extension/workspace-mapping'],
  ['POST', '/vscode-extension/workspace-mapping/code-workspace'],
  ['POST', '/vscode-extension/workspace-mapping/not-now'],
  ['GET', '/cowork-desktop/download'],
  ['GET', '/cowork-desktop/channel'],
  ['PUT', '/cowork-desktop/channel'],
  ['GET', '/settings/vscode-extension-token'],
  ['POST', '/settings/vscode-extension-token'],
  ['DELETE', '/settings/vscode-extension-token'],
] as const;
const IMMUTABLE_CLIENT_ADMIN_PATHS = [
  '/cowork-desktop/channel',
  '/settings/vscode-extension-token',
] as const;
const IMMUTABLE_CLIENT_EDITOR_PATHS = [
  '/vscode-extension/workspace-mapping/code-workspace',
] as const;

const registeredPaths = (router: RootMountedRouter): string[] =>
  [...new Set(router.routes.map(({ path }) => path))].sort();

const assertRootRemapsRegistered = (
  mounts: Readonly<Record<string, string>>,
  namespaces: readonly string[],
): void => {
  const registeredNamespaces = new Set(namespaces);
  const unregisteredRootRemaps = Object.entries(mounts)
    .filter(([, mount]) => mount === '/')
    .map(([namespace]) => namespace)
    .filter((namespace) => !registeredNamespaces.has(namespace));
  expect(
    unregisteredRootRemaps,
    'plugin mounts contain root remaps outside the root-mount registry',
  ).toEqual([]);
};

const assertRootMountsMatchRegistry = (
  mounts: Readonly<Record<string, string>>,
  namespaces: readonly string[],
): void => {
  expect(
    namespaces.filter((namespace) => mounts[namespace] !== '/'),
    'root namespace registry mounts differ from plugin mounts',
  ).toEqual([]);
};

const assertFenceComplete = (
  namespace: string,
  router: RootMountedRouter,
  fence: readonly string[],
): void => {
  const fencedPaths = new Set(fence);
  const missing = registeredPaths(router).filter((path) => !fencedPaths.has(path));
  expect(missing, `${namespace} mounted namespace fence is missing registered paths`).toEqual([]);
};

const assertGlobalAuthenticationFence = (
  namespace: string,
  router: RootMountedRouter,
): void => {
  const firstRoute = router.routes[0];
  expect(firstRoute?.path, `${namespace} null fence must start with a global guard`).toBe('/*');
  expect(firstRoute?.handler, `${namespace} null fence must start with requireAuth`).toBe(requireAuth);
};

const assertPrefixMountsMatchRegistry = (
  mounts: Readonly<Record<string, string>>,
): void => {
  const mismatches = PREFIX_MOUNTED_NAMESPACE_REGISTRY
    .filter(({ namespace, mount }) => (mounts[namespace] ?? namespace) !== mount)
    .map(({ namespace }) => namespace);
  expect(mismatches, 'prefix namespace registry mounts differ from plugin mounts').toEqual([]);
};

const assertPrivilegedFenceComplete = (
  namespace: string,
  router: RootMountedRouter,
  authFence: readonly string[],
  privilegedFence: PrivilegedPathFence,
): void => {
  const registered = registeredPaths(router);
  const authPaths = new Set(authFence);
  const privilegedPaths = new Set(privilegedFence.paths);
  const isFlagged = (path: string): boolean => privilegedFence.pathPrefixes.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  );

  expect(
    privilegedFence.paths.filter((path) => !authPaths.has(path)),
    `${namespace} ${privilegedFence.name} sub-fence is outside its auth fence`,
  ).toEqual([]);
  expect(
    privilegedFence.paths.filter((path) => !registered.includes(path)),
    `${namespace} ${privilegedFence.name} sub-fence contains unregistered paths`,
  ).toEqual([]);
  expect(
    registered.filter((path) => isFlagged(path) && !privilegedPaths.has(path)),
    `${namespace} ${privilegedFence.name} sub-fence is missing privileged paths`,
  ).toEqual([]);
};

const assertPrivilegedMiddlewareFencesComplete = (
  namespace: string,
  router: RootMountedRouter,
  privilegedFences: readonly PrivilegedPathFence[],
  name: string,
  handler: MiddlewareHandler,
): void => {
  const namedFences = privilegedFences.filter((fence) => fence.name === name);
  if (name !== 'admin' && namedFences.length === 0) return;
  const privilegedPaths = new Set(namedFences.flatMap(({ paths }) => paths));
  const missing = router.routes
    .filter((route) => route.handler === handler)
    .map(({ path }) => path)
    .filter((path) => !privilegedPaths.has(path));
  expect(
    [...new Set(missing)].sort(),
    `${namespace} ${name} wiring is outside its privileged sub-fence`,
  ).toEqual([]);
  const missingHandlers = namedFences
    .flatMap(({ paths }) => paths)
    .filter((path) => !router.routes.some(
      (route) => route.path === path && route.handler === handler,
    ));
  expect(
    [...new Set(missingHandlers)].sort(),
    `${namespace} ${name} fence is missing middleware wiring`,
  ).toEqual([]);
};

const assertImmutablePrivilegedRequirement = (
  namespace: string,
  router: RootMountedRouter,
  privilegedFences: readonly PrivilegedPathFence[],
  name: string,
  handler: MiddlewareHandler,
  expectedPaths: readonly string[],
): void => {
  const declaredPaths = new Set(
    privilegedFences.filter((fence) => fence.name === name).flatMap(({ paths }) => paths),
  );
  expect(
    expectedPaths.filter((path) => !declaredPaths.has(path)),
    `${namespace} ${name} immutable requirement is missing privileged paths`,
  ).toEqual([]);
  expect(
    expectedPaths.filter((path) => !router.routes.some(
      (route) => route.path === path && route.handler === handler,
    )),
    `${namespace} ${name} immutable requirement is missing middleware wiring`,
  ).toEqual([]);
};

const assertImmutableMethodRequirement = (
  namespace: string,
  router: RootMountedRouter,
  authFence: readonly string[],
  handler: MiddlewareHandler,
  expectedRoutes: ReadonlyArray<readonly [string, string]>,
  fenceName = 'auth',
): void => {
  expect(
    expectedRoutes.filter(([, path]) => !authFence.includes(path)),
    `${namespace} immutable ${fenceName} requirement is missing paths`,
  ).toEqual([]);
  expect(
    expectedRoutes.filter(([method, path]) => !router.routes.some(
      (route) => route.method === method && route.path === path && route.handler === handler,
    )),
    `${namespace} immutable ${fenceName} requirement is missing method wiring`,
  ).toEqual([]);
};

const assertImmutableRouteRequirement = (
  namespace: string,
  router: RootMountedRouter,
  fence: readonly string[],
  expectedRoutes: ReadonlyArray<readonly [string, string]>,
): void => {
  expect(
    expectedRoutes.filter(([, path]) => !fence.includes(path)),
    `${namespace} immutable route requirement is missing paths`,
  ).toEqual([]);
  expect(
    expectedRoutes.filter(([method, path]) => !router.routes.some(
      (route) => route.method === method && route.path === path,
    )),
    `${namespace} immutable route requirement is missing method wiring`,
  ).toEqual([]);
};

const withoutRequireAdminPath = (
  router: RootMountedRouter,
  path: string,
): RootMountedRouter => ({
  routes: router.routes.filter((route) => route.path !== path || route.handler !== requireAdmin),
});

describe('mounted namespace fence completeness', () => {
  it.each(MOUNTED_NAMESPACE_REGISTRY)(
    'covers every registered path and privileged sub-fence for $namespace',
    ({ namespace, module, authPaths, ...registration }) => {
      expect(module.namespace).toBe(namespace);
      const router = module.createRouter();
      const privilegedFences = registration.privilegedFences ?? [];
      assertPrivilegedMiddlewareFencesComplete(
        namespace, router, privilegedFences, 'admin', requireAdmin,
      );
      assertPrivilegedMiddlewareFencesComplete(
        namespace, router, privilegedFences, 'editor', requireEditor,
      );
      if (namespace === '/health') {
        const authorPaths = 'authorPaths' in registration ? registration.authorPaths : undefined;
        expect(authPaths).toEqual(IMMUTABLE_HEALTH_ROUTES.map(([, path]) => path));
        expect(authorPaths).toEqual(IMMUTABLE_HEALTH_ROUTES.map(([, path]) => path));
        expect(authPaths).not.toContain('/*');
        assertImmutableRouteRequirement(namespace, router, authPaths ?? [], IMMUTABLE_HEALTH_ROUTES);
        assertImmutableMethodRequirement(
          namespace, router, authorPaths ?? [], healthAuthorFence, IMMUTABLE_HEALTH_ROUTES, 'author',
        );
      }
      if (namespace === '/apps') {
        const authorPaths = 'authorPaths' in registration ? registration.authorPaths : undefined;
        expect(authPaths).toEqual(IMMUTABLE_APP_ADMIN_PATHS);
        expect(authorPaths).toEqual(IMMUTABLE_APP_ADMIN_PATHS);
        assertImmutableMethodRequirement(
          namespace, router, authPaths ?? [], requireAuth, IMMUTABLE_APP_AUTH_ROUTES,
        );
        assertImmutableMethodRequirement(
          namespace, router, authorPaths ?? [], appsAuthorFence,
          IMMUTABLE_APP_AUTH_ROUTES, 'author',
        );
        assertPrivilegedMiddlewareFencesComplete(
          namespace, router, privilegedFences, 'app-admin', requireAppsAdmin,
        );
        assertImmutablePrivilegedRequirement(
          namespace, router, privilegedFences, 'app-admin', requireAppsAdmin,
          IMMUTABLE_APP_ADMIN_PATHS,
        );
      }
      if (namespace === '/catalog') {
        const authorPaths = 'authorPaths' in registration ? registration.authorPaths : undefined;
        const immutablePaths = IMMUTABLE_CATALOG_AUTH_ROUTES.map(([, path]) => path);
        expect(authPaths).toEqual(immutablePaths);
        expect(authorPaths).toEqual(immutablePaths);
        expect(authPaths).not.toContain('/*');
        assertImmutableMethodRequirement(
          namespace, router, authPaths ?? [], requireAuth, IMMUTABLE_CATALOG_AUTH_ROUTES,
        );
        assertImmutableMethodRequirement(
          namespace, router, authorPaths ?? [], catalogAuthorFence,
          IMMUTABLE_CATALOG_AUTH_ROUTES, 'author',
        );
      }
      if (namespace === '/resources') {
        const authorPaths = 'authorPaths' in registration ? registration.authorPaths : undefined;
        const immutablePaths = IMMUTABLE_RESOURCE_AUTH_ROUTES.map(([, path]) => path);
        expect(authPaths).toEqual(immutablePaths);
        expect(authorPaths).toEqual(immutablePaths);
        expect(authPaths).not.toContain('/*');
        assertImmutableMethodRequirement(
          namespace, router, authPaths ?? [], requireAuth, IMMUTABLE_RESOURCE_AUTH_ROUTES,
        );
        assertImmutableMethodRequirement(
          namespace, router, authorPaths ?? [], resourcesAuthorFence,
          IMMUTABLE_RESOURCE_AUTH_ROUTES, 'author',
        );
      }
      if (namespace === '/admin') {
        const authorPaths = 'authorPaths' in registration ? registration.authorPaths : undefined;
        expect(authorPaths).toEqual(IMMUTABLE_ADMIN_AUTH_ROUTES.map(([, path]) => path));
        assertImmutableMethodRequirement(
          namespace, router, authPaths ?? [], requireAuth, IMMUTABLE_ADMIN_AUTH_ROUTES,
        );
        assertImmutableMethodRequirement(
          namespace,
          router,
          authorPaths ?? [],
          adminAuthorFence,
          IMMUTABLE_ADMIN_AUTH_ROUTES,
          'author',
        );
        assertPrivilegedMiddlewareFencesComplete(
          namespace, router, privilegedFences, 'app-admin', requireAdminApp,
        );
        assertImmutablePrivilegedRequirement(
          namespace, router, privilegedFences, 'app-admin', requireAdminApp,
          IMMUTABLE_ADMIN_APP_PATHS,
        );
        assertImmutablePrivilegedRequirement(
          namespace, router, privilegedFences, 'admin', requireAdmin,
          IMMUTABLE_ADMIN_PATHS,
        );
      }
      if (namespace === '/analytics') {
        assertImmutablePrivilegedRequirement(
          namespace,
          router,
          privilegedFences,
          'editor',
          requireEditor,
          IMMUTABLE_ANALYTICS_EDITOR_PATHS,
        );
      }
      if (namespace === '/config') {
        assertImmutablePrivilegedRequirement(
          namespace,
          router,
          privilegedFences,
          'admin',
          requireAdmin,
          IMMUTABLE_CONFIG_ADMIN_PATHS,
        );
      }
      if (namespace === '/workspaces') {
        assertImmutablePrivilegedRequirement(
          namespace,
          router,
          privilegedFences,
          'editor',
          requireEditor,
          IMMUTABLE_WORKSPACE_EDITOR_PATHS,
        );
      }
      if (namespace === '/transfers') {
        assertImmutableMethodRequirement(
          namespace,
          router,
          authPaths ?? [],
          requireAuth,
          IMMUTABLE_TRANSFER_AUTH_ROUTES,
        );
      }
      if (namespace === '/clients') {
        assertImmutableMethodRequirement(
          namespace, router, authPaths ?? [], requireAuth, IMMUTABLE_CLIENT_AUTH_ROUTES,
        );
        assertImmutablePrivilegedRequirement(
          namespace, router, privilegedFences, 'admin', requireAdmin,
          IMMUTABLE_CLIENT_ADMIN_PATHS,
        );
        assertImmutablePrivilegedRequirement(
          namespace, router, privilegedFences, 'editor', requireEditor,
          IMMUTABLE_CLIENT_EDITOR_PATHS,
        );
      }
      if (authPaths === null) {
        expect(privilegedFences).toEqual([]);
        if (PREFIX_MOUNTED_NAMESPACE_REGISTRY.some((item) => item.namespace === namespace)) {
          assertGlobalAuthenticationFence(namespace, router);
        }
        return;
      }
      assertFenceComplete(namespace, router, authPaths);
      for (const privilegedFence of privilegedFences) {
        assertPrivilegedFenceComplete(namespace, router, authPaths, privilegedFence);
      }
    },
  );

  it('binds every composed plugin root remap to the exported registry', () => {
    assertPrefixMountsMatchRegistry(PRODUCT_CLUSTER_MESH_MOUNTS);
    expect(Object.keys(ROOT_MOUNT_REMAPS)).toEqual(
      ROOT_MOUNTED_NAMESPACE_REGISTRY.map(({ namespace }) => namespace),
    );
    expect(Object.values(ROOT_MOUNT_REMAPS)).toEqual(
      ROOT_MOUNTED_NAMESPACE_REGISTRY.map(() => '/'),
    );
    assertRootRemapsRegistered(
      PRODUCT_CLUSTER_MESH_MOUNTS,
      ROOT_MOUNTED_NAMESPACE_REGISTRY.map(({ namespace }) => namespace),
    );
    assertRootMountsMatchRegistry(
      PRODUCT_CLUSTER_MESH_MOUNTS,
      ROOT_MOUNTED_NAMESPACE_REGISTRY.map(({ namespace }) => namespace),
    );
  });

  it('fails when a prefix registry mount differs from the plugin mount', () => {
    expect(() => assertPrefixMountsMatchRegistry({
      ...PRODUCT_CLUSTER_MESH_MOUNTS,
      '/memory': '/fixture-mismatch',
    })).toThrowError('prefix namespace registry mounts differ from plugin mounts');
  });

  it('fails when the composed plugin mounts contain an unregistered root remap', () => {
    expect(() => assertRootRemapsRegistered(
      { ...PRODUCT_CLUSTER_MESH_MOUNTS, '/fixture-bypass': '/' },
      ROOT_MOUNTED_NAMESPACE_REGISTRY.map(({ namespace }) => namespace),
    )).toThrowError('plugin mounts contain root remaps outside the root-mount registry');
  });

  it('fails when the root-mounted locks namespace loses its root remap', () => {
    expect(() => assertRootMountsMatchRegistry(
      { ...PRODUCT_CLUSTER_MESH_MOUNTS, '/locks': '/locks' },
      ROOT_MOUNTED_NAMESPACE_REGISTRY.map(({ namespace }) => namespace),
    )).toThrowError('root namespace registry mounts differ from plugin mounts');
  });

  it('fails when the prefixed Track namespace gains a route outside its fence', () => {
    const registration = MOUNTED_NAMESPACE_REGISTRY.find(({ namespace }) => namespace === '/track')!;
    const router = registration.module.createRouter();
    router.get('/probe-unfenced/:workspace', (context) => context.json({ exposed: true }));

    expect(() => assertFenceComplete('/track', router, registration.authPaths!)).toThrowError(
      '/track mounted namespace fence is missing registered paths',
    );
  });

  it('fails when the prefixed gateway gains an anonymous route outside its fence', () => {
    const registration = MOUNTED_NAMESPACE_REGISTRY.find(({ namespace }) => namespace === '/gw')!;
    expect(registration.authPaths).not.toBeNull();
    const router = registration.module.createRouter();
    router.get('/probe-unfenced/:workspace', (context) => context.json({ exposed: true }));

    expect(() => assertFenceComplete('/gw', router, registration.authPaths ?? [])).toThrowError(
      '/gw mounted namespace fence is missing registered paths',
    );
  });

  it('fails when root-mounted streams gains a route outside its explicit fence', () => {
    const registration = ROOT_MOUNTED_NAMESPACE_REGISTRY.find(
      ({ namespace }) => namespace === '/streams',
    )!;
    expect(registration.authPaths).not.toBeNull();
    const router = registration.module.createRouter();
    router.get('/streams/unfenced', (context) => context.json({ exposed: true }));

    expect(() => assertFenceComplete('/streams', router, registration.authPaths ?? []))
      .toThrowError('/streams mounted namespace fence is missing registered paths');
  });

  it('fails when the live root-mounted health router gains an unfenced mutation', () => {
    const registration = ROOT_MOUNTED_NAMESPACE_REGISTRY.find(
      ({ namespace }) => namespace === '/health',
    )!;
    const router = registration.module.createRouter();
    router.post('/health/unfenced', (context) => context.json({ exposed: true }));

    expect(() => assertFenceComplete('/health', router, registration.authPaths!))
      .toThrowError('/health mounted namespace fence is missing registered paths');
  });

  it('fails when the live root-mounted apps router gains an unfenced mutation', () => {
    const registration = ROOT_MOUNTED_NAMESPACE_REGISTRY.find(
      ({ namespace }) => namespace === '/apps',
    )!;
    const router = registration.module.createRouter();
    router.post('/apps/unfenced', (context) => context.json({ exposed: true }));

    expect(() => assertFenceComplete('/apps', router, registration.authPaths!))
      .toThrowError('/apps mounted namespace fence is missing registered paths');
  });

  it('fails when apps routes and every mutable fence shrink together', () => {
    const missingPath = '/apps/templates/:id/publish';
    const registration = ROOT_MOUNTED_NAMESPACE_REGISTRY.find(
      ({ namespace }) => namespace === '/apps',
    )!;
    const mutation = {
      routes: registration.module.createRouter().routes.filter(
        (route) => route.path !== missingPath,
      ),
    };
    const authPaths = registration.authPaths!.filter((path) => path !== missingPath);
    const authorPaths = ('authorPaths' in registration ? registration.authorPaths : [])
      .filter((path) => path !== missingPath);
    const privilegedFences = registration.privilegedFences!.map((fence) => ({
      ...fence,
      paths: fence.paths.filter((path) => path !== missingPath),
    }));

    expect(() => {
      assertFenceComplete('/apps', mutation, authPaths);
      assertImmutableMethodRequirement(
        '/apps', mutation, authPaths, requireAuth, IMMUTABLE_APP_AUTH_ROUTES,
      );
      assertImmutableMethodRequirement(
        '/apps', mutation, authorPaths, appsAuthorFence, IMMUTABLE_APP_AUTH_ROUTES, 'author',
      );
      assertImmutablePrivilegedRequirement(
        '/apps', mutation, privilegedFences, 'app-admin', requireAppsAdmin,
        IMMUTABLE_APP_ADMIN_PATHS,
      );
    }).toThrowError('/apps immutable auth requirement is missing paths');
  });

  it('fails when the live root-mounted catalog router gains an unfenced mutation', () => {
    const registration = ROOT_MOUNTED_NAMESPACE_REGISTRY.find(
      ({ namespace }) => namespace === '/catalog',
    )!;
    const router = registration.module.createRouter();
    router.post('/catalog/unfenced', (context) => context.json({ exposed: true }));

    expect(() => assertFenceComplete('/catalog', router, registration.authPaths!))
      .toThrowError('/catalog mounted namespace fence is missing registered paths');
  });

  it('fails when catalog routes and mutable auth/author fences shrink together', () => {
    const missingPath = '/catalog/search';
    const registration = ROOT_MOUNTED_NAMESPACE_REGISTRY.find(
      ({ namespace }) => namespace === '/catalog',
    )!;
    const mutation = {
      routes: registration.module.createRouter().routes.filter(
        (route) => route.path !== missingPath,
      ),
    };
    const authPaths = registration.authPaths!.filter((path) => path !== missingPath);
    const authorPaths = ('authorPaths' in registration ? registration.authorPaths : [])
      .filter((path) => path !== missingPath);

    expect(() => {
      assertFenceComplete('/catalog', mutation, authPaths);
      assertImmutableMethodRequirement(
        '/catalog', mutation, authPaths, requireAuth, IMMUTABLE_CATALOG_AUTH_ROUTES,
      );
      assertImmutableMethodRequirement(
        '/catalog', mutation, authorPaths, catalogAuthorFence,
        IMMUTABLE_CATALOG_AUTH_ROUTES, 'author',
      );
    }).toThrowError('/catalog immutable auth requirement is missing paths');
  });

  it('fails when the live root-mounted resources router gains an unfenced mutation', () => {
    const registration = ROOT_MOUNTED_NAMESPACE_REGISTRY.find(
      ({ namespace }) => namespace === '/resources',
    )!;
    const router = registration.module.createRouter();
    router.post('/resources/unfenced', (context) => context.json({ exposed: true }));

    expect(() => assertFenceComplete('/resources', router, registration.authPaths!))
      .toThrowError('/resources mounted namespace fence is missing registered paths');
  });

  it('fails when resources routes and mutable auth/author fences shrink together', () => {
    const missingPath = '/resources/invoke';
    const registration = ROOT_MOUNTED_NAMESPACE_REGISTRY.find(
      ({ namespace }) => namespace === '/resources',
    )!;
    const mutation = {
      routes: registration.module.createRouter().routes.filter(
        (route) => route.path !== missingPath,
      ),
    };
    const authPaths = registration.authPaths!.filter((path) => path !== missingPath);
    const authorPaths = ('authorPaths' in registration ? registration.authorPaths : [])
      .filter((path) => path !== missingPath);

    expect(() => {
      assertFenceComplete('/resources', mutation, authPaths);
      assertImmutableMethodRequirement(
        '/resources', mutation, authPaths, requireAuth, IMMUTABLE_RESOURCE_AUTH_ROUTES,
      );
      assertImmutableMethodRequirement(
        '/resources', mutation, authorPaths, resourcesAuthorFence,
        IMMUTABLE_RESOURCE_AUTH_ROUTES, 'author',
      );
    }).toThrowError('/resources immutable auth requirement is missing paths');
  });

  it('fails when root-mounted locks gains a route outside its explicit fence', () => {
    const registration = ROOT_MOUNTED_NAMESPACE_REGISTRY.find(
      ({ namespace }) => namespace === '/locks',
    )!;
    expect(registration.authPaths).not.toBeNull();
    const router = registration.module.createRouter();
    router.post('/locks/unfenced', (context) => context.json({ exposed: true }));

    expect(() => assertFenceComplete('/locks', router, registration.authPaths ?? []))
      .toThrowError('/locks mounted namespace fence is missing registered paths');
  });

  it('fails when the live root-mounted business router gains an unfenced mutation', () => {
    const registration = ROOT_MOUNTED_NAMESPACE_REGISTRY.find(
      ({ namespace }) => namespace === '/business',
    )!;
    expect(registration.authPaths).not.toBeNull();
    const router = registration.module.createRouter();
    router.post('/organizations/unfenced', (context) => context.json({ exposed: true }));

    expect(() => assertFenceComplete('/business', router, registration.authPaths ?? []))
      .toThrowError('/business mounted namespace fence is missing registered paths');
  });

  it('fails when the live root-mounted analytics router gains an unfenced mutation', () => {
    const registration = ROOT_MOUNTED_NAMESPACE_REGISTRY.find(
      ({ namespace }) => namespace === '/analytics',
    )!;
    const router = registration.module.createRouter();
    router.post('/analytics/unfenced', (context) => context.json({ exposed: true }));

    expect(() => assertFenceComplete('/analytics', router, registration.authPaths!))
      .toThrowError('/analytics mounted namespace fence is missing registered paths');
  });

  it('fails when the live root-mounted workspace router gains an unfenced mutation', () => {
    const registration = ROOT_MOUNTED_NAMESPACE_REGISTRY.find(
      ({ namespace }) => namespace === '/workspaces',
    )!;
    const router = registration.module.createRouter();
    router.post('/workspaces/unfenced', (context) => context.json({ exposed: true }));

    expect(() => assertFenceComplete('/workspaces', router, registration.authPaths!))
      .toThrowError('/workspaces mounted namespace fence is missing registered paths');
  });

  it('fails when the live root-mounted config router gains an unfenced mutation', () => {
    const registration = ROOT_MOUNTED_NAMESPACE_REGISTRY.find(
      ({ namespace }) => namespace === '/config',
    )!;
    const router = registration.module.createRouter();
    router.put('/settings/unfenced', (context) => context.json({ exposed: true }));

    expect(() => assertFenceComplete('/config', router, registration.authPaths!))
      .toThrowError('/config mounted namespace fence is missing registered paths');
  });

  it('fails when the live root-mounted document router gains an unfenced mutation', () => {
    const registration = ROOT_MOUNTED_NAMESPACE_REGISTRY.find(
      ({ namespace }) => namespace === '/documents',
    )!;
    const router = registration.module.createRouter();
    router.post('/documents/unfenced', (context) => context.json({ exposed: true }));

    expect(() => assertFenceComplete('/documents', router, registration.authPaths!))
      .toThrowError('/documents mounted namespace fence is missing registered paths');
  });

  it('fails when the live root-mounted transfer router gains an unfenced mutation', () => {
    const registration = ROOT_MOUNTED_NAMESPACE_REGISTRY.find(
      ({ namespace }) => namespace === '/transfers',
    )!;
    const router = registration.module.createRouter();
    router.post('/imports/unfenced', (context) => context.json({ exposed: true }));

    expect(() => assertFenceComplete('/transfers', router, registration.authPaths!))
      .toThrowError('/transfers mounted namespace fence is missing registered paths');
  });

  it('fails when transfer routes and its mutable auth fence shrink together', () => {
    const missingPath = '/imports/preview';
    const registration = ROOT_MOUNTED_NAMESPACE_REGISTRY.find(
      ({ namespace }) => namespace === '/transfers',
    )!;
    const mutation = {
      routes: registration.module.createRouter().routes.filter(
        (route) => route.path !== missingPath,
      ),
    };
    const shrunkenFence = registration.authPaths!.filter((path) => path !== missingPath);

    expect(() => {
      assertFenceComplete('/transfers', mutation, shrunkenFence);
      assertImmutableMethodRequirement(
        '/transfers', mutation, shrunkenFence, requireAuth, IMMUTABLE_TRANSFER_AUTH_ROUTES,
      );
    }).toThrowError('/transfers immutable auth requirement is missing paths');
  });

  it('fails when the live root-mounted clients router gains an unfenced mutation', () => {
    const registration = ROOT_MOUNTED_NAMESPACE_REGISTRY.find(
      ({ namespace }) => namespace === '/clients',
    )!;
    const router = registration.module.createRouter();
    router.post('/chrome-extension/unfenced', (context) => context.json({ exposed: true }));

    expect(() => assertFenceComplete('/clients', router, registration.authPaths!))
      .toThrowError('/clients mounted namespace fence is missing registered paths');
  });

  it('fails when the live root-mounted admin router gains an unfenced mutation', () => {
    const registration = ROOT_MOUNTED_NAMESPACE_REGISTRY.find(
      ({ namespace }) => namespace === '/admin',
    )!;
    const router = registration.module.createRouter();
    router.post('/admin/unfenced', (context) => context.json({ exposed: true }));

    expect(() => assertFenceComplete('/admin', router, registration.authPaths!))
      .toThrowError('/admin mounted namespace fence is missing registered paths');
  });

  it('fails when admin routes and mutable auth/author fences shrink together', () => {
    const missingPath = '/admin/users/:id/approve';
    const registration = ROOT_MOUNTED_NAMESPACE_REGISTRY.find(
      ({ namespace }) => namespace === '/admin',
    )!;
    const mutation = {
      routes: registration.module.createRouter().routes.filter(
        (route) => route.path !== missingPath,
      ),
    };
    const authPaths = registration.authPaths!.filter((path) => path !== missingPath);
    const authorPaths = ('authorPaths' in registration ? registration.authorPaths : [])
      .filter((path) => path !== missingPath);

    expect(() => {
      assertFenceComplete('/admin', mutation, authPaths);
      assertImmutableMethodRequirement(
        '/admin', mutation, authPaths, requireAuth, IMMUTABLE_ADMIN_AUTH_ROUTES,
      );
      assertImmutableMethodRequirement(
        '/admin', mutation, authorPaths, adminAuthorFence, IMMUTABLE_ADMIN_AUTH_ROUTES, 'author',
      );
    }).toThrowError('/admin immutable auth requirement is missing paths');
  });

  it.each([
    {
      name: 'app-admin', path: '/admin/users/:id/approve', prefix: '/admin/users',
      handler: requireAdminApp, immutable: IMMUTABLE_ADMIN_APP_PATHS,
    },
    {
      name: 'admin', path: '/admin/tenant-resolution-metrics',
      prefix: '/admin/tenant-resolution-metrics', handler: requireAdmin,
      immutable: IMMUTABLE_ADMIN_PATHS,
    },
  ])('fails when admin $name wiring and its fence shrink together', ({
    name, path, prefix, handler, immutable,
  }) => {
    const registration = ROOT_MOUNTED_NAMESPACE_REGISTRY.find(
      ({ namespace }) => namespace === '/admin',
    )!;
    const mutation = {
      routes: registration.module.createRouter().routes.filter(
        (route) => route.path !== path || route.handler !== handler,
      ),
    };
    const fences = registration.privilegedFences!.map((fence) => fence.name === name
      ? {
          ...fence,
          paths: fence.paths.filter((candidate) => candidate !== path),
          pathPrefixes: fence.pathPrefixes.filter((candidate) => candidate !== prefix),
        }
      : fence);

    expect(() => {
      assertPrivilegedMiddlewareFencesComplete('/admin', mutation, fences, name, handler);
      assertImmutablePrivilegedRequirement(
        '/admin', mutation, fences, name, handler, immutable,
      );
    }).toThrowError(`/admin ${name} immutable requirement is missing privileged paths`);
  });

  it('fails when client routes and its mutable auth fence shrink together', () => {
    const missingPath = '/chrome-extension/tabs/register';
    const registration = ROOT_MOUNTED_NAMESPACE_REGISTRY.find(
      ({ namespace }) => namespace === '/clients',
    )!;
    const mutation = {
      routes: registration.module.createRouter().routes.filter(
        (route) => route.path !== missingPath,
      ),
    };
    const shrunkenFence = registration.authPaths!.filter((path) => path !== missingPath);

    expect(() => {
      assertFenceComplete('/clients', mutation, shrunkenFence);
      assertImmutableMethodRequirement(
        '/clients', mutation, shrunkenFence, requireAuth, IMMUTABLE_CLIENT_AUTH_ROUTES,
      );
    }).toThrowError('/clients immutable auth requirement is missing paths');
  });

  it.each([
    { name: 'admin', path: '/settings/vscode-extension-token', handler: requireAdmin },
    {
      name: 'editor',
      path: '/vscode-extension/workspace-mapping/code-workspace',
      handler: requireEditor,
    },
  ])('fails when client $name wiring and its sub-fence shrink together', ({ name, path, handler }) => {
    const registration = ROOT_MOUNTED_NAMESPACE_REGISTRY.find(
      ({ namespace }) => namespace === '/clients',
    )!;
    const mutation = {
      routes: registration.module.createRouter().routes.filter(
        (route) => route.path !== path || route.handler !== handler,
      ),
    };
    const shrunkenFences = registration.privilegedFences!.map((fence) => fence.name === name
      ? {
          ...fence,
          paths: fence.paths.filter((candidate) => candidate !== path),
          pathPrefixes: fence.pathPrefixes.filter((candidate) => candidate !== path),
        }
      : fence);
    const immutable = name === 'admin'
      ? IMMUTABLE_CLIENT_ADMIN_PATHS
      : IMMUTABLE_CLIENT_EDITOR_PATHS;

    expect(() => {
      assertPrivilegedMiddlewareFencesComplete('/clients', mutation, shrunkenFences, name, handler);
      assertImmutablePrivilegedRequirement(
        '/clients', mutation, shrunkenFences, name, handler, immutable,
      );
    }).toThrowError(`/clients ${name} immutable requirement is missing privileged paths`);
  });

  it('fails when the live analytics editor middleware is removed', () => {
    const registration = ROOT_MOUNTED_NAMESPACE_REGISTRY.find(
      ({ namespace }) => namespace === '/analytics',
    )!;
    const router = registration.module.createRouter();
    const mutation = {
      routes: router.routes.filter((route) => (
        route.path !== '/analytics/executive-summary' || route.handler !== requireEditor
      )),
    };

    expect(() => assertPrivilegedMiddlewareFencesComplete(
      '/analytics', mutation, registration.privilegedFences!, 'editor', requireEditor,
    )).toThrowError('/analytics editor fence is missing middleware wiring');
  });

  it('fails when analytics editor wiring and its declared sub-fence shrink together', () => {
    const missingPath = '/analytics/executive-summary';
    const registration = ROOT_MOUNTED_NAMESPACE_REGISTRY.find(
      ({ namespace }) => namespace === '/analytics',
    )!;
    const router = registration.module.createRouter();
    const mutation = {
      routes: router.routes.filter((route) => (
        route.path !== missingPath || route.handler !== requireEditor
      )),
    };
    const privilegedFence = registration.privilegedFences![0];
    const shrunkenFence = {
      ...privilegedFence,
      paths: privilegedFence.paths.filter((path) => path !== missingPath),
      pathPrefixes: privilegedFence.pathPrefixes.filter((path) => path !== missingPath),
    };

    expect(() => {
      assertPrivilegedFenceComplete(
        '/analytics', mutation, registration.authPaths!, shrunkenFence,
      );
      assertPrivilegedMiddlewareFencesComplete(
        '/analytics', mutation, [shrunkenFence], 'editor', requireEditor,
      );
      assertImmutablePrivilegedRequirement(
        '/analytics',
        mutation,
        [shrunkenFence],
        'editor',
        requireEditor,
        IMMUTABLE_ANALYTICS_EDITOR_PATHS,
      );
    }).toThrowError('/analytics editor immutable requirement is missing privileged paths');
  });

  it('fails when workspace editor wiring and its declared sub-fence shrink together', () => {
    const missingPath = '/workspaces/:id/gate-config';
    const registration = ROOT_MOUNTED_NAMESPACE_REGISTRY.find(
      ({ namespace }) => namespace === '/workspaces',
    )!;
    const mutation = {
      routes: registration.module.createRouter().routes.filter((route) => (
        route.path !== missingPath || route.handler !== requireEditor
      )),
    };
    const privilegedFence = registration.privilegedFences![0];
    const shrunkenFence = {
      ...privilegedFence,
      paths: privilegedFence.paths.filter((path) => path !== missingPath),
      pathPrefixes: privilegedFence.pathPrefixes.filter((path) => path !== missingPath),
    };

    expect(() => {
      assertPrivilegedFenceComplete(
        '/workspaces', mutation, registration.authPaths!, shrunkenFence,
      );
      assertPrivilegedMiddlewareFencesComplete(
        '/workspaces', mutation, [shrunkenFence], 'editor', requireEditor,
      );
      assertImmutablePrivilegedRequirement(
        '/workspaces',
        mutation,
        [shrunkenFence],
        'editor',
        requireEditor,
        IMMUTABLE_WORKSPACE_EDITOR_PATHS,
      );
    }).toThrowError('/workspaces editor immutable requirement is missing privileged paths');
  });

  it('fails when config admin wiring and its declared sub-fence shrink together', () => {
    const missingPath = '/ai-settings/:key';
    const registration = ROOT_MOUNTED_NAMESPACE_REGISTRY.find(
      ({ namespace }) => namespace === '/config',
    )!;
    const mutation = withoutRequireAdminPath(registration.module.createRouter(), missingPath);
    const privilegedFence = registration.privilegedFences![0];
    const shrunkenFence = {
      ...privilegedFence,
      paths: privilegedFence.paths.filter((path) => path !== missingPath),
      pathPrefixes: privilegedFence.pathPrefixes.filter((path) => path !== '/ai-settings'),
    };

    expect(() => {
      assertPrivilegedFenceComplete('/config', mutation, registration.authPaths!, shrunkenFence);
      assertPrivilegedMiddlewareFencesComplete(
        '/config', mutation, [shrunkenFence], 'admin', requireAdmin,
      );
      assertImmutablePrivilegedRequirement(
        '/config',
        mutation,
        [shrunkenFence],
        'admin',
        requireAdmin,
        IMMUTABLE_CONFIG_ADMIN_PATHS,
      );
    }).toThrowError('/config admin immutable requirement is missing privileged paths');
  });

  it('fails when a flagged privileged path is absent from its sub-fence', () => {
    const router = new Hono();
    router.get('/admin/listed', (context) => context.body(null, 204));
    router.post('/admin/missing', (context) => context.body(null, 204));

    expect(() => assertPrivilegedFenceComplete(
      '/fixture',
      router,
      ['/admin/listed', '/admin/missing'],
      { name: 'admin', paths: ['/admin/listed'], pathPrefixes: ['/admin'] },
    )).toThrowError('/fixture admin sub-fence is missing privileged paths');
  });

  it('fails when requireAdmin is wired outside every privileged sub-fence', () => {
    const router = new Hono();
    router.post('/future-admin-action', requireAdmin, (context) => context.body(null, 204));

    expect(() => assertPrivilegedMiddlewareFencesComplete(
      '/fixture', router, [], 'admin', requireAdmin,
    )).toThrowError('/fixture admin wiring is outside its privileged sub-fence');
  });

  it('fails when an editor fence loses its independent role middleware', () => {
    const router = new Hono();
    router.post('/editor-action', (context) => context.body(null, 204));

    expect(() => assertPrivilegedMiddlewareFencesComplete(
      '/fixture',
      router,
      [{ name: 'editor', paths: ['/editor-action'], pathPrefixes: ['/editor-action'] }],
      'editor',
      requireEditor,
    )).toThrowError('/fixture editor fence is missing middleware wiring');
  });

  it.each([
    { namespace: '/agents', missingPath: '/prompts/test-tavily' },
    { namespace: '/workflows', missingPath: '/workspace-types/:type/workflows/:id' },
  ])(
    'fails when $namespace admin wiring and its declared sub-fence shrink together',
    ({ namespace, missingPath }) => {
      const registration = ROOT_MOUNTED_NAMESPACE_REGISTRY.find(
        (item) => item.namespace === namespace,
      )!;
      const router = withoutRequireAdminPath(registration.module.createRouter(), missingPath);
      const privilegedFence = registration.privilegedFences![0];
      const shrunkenFence = {
        ...privilegedFence,
        paths: privilegedFence.paths.filter((path) => path !== missingPath),
      };

      expect(registeredPaths(router)).toContain(missingPath);
      expect(router.routes.some(
        (route) => route.path === missingPath && route.handler === requireAdmin,
      )).toBe(false);
      expect(() => assertPrivilegedFenceComplete(
        namespace,
        router,
        registration.authPaths!,
        shrunkenFence,
      )).toThrowError(`${namespace} admin sub-fence is missing privileged paths`);
    },
  );
});
