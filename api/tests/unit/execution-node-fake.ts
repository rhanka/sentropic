import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createExecutionNode } from '../../../apps/sandbox-node/src/index';
import { AgentApi } from '../../../apps/sandbox-node/src/api';
import { CustodyGuard } from '../../../apps/sandbox-node/src/custody';
import { NodeControl } from '../../../apps/sandbox-node/src/node-control';
import { createAgentServer, readJsonBody } from '../../../apps/sandbox-node/src/transport';
import { ExecutionNodeAdapter, nodeHash, type NodeSession } from '../../src/services/artifacts/live/execution-node-adapter';
import { executionNodeTransport, type ExecutionNodeConfig } from '../../src/services/artifacts/live/execution-node-transport';
import { nodeCertificates } from './execution-node-certificates';

export const scope = { kind: 'ui' as const, writable: ['ui/**'], refused: ['ui/dist/**'],
  source: { repo: 'test', path: 'registry.ts', commit: 'abc' } };
export const session = (tenantId: 'sentropic' | 'immo' = 'sentropic'): NodeSession => ({ physicalUid: 'test', devScope: scope,
  ownership: { tenantId, poolOwned: false, workspaceId: 'workspace', principalId: 'principal', sessionId: 'session',
    buildId: 'build', jobId: 'job', attemptId: 'attempt', purpose: 'build', generation: 1, custodyEpoch: 1 } });
export const sandboxSpec = (s: NodeSession) => ({ tenantId: s.ownership.tenantId, devScope: s.devScope, physicalUid: s.physicalUid,
  profile: 'artifact-build', runtimeClass: 'runsc', command: ['/bin/true'], baseMounts: [], quotaMiB: 512, quotaInodes: 1000,
  uid: 1000, gid: 1000, network: 'none' as const, allowExec: false, allowPty: false, allowSnapshots: false });

export async function fakeExecutionNode() {
  const directory = mkdtempSync(join(tmpdir(), 'api-node-contract-'));
  const keys = generateKeyPairSync('ed25519'); const provenance = generateKeyPairSync('ed25519');
  let clock = Date.now(); const now = () => clock;
  const node = createExecutionNode({ ticketPublicKeyPem: keys.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    nodeInstanceId: 'instance', nodeEpoch: 2, now });
  const custody = new CustodyGuard(join(directory, 'wal'), now); const api = new AgentApi(node, custody);
  const control = new NodeControl('instance', 2, custody, { authorize() {} }, now);
  const tls = nodeCertificates(); const calls: Array<{ path: string; tenant?: string; body?: unknown }> = [];
  const server = createAgentServer({ ca: tls.ca, ...tls.server }, async (req, res, role) => {
    const path = req.url!; const tenant = req.headers['x-tenant-id'] as 'sentropic' | 'immo' | undefined;
    const reply = (status: number, value: unknown) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(value));
    try {
      if (path === '/v1/node') { calls.push({ path, tenant }); reply(200, { contractVersion: 'execution-node.v1',
        nodeId: node.daemon.nodeId, nodeInstanceId: 'instance', nodeEpoch: 2,
        provenancePublicKey: provenance.publicKey.export({ type: 'spki', format: 'pem' }).toString() }); return; }
      const body = await readJsonBody(req); calls.push({ path, tenant, body });
      if (path === '/v1/node/heartbeat') { if (tenant) throw new Error(); reply(200, control.heartbeat(role, body)); return; }
      const encoded = req.headers['x-execution-ticket'] as string;
      const result = await api.dispatch({ path, method: req.method!, role, tenantId: tenant!, body,
        ticket: encoded ? JSON.parse(Buffer.from(encoded, 'base64url').toString()) : undefined });
      if (Buffer.isBuffer(result.body)) {
        const header = Buffer.from(JSON.stringify({ alg: 'EdDSA' })).toString('base64url');
        const claims = Buffer.from(JSON.stringify({ nodeInstanceId: 'instance', nodeEpoch: 2, tenantId: tenant,
          archiveSha256: nodeHash(result.body), exportedAt: new Date(now()).toISOString() })).toString('base64url');
        const input = `${header}.${claims}`;
        res.writeHead(result.status, { 'x-artifact-provenance': `${input}.${sign(null, Buffer.from(input), provenance.privateKey).toString('base64url')}` }).end(result.body);
      } else reply(result.status, result.body);
    } catch (error) { const e = error as { status?: number; code?: string }; reply(e.status ?? 500, { error: e.code ?? 'internal_error' }); }
  });
  await new Promise<void>(resolve => server.listen(0, resolve));
  const address = server.address() as { port: number };
  const config: ExecutionNodeConfig = { url: new URL(`https://localhost:${address.port}`), nodeId: node.daemon.nodeId,
    nodeInstanceId: 'instance', nodeEpoch: 2, provenanceKey: provenance.publicKey, ticketKey: keys.privateKey,
    tls: { ca: Buffer.from(tls.ca), cert: Buffer.from(tls.client.cert), key: Buffer.from(tls.client.key) } };
  const transport = executionNodeTransport(config); const adapter = new ExecutionNodeAdapter(config, transport, now);
  return { adapter, config, node, custody, calls, advance(ms: number) { clock += ms; },
    async close() { transport.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); rmSync(directory, { recursive: true }); } };
}
