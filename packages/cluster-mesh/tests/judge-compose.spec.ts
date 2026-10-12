import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import type { VerifiedInvocationContextPort } from '@sentropic/contracts';
import type { InvocationReceiptPort } from '@sentropic/events';
import { createClusterMeshModules } from '../src/index.js';
import { createModuleRegistry } from '../src/modules/registry.js';
import { isClusterMeshModuleUnavailableError } from '../src/modules/errors.js';
import { createLlmMeshNamespaceModule, type LlmMeshRouterInput } from '../src/compose/llm-mesh.js';
import { fakeMesh, PackageTree } from './fixtures/package-tree.js';

describe('judge compose llm-mesh namespace module', () => {
  const dummyContext: VerifiedInvocationContextPort = {
    async verify(input) { return input as never; },
  };
  const dummyReceipts: InvocationReceiptPort = { append: vi.fn(async () => undefined) };

  it('acquires nothing when disabled even if judge is requested', async () => {
    const modules = createClusterMeshModules();
    const createRouter = vi.fn((_input: LlmMeshRouterInput) => new Hono());
    const module = await createLlmMeshNamespaceModule(modules, {
      enabled: false,
      judge: true,
      createRouter,
    });

    expect(module.namespace).toBe('/llm-mesh');
    expect(module.enabled).toBe(false);
    expect(modules.snapshot()['llm-mesh'].state).toBe('unprobed');
    expect(modules.snapshot()['llm-mesh/judge/host'].state).toBe('unprobed');

    expect(() => module.createRouter({ context: dummyContext, receipts: dummyReceipts })).toThrow(/disabled/);
    expect(createRouter).not.toHaveBeenCalled();
  });

  it('acquires only llm-mesh when judge is omitted or false', async () => {
    const modules = createClusterMeshModules();
    let captured: LlmMeshRouterInput | undefined;
    const createRouter = vi.fn((input: LlmMeshRouterInput) => {
      captured = input;
      return new Hono().get('/ping', (c) => c.text('pong'));
    });
    const module = await createLlmMeshNamespaceModule(modules, {
      enabled: true,
      judge: false,
      createRouter,
    });

    expect(module.namespace).toBe('/llm-mesh');
    expect(module.enabled).toBe(true);
    expect(modules.snapshot()['llm-mesh'].state).toBe('loaded');
    expect(modules.snapshot()['llm-mesh/judge/host'].state).toBe('unprobed');

    module.createRouter({ context: dummyContext, receipts: dummyReceipts });
    expect(createRouter).toHaveBeenCalledOnce();
    expect(captured?.judgeHost).toBeUndefined();
    expect(typeof captured?.llmMesh.createLlmMesh).toBe('function');
  });

  it('acquires both llm-mesh and judgeHost when judge is true', async () => {
    const modules = createClusterMeshModules();
    let captured: LlmMeshRouterInput | undefined;
    const createRouter = vi.fn((input: LlmMeshRouterInput) => {
      captured = input;
      return new Hono().get('/judge', (c) => c.text('ok'));
    });
    const module = await createLlmMeshNamespaceModule(modules, {
      enabled: true,
      judge: true,
      createRouter,
    });

    expect(module.namespace).toBe('/llm-mesh');
    expect(module.enabled).toBe(true);
    expect(modules.snapshot()['llm-mesh'].state).toBe('loaded');
    expect(modules.snapshot()['llm-mesh/judge/host'].state).toBe('loaded');

    module.createRouter({ context: dummyContext, receipts: dummyReceipts });
    expect(createRouter).toHaveBeenCalledOnce();
    expect(typeof captured?.llmMesh.createLlmMesh).toBe('function');
    expect(typeof captured?.judgeHost?.createJudgeService).toBe('function');
    expect(typeof captured?.judgeHost?.createJevAdapter).toBe('function');
  });

  it('fails at composition when judge module is disabled or unavailable', async () => {
    const disabledModules = createClusterMeshModules({ disabled: ['llm-mesh/judge/host'] });
    const createRouter = vi.fn(() => new Hono());
    const errDisabled = await createLlmMeshNamespaceModule(disabledModules, {
      enabled: true,
      judge: true,
      createRouter,
    }).catch((e: unknown) => e);

    expect(isClusterMeshModuleUnavailableError(errDisabled)).toBe(true);
    expect(errDisabled).toMatchObject({
      code: 'cluster_mesh_module_unavailable',
      reason: 'disabled',
      moduleId: 'llm-mesh/judge/host',
    });

    const tree = new PackageTree();
    try {
      const anchorDir = tree.dir('app/node_modules/@sentropic/cluster-mesh/dist/modules');
      tree.install('app', fakeMesh('mesh', '0.22.0'));
      const treeModules = createModuleRegistry({}, { anchorDir });
      const errExport = await createLlmMeshNamespaceModule(treeModules, {
        enabled: true,
        judge: true,
        createRouter,
      }).catch((e: unknown) => e);

      expect(isClusterMeshModuleUnavailableError(errExport)).toBe(true);
      expect(errExport).toMatchObject({
        code: 'cluster_mesh_module_unavailable',
        reason: 'export_unavailable',
        moduleId: 'llm-mesh/judge/host',
      });
    } finally {
      tree.cleanup();
    }
  });
});
