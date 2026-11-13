import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createExecutionNode, generateTicketKeyPair, issueTicket, sha256Hex } from '../src/index.js';
import { CustodyGuard } from '../src/custody.js';
import { AgentApi } from '../src/api.js';

const devScope = { kind: 'ui' as const, writable: ['ui/**'], refused: ['ui/dist/**'], source: { repo: 'test', path: 'registry.ts', commit: 'abc' } };
describe('agent lifecycle transport', () => {
  it('should recover a failed durable revocation with fresh signed epoch tickets and retain stop/delete access', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wal-retry-'));
    try {
      const keys = generateTicketKeyPair(), node = createExecutionNode({ ticketPublicKeyPem: keys.publicKeyPem });
      const wal = join(dir, 'storage', 'wal');
      const custody = new CustodyGuard(wal); custody.heartbeat();
      const api = new AgentApi(node, custody);
      const ownership = { tenantId: 'immo' as const, poolOwned: false as const, workspaceId: 'ws', principalId: 'u',
        attemptId: 'a', purpose: 'test', generation: 1, custodyEpoch: 1 };
      const call = (path: string, body: Record<string, unknown>, method = 'POST') => {
        const now = Date.now();
        const ticket = issueTicket({ v: 1, tenantId: 'immo', commandId: String(body.commandId), method, path,
          bodySha256: sha256Hex(JSON.stringify(body)), targetNodeId: node.daemon.nodeId,
          expectedNodeInstanceId: node.daemon.nodeInstanceId, expectedNodeEpoch: node.daemon.nodeEpoch, ownership,
          issuedAt: new Date(now).toISOString(), deadlineAt: new Date(now + 30_000).toISOString() }, keys.privateKeyPem);
        return api.dispatch({ path, body, method, tenantId: 'immo', role: 'control-plane', ticket });
      };
      const created = await call('/v1/sandboxes', { commandId: 'create', ownership, spec: { tenantId: 'immo', devScope,
        command: ['/bin/sleep', '60'], profile: 'artifact-build', baseMounts: [], uid: 1000, gid: 1000, quotaMiB: 512, quotaInodes: 1000 } });
      const id = (created.body as { id: string }).id, path = `/v1/sandboxes/${id}`;
      await call(`${path}/start`, { commandId: 'run', devScope, uid: 1000, gid: 1000 });
      const cut = vi.fn(), now = Date.now();
      custody.attach({ tenantId: 'immo', resourceId: id, custodyEpoch: 1,
        issuedAt: new Date(now).toISOString(), deadlineAt: new Date(now + 30000).toISOString() }, cut);
      await expect(call(`${path}/revoke-custody`, { commandId: 'revoke', devScope, minCustodyEpoch: 2 })).rejects.toThrow();
      expect(cut).toHaveBeenCalledOnce();
      expect(node.daemon.getSandbox('immo', id)!.ownership.custodyEpoch).toBe(2);
      await expect(call(`${path}/stop`, { commandId: 'stale-stop', devScope, stop: {} })).rejects.toThrow();
      mkdirSync(join(dir, 'storage')); ownership.custodyEpoch = 2;
      expect((await call(`${path}/revoke-custody`, { commandId: 'retry', devScope, minCustodyEpoch: 2 })).status).toBe(200);
      expect(new CustodyGuard(wal)).toBeDefined();
      expect((await call(`${path}/stop`, { commandId: 'stop', devScope, stop: {} })).status).toBe(200);
      expect((await call(path, { commandId: 'delete', devScope }, 'DELETE')).status).toBe(200);
    } finally { rmSync(dir, { recursive: true }); }
  });
  it.each(['start', 'claim'])('should reject a signed %s command reused for another sandbox', async operation => {
    const dir = mkdtempSync(join(tmpdir(), 'route-replay-'));
    try {
      const keys = generateTicketKeyPair();
      const node = createExecutionNode({ ticketPublicKeyPem: keys.publicKeyPem });
      const custody = new CustodyGuard(join(dir, 'wal')); custody.heartbeat();
      const api = new AgentApi(node, custody);
      const ownership = { tenantId: 'immo' as const, poolOwned: false as const, workspaceId: 'ws', principalId: 'u',
        attemptId: 'a', purpose: 'test', generation: 1, custodyEpoch: 1 };
      const compatibility = { tenantId: 'immo', repoId: 'repo', sourceTreeSha256: 'src', lockSha256: 'lock',
        prebundleDigest: 'pre', rootfsBaseDigest: 'root', profile: 'node-22', viteConfigDigest: 'vite' };
      const call = (path: string, body: Record<string, unknown>, method = 'POST') => {
        const now = Date.now();
        const ticket = issueTicket({ v: 1, tenantId: 'immo', commandId: String(body.commandId), method, path,
          bodySha256: sha256Hex(JSON.stringify(body)), targetNodeId: node.daemon.nodeId,
          expectedNodeInstanceId: node.daemon.nodeInstanceId, expectedNodeEpoch: node.daemon.nodeEpoch, ownership,
          issuedAt: new Date(now).toISOString(), deadlineAt: new Date(now + 30_000).toISOString() }, keys.privateKeyPem);
        return api.dispatch({ path, body, method, tenantId: 'immo', role: 'control-plane', ticket });
      };
      const create = async (commandId: string, profile = 'node-22') => {
        const result = await call('/v1/sandboxes', { commandId, ownership, compatibility,
          warmStandby: operation === 'claim', spec: { tenantId: 'immo', devScope, profile,
            baseMounts: [], uid: 1000, gid: 1000, quotaMiB: 512, quotaInodes: 1000 } });
        return (result.body as { id: string }).id;
      };
      const first = await create('create-a');
      const body = { commandId: 'shared', devScope, uid: 1000, gid: 1000,
        ...(operation === 'claim' ? { claim: { tenantId: 'immo', ownership, compatibility } } : {}) };
      const path = `/v1/sandboxes/${first}`;
      expect((await call(`${path}/${operation}`, body)).body).toMatchObject({ id: first, state: 'running' });
      const launches = vi.spyOn(node.adapter, 'runSandbox');
      expect((await call(`${path}/${operation}`, body)).body).toMatchObject({ id: first });
      // A claimed session must release its sole warm slot before creating the next standby.
      if (operation === 'claim') await call(`${path}/stop`, { commandId: 'stop-a', devScope, stop: {} });
      const second = await create('create-b', operation === 'start' ? 'artifact-build' : 'node-22');
      await expect(call(`/v1/sandboxes/${second}/${operation}`, body))
        .rejects.toMatchObject({ code: 'command_id_payload_mismatch', status: 409 });
      expect(node.daemon.getSandbox('immo', second)).toMatchObject({
        state: operation === 'start' ? 'creating' : 'standby', runtimeId: undefined });
      expect(launches).not.toHaveBeenCalled();
      await call(`/v1/sandboxes/${second}/${operation}`, { ...body, commandId: 'fresh' });
      expect(launches).toHaveBeenCalledTimes(1);
    } finally { rmSync(dir, { recursive: true }); }
  });
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
      // A completed write retry remains successful after the lifecycle advances.
      await call(`${path}/write`, first);
      expect(writes).toHaveBeenCalledTimes(2);
      await expect(call(`${path}/write`, { ...first, commandId: 'new-after-stop' })).rejects.toMatchObject({ code: 'already_claimed' });
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
