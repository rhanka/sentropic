import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { requireAuth } from '../../src/middleware/auth';
import { requireAdmin } from '../../src/middleware/rbac';
import {
  MOUNTED_NAMESPACE_REGISTRY,
  PREFIX_MOUNTED_NAMESPACE_REGISTRY,
  PRODUCT_CLUSTER_MESH_MOUNTS,
  ROOT_MOUNTED_NAMESPACE_REGISTRY,
  ROOT_MOUNT_REMAPS,
  type PrivilegedPathFence,
} from '../../src/app';

type RootMountedRouter = Pick<Hono, 'routes'>;

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

const assertRequireAdminSubFenceComplete = (
  namespace: string,
  router: RootMountedRouter,
  privilegedFences: readonly PrivilegedPathFence[],
): void => {
  const privilegedPaths = new Set(privilegedFences.flatMap(({ paths }) => paths));
  const missing = router.routes
    .filter(({ handler }) => handler === requireAdmin)
    .map(({ path }) => path)
    .filter((path) => !privilegedPaths.has(path));
  expect(
    [...new Set(missing)].sort(),
    `${namespace} requireAdmin wiring is outside every privileged sub-fence`,
  ).toEqual([]);
};

describe('mounted namespace fence completeness', () => {
  it.each(MOUNTED_NAMESPACE_REGISTRY)(
    'covers every registered path and privileged sub-fence for $namespace',
    ({ namespace, module, authPaths, ...registration }) => {
      expect(module.namespace).toBe(namespace);
      const router = module.createRouter();
      const privilegedFences = registration.privilegedFences ?? [];
      assertRequireAdminSubFenceComplete(namespace, router, privilegedFences);
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

    expect(() => assertRequireAdminSubFenceComplete('/fixture', router, []))
      .toThrowError('/fixture requireAdmin wiring is outside every privileged sub-fence');
  });
});
