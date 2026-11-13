import { readFileSync } from 'node:fs';
import { createAgentServer, requestScope, sendJobAlertHeartbeat } from './transport.js';
import { EXECUTION_NODE_CONTRACT_VERSION, EXECUTION_NODE_TENANT_SLICE_DEFAULTS } from './contract.js';
import { CustodyGuard } from './custody.js';
import { ExecutionNodeError } from './errors.js';
import { createExecutionNode } from './index.js';
import { AgentApi } from './api.js';
import type { TicketEnvelope } from './daemon.js';
import { readJsonBody } from './transport.js';
import { totalmem } from 'node:os';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} required`);
  return value;
}

const tls = { ca: readFileSync(required('AGENT_CA')), cert: readFileSync(required('AGENT_CERT')),
  key: readFileSync(required('AGENT_KEY')) };
const nodeInstanceId = required('NODE_INSTANCE_ID');
const nodeEpoch = Number(required('NODE_EPOCH'));
if (!Number.isSafeInteger(nodeEpoch) || nodeEpoch < 1) throw new Error('invalid NODE_EPOCH');
const jobAlerts = required('JOB_ALERTS_URL');
if (!jobAlerts.startsWith('https://')) throw new Error('JOB_ALERTS_URL must use HTTPS');
const custody = new CustodyGuard('/var/lib/builder/custody.wal');
const hostMemory = { memTotalBytes: totalmem(), memTotalFloorMiB: Math.floor(totalmem() / 1048576),
  hostBaseMiB: 512, agentMemoryMaxMiB: 192, unallocatedMarginMiB: 172, zramNominalMiB: 1024 } as const;
const reservableMiB = Math.min(2944, Math.max(0, hostMemory.memTotalFloorMiB - 876));
const node = createExecutionNode({ useRunsc: true, nodeInstanceId, nodeEpoch,
  reservableMiB,
  ticketPublicKeyPem: readFileSync(required('AGENT_TICKET_PUBLIC_KEY'), 'utf8') });
const api = new AgentApi(node, custody);
const server = createAgentServer(tls, async (req, res, role) => {
  const reply = (status: number, body: unknown) => { res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body)); };
  try {
    const url = new URL(req.url ?? '/', 'https://agent');
    if (url.pathname === '/v1/heartbeat' && req.method === 'POST' && role === 'control-plane') {
      custody.heartbeat(); reply(200, { nodeInstanceId, nodeEpoch }); return;
    }
    const header = req.headers['x-tenant-id'];
    const scope = requestScope(req.url ?? '/', typeof header === 'string' ? header : undefined, role);
    if (url.pathname === '/v1/node' && req.method === 'GET') {
      reply(200, { contractVersion: EXECUTION_NODE_CONTRACT_VERSION, nodeId: 'artifact-builder-vm-1',
        nodeInstanceId, nodeEpoch, classes: ['sandbox'], parentSlice: { name: 'builder.slice', memoryMaxMiB: reservableMiB, memorySwapMaxMiB: 512 }, hostMemory,
        capabilities: { supportedOps: ['node', 'quotas', 'bases', 'create', 'start', 'claim', 'stop', 'export', 'delete', 'renew', 'revoke-custody', 'write'] } }); return;
    }
    if (scope.scope === 'tenant' && url.pathname === `/v1/tenants/${scope.tenantId}/quotas` && req.method === 'GET') {
      reply(200, node.admission.quotaSnapshot(scope.tenantId,
        `/builder.slice/builder-tenant.slice/builder-tenant-${scope.tenantId}.slice`)); return;
    }
    if (scope.scope !== 'tenant') { reply(404, { error: 'unknown_route' }); return; }
    const encoded = req.headers['x-execution-ticket'];
    if (typeof encoded !== 'string') throw new ExecutionNodeError('custody_revoked', 'execution ticket required');
    const ticket = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as TicketEnvelope;
    const result = await api.dispatch({ path: url.pathname, method: req.method ?? '', tenantId: scope.tenantId,
      role, body: await readJsonBody(req), ticket });
    if (Buffer.isBuffer(result.body)) res.writeHead(result.status, { 'content-type': 'application/gzip' }).end(result.body);
    else reply(result.status, result.body);
  } catch (error) {
    reply(error instanceof ExecutionNodeError ? error.status : 500,
      { error: error instanceof ExecutionNodeError ? error.code : 'internal_error' });
  }
});
server.requestTimeout = 5000;
server.maxHeadersCount = 64;
server.listen(Number(process.env.AGENT_PORT ?? 8443), '0.0.0.0');
const heartbeat = () => sendJobAlertHeartbeat(jobAlerts, tls, { source: 'sandbox-node', nodeInstanceId, nodeEpoch,
  timestamp: new Date().toISOString() }).catch(error => { console.error('job-alerts heartbeat failed', String(error)); });
void heartbeat();
const timer = setInterval(() => { void heartbeat(); }, 15_000);
process.on('SIGTERM', () => { clearInterval(timer); server.close(); });
