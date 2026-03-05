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

describe('vscode local tools runtime', () => {
  let workspaceRoot = '';
  let outsideFilePath = '';

  beforeEach(async () => {
    workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'topai-vscode-tools-'));
    await fs.writeFile(path.join(workspaceRoot, '.env'), 'OPENAI_API_KEY=secret\n', 'utf8');
    await fs.writeFile(path.join(workspaceRoot, 'notes.txt'), 'line1\nline2\nline3\nline4', 'utf8');
    await fs.writeFile(
      path.join(workspaceRoot, 'search.txt'),
      Array.from({ length: 25 }, (_, i) => `foo-${i + 1}`).join('\n'),
      'utf8',
    );
    outsideFilePath = path.join(path.dirname(workspaceRoot), `outside-${Date.now()}.txt`);
    await fs.writeFile(outsideFilePath, 'outside-line-1\noutside-line-2\n', 'utf8');
  });

  afterEach(async () => {
    if (workspaceRoot) {
      await fs.rm(workspaceRoot, { recursive: true, force: true });
    }
    if (outsideFilePath) {
      await fs.rm(outsideFilePath, { force: true });
    }
  });

  it('blocks sensitive file reads by default guardrail', async () => {
    const runtime = await createRuntime(workspaceRoot, createState());

    const result = await runtime.execute({
      toolCallId: 'read-sensitive-1',
      name: 'file_read',
      args: { path: '.env', full: true },
    });

    expect(result.ok).toBe(false);
    expect(String(result.error ?? '')).toMatch(/sensitive path/i);
  });

  it('supports rg pagination via offset + maxResults', async () => {
    const runtime = await createRuntime(workspaceRoot, createState());

    const result = await runtime.execute({
      toolCallId: 'rg-1',
      name: 'rg',
      args: {
        pattern: 'foo-',
        path: 'search.txt',
        maxResults: 5,
        offset: 3,
      },
    });

    expect(result.ok).toBe(true);
    expect(result.result).toMatchObject({
      offset: 3,
      nextOffset: 8,
      truncated: true,
    });
    expect(Array.isArray((result.result as any).results)).toBe(true);
    expect((result.result as any).results).toHaveLength(5);
  });

  it('applies file_edit apply_patch mode after explicit allow_once decision', async () => {
    const runtime = await createRuntime(workspaceRoot, createState());
    await fs.writeFile(path.join(workspaceRoot, 'patch-target.txt'), 'before\n', 'utf8');

    const patch = [
      'diff --git a/patch-target.txt b/patch-target.txt',
      'index 1b9a6f5..fe7a8f3 100644',
      '--- a/patch-target.txt',
      '+++ b/patch-target.txt',
      '@@ -1 +1 @@',
      '-before',
      '+after',
      '',
    ].join('\n');

    const first = await runtime.execute({
      toolCallId: 'edit-1',
      name: 'file_edit',
      args: {
        mode: 'apply_patch',
        patch,
      },
    });

    expect(first.ok).toBe(false);
    expect(first.error).toBe('permission_required');
    expect(first.permissionRequest?.requestId).toBeTruthy();

    await expect(
      runtime.decide({
        requestId: first.permissionRequest?.requestId,
        decision: 'allow_once',
      }),
    ).resolves.toMatchObject({ ok: true });

    const second = await runtime.execute({
      toolCallId: 'edit-1',
      name: 'file_edit',
      args: {
        mode: 'apply_patch',
        patch,
      },
    });

    expect(second.ok).toBe(true);
    expect(second.result).toMatchObject({ mode: 'apply_patch', applied: true });
    await expect(fs.readFile(path.join(workspaceRoot, 'patch-target.txt'), 'utf8')).resolves.toContain(
      'after',
    );
  });

  it('supports allow_once for bash ask decisions on same tool call id', async () => {
    const runtime = await createRuntime(workspaceRoot, createState());

    const first = await runtime.execute({
      toolCallId: 'bash-1',
      name: 'bash',
      args: { command: 'echo lot3' },
    });

    expect(first.ok).toBe(false);
    expect(first.error).toBe('permission_required');

    await runtime.decide({
      requestId: first.permissionRequest?.requestId,
      decision: 'allow_once',
    });

    const second = await runtime.execute({
      toolCallId: 'bash-1',
      name: 'bash',
      args: { command: 'echo lot3' },
    });

    expect(second.ok).toBe(true);
    expect(String((second.result as any)?.stdout ?? '')).toContain('lot3');
  });

  it('supports allow_always immediate resume and persistence for equivalent bash calls', async () => {
    const runtime = await createRuntime(workspaceRoot, createState());

    const first = await runtime.execute({
      toolCallId: 'bash-always-1',
      name: 'bash',
      args: { command: 'echo keep' },
    });

    expect(first.ok).toBe(false);
    expect(first.error).toBe('permission_required');

    await runtime.decide({
      requestId: first.permissionRequest?.requestId,
      decision: 'allow_always',
    });

    const resumed = await runtime.execute({
      toolCallId: 'bash-always-1',
      name: 'bash',
      args: { command: 'echo keep' },
    });
    expect(resumed.ok).toBe(true);
    expect(String((resumed.result as any)?.stdout ?? '')).toContain('keep');

    const persisted = await runtime.execute({
      toolCallId: 'bash-always-2',
      name: 'bash',
      args: { command: 'echo keep' },
    });
    expect(persisted.ok).toBe(true);
    expect(String((persisted.result as any)?.stdout ?? '')).toContain('keep');
  });

  it('prompts for outside-workspace file_read and resumes after allow_once', async () => {
    const runtime = await createRuntime(workspaceRoot, createState());
    const outsidePath = `../${path.basename(outsideFilePath)}`;

    const first = await runtime.execute({
      toolCallId: 'outside-read-1',
      name: 'file_read',
      args: { path: outsidePath, full: true },
    });

    expect(first.ok).toBe(false);
    expect(first.error).toBe('permission_required');
    expect(String(first.permissionRequest?.details?.path ?? '')).toContain('outside:');

    await runtime.decide({
      requestId: first.permissionRequest?.requestId,
      decision: 'allow_once',
    });

    const second = await runtime.execute({
      toolCallId: 'outside-read-1',
      name: 'file_read',
      args: { path: outsidePath, full: true },
    });
    expect(second.ok).toBe(true);
    expect(String((second.result as any)?.content ?? '')).toContain('outside-line-1');
  });

  it('uses workspace-wide "*" policy for file_edit allow_always and reuses it on equivalent edits', async () => {
    const runtime = await createRuntime(workspaceRoot, createState());
    await fs.writeFile(path.join(workspaceRoot, 'edit-a.txt'), 'a\n', 'utf8');
    await fs.writeFile(path.join(workspaceRoot, 'edit-b.txt'), 'b\n', 'utf8');

    const first = await runtime.execute({
      toolCallId: 'edit-wildcard-1',
      name: 'file_edit',
      args: { mode: 'write', path: 'edit-a.txt', content: 'a-updated\n' },
    });

    expect(first.ok).toBe(false);
    expect(first.error).toBe('permission_required');
    expect(first.permissionRequest?.details?.path).toBe('*');

    await runtime.decide({
      requestId: first.permissionRequest?.requestId,
      decision: 'allow_always',
    });

    const resumed = await runtime.execute({
      toolCallId: 'edit-wildcard-1',
      name: 'file_edit',
      args: { mode: 'write', path: 'edit-a.txt', content: 'a-updated\n' },
    });
    expect(resumed.ok).toBe(true);

    const second = await runtime.execute({
      toolCallId: 'edit-wildcard-2',
      name: 'file_edit',
      args: { mode: 'write', path: 'edit-b.txt', content: 'b-updated\n' },
    });
    expect(second.ok).toBe(true);

    await expect(fs.readFile(path.join(workspaceRoot, 'edit-b.txt'), 'utf8')).resolves.toContain(
      'b-updated',
    );
  });
});
