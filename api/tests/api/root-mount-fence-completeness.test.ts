import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { createLlmMeshNamespaceModule } from '../../src/routes/namespaces/llm-mesh';
import { LLM_MESH_PATHS } from '../../src/routes/namespaces/llm-mesh-cutover';
import { createWorkflowsNamespaceModule } from '../../src/routes/namespaces/workflows';
import { WORKFLOW_PATHS } from '../../src/routes/namespaces/workflows-cutover';

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

describe('root-mount fence completeness', () => {
  it('covers every registered workflows path', () => {
    assertFenceComplete(
      '/workflows',
      createWorkflowsNamespaceModule().createRouter(),
      WORKFLOW_PATHS,
    );
  });

  it('covers every registered llm-mesh path', () => {
    assertFenceComplete(
      '/llm-mesh',
      createLlmMeshNamespaceModule().createRouter(),
      LLM_MESH_PATHS,
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
});
