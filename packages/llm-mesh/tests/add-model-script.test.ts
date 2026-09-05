import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const script = resolve(process.cwd(), 'scripts/add-model.mjs');
const roots: string[] = [];

const fixture = async () => {
  const root = await mkdtemp(join(tmpdir(), 'llm-model-scaffold-'));
  roots.push(root);
  const sourceDir = join(root, 'packages/llm-mesh/src');
  await mkdir(sourceDir, { recursive: true });
  const files = {
    catalog: join(sourceDir, 'catalog.ts'),
    providers: join(sourceDir, 'providers.ts'),
    routing: join(sourceDir, 'routing-targets.ts'),
  };
  await writeFile(files.catalog, `export const modelProfiles = [
  {
    providerId: 'openai',
    modelId: 'gpt-base',
    label: 'GPT Base',
    reasoningTier: 'advanced',
    defaultTaskHints: ['chat'],
    capabilities: modelCapabilities('openai', 'advanced'),
  },
] as const;
`);
  await writeFile(files.providers, `export const knownModelIds = [
  'gpt-base',
] as const;

export const knownModelIdsByProvider = {
  openai: [
    'gpt-base',
  ],
} as const;
`);
  await writeFile(files.routing, `export const DEFAULT_TARGET_MAPPINGS = {
  'gpt-base': {
    providerId: 'openai', transportProviderId: 'codex', model: 'gpt-base',
  },
};

const STANDARD_ROUTE_DEFINITIONS = [];
`);
  return { root, files };
};

const run = (root: string, ...extra: string[]) => spawnSync(process.execPath, [
  script, '--root', root, '--model', 'gpt-next', '--base', 'gpt-base', ...extra,
], { encoding: 'utf8' });

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('add-model scaffold', () => {
  it('should leave every source unchanged in dry-run mode', async () => {
    const { root, files } = await fixture();
    const before = await Promise.all(Object.values(files).map((file) => readFile(file, 'utf8')));

    const result = run(root, '--dry-run');

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('Dry run: catalog, providers, routing');
    await expect(Promise.all(
      Object.values(files).map((file) => readFile(file, 'utf8')),
    )).resolves.toEqual(before);
  });

  it('should copy valid stubs once and repair a missing provider entry', async () => {
    const { root, files } = await fixture();

    const first = run(root);
    expect(first.status, first.stderr).toBe(0);
    expect(await readFile(files.catalog, 'utf8')).toContain("modelId: 'gpt-next'");
    expect(await readFile(files.catalog, 'utf8')).toContain("label: '[VERIFY] gpt-next'");
    expect(await readFile(files.routing, 'utf8')).toContain("'gpt-next': {");

    const second = run(root);
    expect(second.status, second.stderr).toBe(0);
    expect(second.stdout).toContain('Applied: no changes');

    const providers = await readFile(files.providers, 'utf8');
    await writeFile(files.providers, providers.replace("    'gpt-next',\n", ''));
    const repair = run(root);
    expect(repair.status, repair.stderr).toBe(0);
    expect(repair.stdout).toContain('Applied: providers');
    expect(await readFile(files.providers, 'utf8')).toContain("    'gpt-next',");
  });

  it('should extend an inline provider registry', async () => {
    const { root, files } = await fixture();
    const providers = await readFile(files.providers, 'utf8');
    await writeFile(files.providers, providers.replace(
      "  openai: [\n    'gpt-base',\n  ],",
      "  openai: ['gpt-base'],",
    ));

    const result = run(root);

    expect(result.status, result.stderr).toBe(0);
    expect(await readFile(files.providers, 'utf8'))
      .toContain("  openai: ['gpt-base', 'gpt-next'],");
  });

  it('should recognize the new repository models as already scaffolded', () => {
    const root = resolve(process.cwd(), '../..');
    for (const [model, base] of [
      ['claude-fable-5-1', 'claude-fable-5'],
      ['gpt-6-astra', 'gpt-5.6-sol'],
    ]) {
      const result = spawnSync(process.execPath, [
        script, '--root', root, '--model', model, '--base', base, '--dry-run',
      ], { encoding: 'utf8' });
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain('Dry run: no changes');
    }
  });

  it('should reject invalid ids and a BASE without a faithful route before writing', async () => {
    const { root, files } = await fixture();
    const invalid = spawnSync(process.execPath, [
      script, '--root', root, '--model', '../bad', '--base', 'gpt-base',
    ], { encoding: 'utf8' });
    expect(invalid.status).not.toBe(0);

    await writeFile(files.routing, 'export const DEFAULT_TARGET_MAPPINGS = {\n};\n');
    const unrouted = run(root);
    expect(unrouted.status).not.toBe(0);
    expect(unrouted.stderr).toContain('BASE route not found');
    expect(await readFile(files.catalog, 'utf8')).not.toContain("modelId: 'gpt-next'");
  });
});
