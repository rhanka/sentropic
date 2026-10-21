import { Hono } from 'hono';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { VerifiedInvocationContextPort } from '@sentropic/contracts';
import type { InvocationReceiptPort } from '@sentropic/events';
import { createClusterMeshModules } from '../src/index.js';
import { createModuleRegistry } from '../src/modules/registry.js';
import { isClusterMeshModuleUnavailableError } from '../src/modules/errors.js';
import { createLlmMeshNamespaceModule, type LlmMeshRouterInput } from '../src/compose/llm-mesh.js';
import { fakeMesh, PackageTree } from './fixtures/package-tree.js';

const tscRequire = createRequire(import.meta.url);
const tsc = tscRequire('typescript');

function newestSourceMtime(dir: string): number {
  let newest = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) newest = Math.max(newest, newestSourceMtime(path));
    else if (entry.name.endsWith('.ts')) newest = Math.max(newest, statSync(path).mtimeMs);
  }
  return newest;
}

function ensureDistFresh(): void {
  const pkgDir = resolve('.');
  const marker = join(pkgDir, 'dist', 'compose', 'llm-mesh.js');
  if (existsSync(marker) && statSync(marker).mtimeMs >= newestSourceMtime(join(pkgDir, 'src'))) return;
  const configPath = join(pkgDir, 'tsconfig.json');
  const configFile = tsc.readConfigFile(configPath, tsc.sys.readFile);
  if (configFile.error) {
    throw new Error(`Cannot read ${configPath}: ${tsc.flattenDiagnosticMessageText(configFile.error.messageText, '\n')}`);
  }
  const parsed = tsc.parseJsonConfigFileContent(configFile.config, tsc.sys, pkgDir);
  const program = tsc.createProgram(parsed.fileNames, parsed.options);
  const emitResult = program.emit();
  const diagnostics = tsc.getPreEmitDiagnostics(program).concat(emitResult.diagnostics);
  if (emitResult.emitSkipped || diagnostics.length > 0) {
    throw new Error(diagnostics.map((d) => tsc.flattenDiagnosticMessageText(d.messageText, '\n')).join('\n') || 'emit skipped');
  }
}

beforeAll(() => {
  ensureDistFresh();
});

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

  it('typechecks and verifies the public README composition example', async () => {
    const readme = readFileSync(resolve('README.md'), 'utf8');
    const blocks = [...readme.matchAll(/```ts\n([\s\S]*?)```/g)].map((m) => m[1]);
    const example = blocks.find((b) => b.includes('createLlmMeshNamespaceModule'));
    expect(example).toBeDefined();
    expect(example).toContain('@sentropic/cluster-mesh/compose/llm-mesh');
    expect(example).toContain('judge: true');
    const pkg = JSON.parse(readFileSync(resolve('package.json'), 'utf8'));
    expect(pkg.exports['./compose/llm-mesh']).toEqual({
      types: './dist/compose/llm-mesh.d.ts',
      import: './dist/compose/llm-mesh.js',
    });
    // The published dist artifact is compiled from this source by the Build
    // step; assert on the committed source so this test runs before the build.
    const composeSource = readFileSync(resolve('src/compose/llm-mesh.ts'), 'utf8');
    expect(composeSource).toContain('createLlmMeshNamespaceModule');
    expect(composeSource).toContain('judgeHost');
    const module = await createLlmMeshNamespaceModule(createClusterMeshModules(), {
      enabled: true,
      judge: true,
      createRouter: ({ llmMesh, judgeHost, context, receipts }) => {
        const router = new Hono();
        expect(typeof llmMesh.createLlmMesh).toBe('function');
        expect(typeof judgeHost?.createJudgeService).toBe('function');
        expect(typeof context.verify).toBe('function');
        expect(typeof receipts.append).toBe('function');
        return router;
      },
    });
    expect(module.namespace).toBe('/llm-mesh');
    expect(module.enabled).toBe(true);
    const router = module.createRouter({ context: dummyContext, receipts: dummyReceipts });
    expect(router).toBeDefined();
    // Compile the extracted README block itself through the published
    // subpath: substring guards cannot catch invalid options or syntax.
    if (!example) throw new Error('README compose block missing');
    const directory = mkdtempSync(join(tmpdir(), 'cluster-readme-'));
    try {
      mkdirSync(join(directory, 'node_modules/@sentropic'), { recursive: true });
      symlinkSync(resolve('.'), join(directory, 'node_modules/@sentropic/cluster-mesh'));
      symlinkSync(resolve('../../node_modules/hono'), join(directory, 'node_modules/hono'));
      const file = join(directory, 'readme-example.mts');
      writeFileSync(file, `${example}\nvoid [module];\n`);
      const program = tsc.createProgram([file], {
        target: tsc.ScriptTarget.ES2022,
        module: tsc.ModuleKind.NodeNext,
        moduleResolution: tsc.ModuleResolutionKind.NodeNext,
        strict: true,
        noEmit: true,
        // Same posture as tsconfig.json: hono's own declarations need a
        // newer TypeScript than the pinned 5.4.5. The example itself stays
        // fully checked; only .d.ts files are skipped.
        skipLibCheck: true,
        types: [],
      });
      const diagnostics = tsc.getPreEmitDiagnostics(program);
      expect(diagnostics.map((d) => tsc.flattenDiagnosticMessageText(d.messageText, '\n'))).toEqual([]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
