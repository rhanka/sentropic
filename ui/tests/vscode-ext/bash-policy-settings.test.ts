import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';

vi.mock('vscode', () => ({ workspace: { workspaceFolders: [] } }), {
  virtual: true,
});

type RuntimeState = {
  store: Map<string, unknown>;
};

const createState = (): RuntimeState => ({
  store: new Map<string, unknown>(),
});

const createRuntime = async (workspaceRoot: string, state: RuntimeState) => {
  const mod = await import('../../vscode-ext/local-tools');
  return new mod.VsCodeLocalToolsRuntime({
    getWorkspaceRoot: () => workspaceRoot,
    getGlobalState: <T>(key: string, fallback: T): T =>
      state.store.has(key) ? (state.store.get(key) as T) : fallback,
    updateGlobalState: async (key: string, value: unknown) => {
      state.store.set(key, value);
    },
  });
};

describe('vscode bash policy settings', () => {
  let workspaceRoot = '';

  beforeEach(async () => {
    workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'topai-vscode-policy-'));
    await fs.mkdir(path.join(workspaceRoot, 'src', 'public'), { recursive: true });
    await fs.mkdir(path.join(workspaceRoot, 'src', 'private'), { recursive: true });
    await fs.writeFile(path.join(workspaceRoot, 'src', 'public', 'a.txt'), 'hello', 'utf8');
    await fs.writeFile(path.join(workspaceRoot, 'src', 'private', 'secret.txt'), 'hidden', 'utf8');
  });

  afterEach(async () => {
    if (workspaceRoot) {
      await fs.rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it('stores and deletes path-scoped permission policies', async () => {
    const state = createState();
    const runtime = await createRuntime(workspaceRoot, state);

    await expect(
      runtime.upsertPolicy({
        toolName: 'ls',
        origin: 'vscode://workspace',
        policy: 'allow',
        pathPattern: 'src/*',
      }),
    ).resolves.toMatchObject({ ok: true });

    await expect(runtime.listPolicies()).resolves.toMatchObject({
      ok: true,
      items: [
        expect.objectContaining({
          toolName: 'ls',
          origin: 'vscode://workspace',
          policy: 'allow',
          pathPattern: 'src/*',
        }),
      ],
    });

    await expect(
      runtime.deletePolicy({
        toolName: 'ls',
        origin: 'vscode://workspace',
        pathPattern: 'src/*',
      }),
    ).resolves.toMatchObject({ ok: true });

    await expect(runtime.listPolicies()).resolves.toMatchObject({ ok: true, items: [] });
  });

  it('applies deny policy on specific path scope while allowing other scopes', async () => {
    const state = createState();
    const runtime = await createRuntime(workspaceRoot, state);

    await runtime.upsertPolicy({
      toolName: 'ls',
      origin: 'vscode://workspace',
      policy: 'allow',
      pathPattern: 'src/*',
    });
    await runtime.upsertPolicy({
      toolName: 'ls',
      origin: 'vscode://workspace',
      policy: 'deny',
      pathPattern: 'src/private',
    });

    const denied = await runtime.execute({
      toolCallId: 'ls-1',
      name: 'ls',
      args: { path: 'src/private' },
    });
    expect(denied.ok).toBe(false);
    expect(String(denied.error ?? '')).toMatch(/Permission denied/i);

    const allowed = await runtime.execute({
      toolCallId: 'ls-2',
      name: 'ls',
      args: { path: 'src/public' },
    });
    expect(allowed.ok).toBe(true);
  });
});
