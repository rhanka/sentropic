import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createExecutionNode, generateTicketKeyPair, issueTicket, sha256Hex } from '../src/index.js';
import { CustodyGuard } from '../src/custody.js';
import { AgentApi } from '../src/api.js';

const devScope = { kind: 'ui' as const, writable: ['ui/**'], refused: ['ui/dist/**'], source: { repo: 'test', path: 'registry.ts', commit: 'abc' } };
describe('agent lifecycle transport', () => {
  it('should accept signed lifecycle calls and reject missing or substituted session scopes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'signed-api-'));
    try {
      const keys = generateTicketKeyPair();
      const node = createExecutionNode({ ticketPublicKeyPem: keys.publicKeyPem, nodeInstanceId: 'instance' });
      const custody = new CustodyGuard(join(dir, 'wal')); custody.heartbeat();
      const api = new AgentApi(node, custody);
      const ownership = { tenantId: 'immo' as const, poolOwned: false as const, workspaceId: 'ws', principalId: 'u', attemptId: 'a', purpose: 'build', generation: 1, custodyEpoch: 1 };
      const tickets = new Map<string, ReturnType<typeof issueTicket>>();
      const call = (path: string, body: Record<string, unknown>, method = 'POST') => {
        const issuedAt = Date.now();
        const requestKey = JSON.stringify({ method, path, body });
        const ticket = tickets.get(requestKey) ?? issueTicket({ v: 1, tenantId: 'immo', commandId: String(body.commandId), method, path,
          bodySha256: sha256Hex(JSON.stringify(body)), targetNodeId: node.daemon.nodeId,
          expectedNodeInstanceId: 'instance', expectedNodeEpoch: 1, ownership,
          issuedAt: new Date(issuedAt).toISOString(), deadlineAt: new Date(issuedAt + 30_000).toISOString() }, keys.privateKeyPem);
        tickets.set(requestKey, ticket);
        return api.dispatch({ path, body, method, tenantId: 'immo', role: 'control-plane', ticket });
      };
      const created = await call('/v1/sandboxes', { commandId: 'c', ownership, spec: { tenantId: 'immo', devScope,
        command: ['/bin/sleep', 'infinity'], profile: 'artifact-build', baseMounts: [], uid: 1000, gid: 1000, quotaMiB: 512, quotaInodes: 1000 } });
      const path = `/v1/sandboxes/${(created.body as { id: string }).id}`;
      await expect(call(`${path}/start`, { commandId: 'missing' })).rejects.toThrow(/devScope/);
      await expect(call(`${path}/start`, { commandId: 'changed', devScope: { ...devScope, writable: ['**'] } })).rejects.toThrow(/devScope/);
      await call(`${path}/start`, { commandId: 'run', devScope, uid: 1000, gid: 1000 });
      const writes = vi.spyOn(node.adapter, 'writeFile');
      const first = { commandId: 'write', devScope, path: '/workspace/ui/a.ts', contentBase64: Buffer.from('A').toString('base64') };
      await call(`${path}/write`, first);
      await call(`${path}/write`, { ...first, commandId: 'write-b', contentBase64: Buffer.from('B').toString('base64') });
      await call(`${path}/write`, first);
      expect(writes.mock.calls.map(args => args[2].toString())).toEqual(['A', 'B']);
      for (const changed of [{ ...first, contentBase64: 'Qw==' }, { ...first, path: '/workspace/ui/b.ts' }]) {
        await expect(call(`${path}/write`, changed)).rejects.toMatchObject({ code: 'command_id_payload_mismatch', status: 409 });
      }
      await expect(call(`${path}/stop`, { commandId: first.commandId, devScope, stop: { retainOutput: true } })).rejects.toMatchObject({ status: 409 });
      expect(writes).toHaveBeenCalledTimes(2);
      await call(`${path}/stop`, { commandId: 'stop', devScope, stop: { retainOutput: true } });
      expect((await call(`${path}/export`, { commandId: 'export', devScope, spec: { subPath: 'ui/dist', buildId: 'b', maxBytes: 10000 } })).status).toBe(200);
      const revoked = await call(`${path}/revoke-custody`, { commandId: 'revoke', devScope, minCustodyEpoch: 2, reason: 'owner transfer' });
      expect(revoked.body).toMatchObject({ activeCustodyEpoch: 2 });
      await expect(call(`${path}/renew`, { commandId: 'stale-renew', devScope })).rejects.toThrow();
      ownership.custodyEpoch = 2;
      await call(`${path}/renew`, { commandId: 'fresh-renew', devScope });
      await call(path, { commandId: 'delete', devScope }, 'DELETE');
    } finally { rmSync(dir, { recursive: true }); }
  });
  it('should create, start, stop, export and delete through the dispatched routes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'api-'));
    try {
      const node = createExecutionNode();
      const custody = new CustodyGuard(join(dir, 'wal')); custody.heartbeat();
      const api = new AgentApi(node, custody);
      const call = (path: string, body: unknown, method = 'POST') => api.dispatch({ path, method, tenantId: 'immo', role: 'control-plane', body });
      const owner = { tenantId: 'immo', poolOwned: false, workspaceId: 'ws', principalId: 'u', attemptId: 'a', purpose: 'build', generation: 1, custodyEpoch: 1 };
      const created = await call('/v1/sandboxes', { commandId: 'create', ownership: owner, spec: { tenantId: 'immo', devScope,
        command: ['/bin/sleep', 'infinity'], profile: 'artifact-build', baseMounts: [], uid: 1000, gid: 1000, quotaMiB: 512, quotaInodes: 1000 } });
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
