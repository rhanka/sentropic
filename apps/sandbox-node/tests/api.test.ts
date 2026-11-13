import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createExecutionNode } from '../src/index.js';
import { CustodyGuard } from '../src/custody.js';
import { AgentApi } from '../src/api.js';

const devScope = { kind: 'ui' as const, writable: ['ui/**'], refused: ['ui/dist/**'], source: { repo: 'test', path: 'registry.ts', commit: 'abc' } };
describe('agent lifecycle transport', () => {
  it('should create, start, stop, export and delete through the dispatched routes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'api-'));
    try {
      const node = createExecutionNode();
      const custody = new CustodyGuard(join(dir, 'wal')); custody.heartbeat();
      const api = new AgentApi(node, custody);
      const call = (path: string, body: unknown, method = 'POST') => api.dispatch({ path, method, tenantId: 'immo', role: 'control-plane', body });
      const owner = { tenantId: 'immo', poolOwned: false, workspaceId: 'ws', principalId: 'u', attemptId: 'a', purpose: 'build', generation: 1, custodyEpoch: 1 };
      const created = await call('/v1/sandboxes', { commandId: 'create', ownership: owner, spec: { tenantId: 'immo', devScope,
        command: ['/bin/sleep', 'infinity'], profile: 'artifact-build', baseMounts: [], uid: 1000, gid: 1000 } });
      const id = (created.body as { id: string }).id;
      expect(created.status).toBe(201);
      expect((await call(`/v1/sandboxes/${id}/start`, { commandId: 'run', devScope, uid: 1000, gid: 1000 })).status).toBe(200);
      expect((await call(`/v1/sandboxes/${id}/stop`, { commandId: 'stop', devScope, stop: { retainOutput: true } })).status).toBe(200);
      const exported = await call(`/v1/sandboxes/${id}/export`, { commandId: 'export', devScope, spec: { buildId: 'b', subPath: 'ui/dist', maxBytes: 10000 } });
      expect(exported.status).toBe(200);
      expect(Buffer.isBuffer(exported.body)).toBe(true);
      expect((await call(`/v1/sandboxes/${id}`, { commandId: 'delete', devScope }, 'DELETE')).status).toBe(200);
      await expect(api.dispatch({ path: '/v1/sandboxes', method: 'POST', role: 'data-plane', tenantId: 'immo', body: {} })).rejects.toThrow();
    } finally { rmSync(dir, { recursive: true }); }
  });
});
