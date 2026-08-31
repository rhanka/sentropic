import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import {
  ROOT_MOUNTED_NAMESPACE_REGISTRY,
  ROOT_MOUNT_REMAPS,
  type PrivilegedPathFence,
} from '../../src/app';

type RootMountedRouter = Pick<Hono, 'routes'>;

const registeredPaths = (router: RootMountedRouter): string[] =>
  [...new Set(router.routes.map(({ path }) => path))].sort();

const assertFenceComplete = (
  namespace: string,
  router: RootMountedRouter,
  fence: readonly string[],
): void => {
  const fencedPaths = new Set(fence);
  const missing = registeredPaths(router).filter((path) => !fencedPaths.has(path));
  expect(missing, `${namespace} root-mount fence is missing registered paths`).toEqual([]);
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

describe('root-mount fence completeness', () => {
  it.each(ROOT_MOUNTED_NAMESPACE_REGISTRY)(
    'covers every registered path and privileged sub-fence for $namespace',
    ({ namespace, module, authPaths, ...registration }) => {
      expect(module.namespace).toBe(namespace);
      const router = module.createRouter();
      assertFenceComplete(namespace, router, authPaths);
      for (const privilegedFence of registration.privilegedFences ?? []) {
        assertPrivilegedFenceComplete(namespace, router, authPaths, privilegedFence);
      }
    },
  );

  it('derives every root remap from the exported registry', () => {
    expect(Object.keys(ROOT_MOUNT_REMAPS)).toEqual(
      ROOT_MOUNTED_NAMESPACE_REGISTRY.map(({ namespace }) => namespace),
    );
    expect(Object.values(ROOT_MOUNT_REMAPS)).toEqual(
      ROOT_MOUNTED_NAMESPACE_REGISTRY.map(() => '/'),
    );
  });

  it('fails when a registered path is absent from its fence', () => {
    const router = new Hono();
    router.get('/listed', (context) => context.body(null, 204));
    router.post('/missing', (context) => context.body(null, 204));

    expect(() => assertFenceComplete('/fixture', router, ['/listed'])).toThrowError(
      '/fixture root-mount fence is missing registered paths',
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
});
