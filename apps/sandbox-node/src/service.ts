import { readFileSync } from 'node:fs';
import { createAgentServer, requestScope, agentRole } from './transport.js';
import { EXECUTION_NODE_CONTRACT_VERSION } from './contract.js';
import { CustodyGuard } from './custody.js';
import { ExecutionNodeError } from './errors.js';
import { createExecutionNode } from './index.js';
import { AgentApi } from './api.js';
import type { TicketEnvelope } from './daemon.js';
import { readJsonBody } from './transport.js';
import { totalmem } from 'node:os';
import { nextNodeEpoch, hostBudget } from './node-state.js';
import { OperatorGuard } from './operator.js';
import { NodeControl } from './node-control.js';
import { nodeMetrics } from './metrics.js';
import { createPrivateKey, createPublicKey, sign, createHash } from 'node:crypto';
import { assertCleanStartup } from './restart.js';
import { createDataPlane } from './data-plane.js';
import { custodyVerificationKey } from './custody-key.js';
import { portsEnabled, useK8sPortsSwitch } from './network-policy.js';
import { monitorPorts } from './ports-monitor.js';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} required`);
  return value;
}

const tls = { ca: readFileSync(required('AGENT_CA')), cert: readFileSync(required('AGENT_CERT')),
  key: readFileSync(required('AGENT_KEY')) };
const nodeInstanceId = readFileSync('/var/lib/builder/node-instance-id', 'utf8').trim();
if (!nodeInstanceId) throw new Error('node-instance-id required');
assertCleanStartup();
const nodeEpoch = nextNodeEpoch();
const custody = new CustodyGuard('/var/lib/builder/custody.wal');
const { hostMemory, reservableMiB } = hostBudget(totalmem());
const node = createExecutionNode({ useRunsc: true, nodeInstanceId, nodeEpoch,
  sharedRootfs: { path: `${required('RELEASE_DIR')}/rootfs.erofs`, digest: required('ROOTFS_DIGEST') },
  reservableMiB,
  ticketPublicKeyPem: readFileSync(required('AGENT_TICKET_PUBLIC_KEY'), 'utf8') });
const api = new AgentApi(node, custody);
useK8sPortsSwitch();
const operator = new OperatorGuard(required('AGENT_OPERATOR_PUBLIC_KEYS').split(',').map(path => readFileSync(path, 'utf8')), nodeInstanceId, nodeEpoch);
const control = new NodeControl(nodeInstanceId, nodeEpoch, custody, operator);
const provenanceKey = createPrivateKey(readFileSync('/etc/execution-node/keys/node-provenance.ed25519'));
if (provenanceKey.asymmetricKeyType !== 'ed25519') throw new Error('Ed25519 node provenance key required');
const provenancePublicKey = createPublicKey(provenanceKey).export({ type: 'spki', format: 'pem' }).toString();
const dataPlane = createDataPlane({ custody, portsEnabled,
  publicKey: custodyVerificationKey(readFileSync(required('CUSTODY_PUBLIC_KEY')), readFileSync(required('AGENT_TICKET_PUBLIC_KEY'))),
  sandbox: (tenant, uid) => node.daemon.peekSandbox(tenant, uid),
  target: async (sandbox, port) => {
    if (!sandbox.runtimeId || !node.adapter.portTarget) throw new Error('sandbox_port_unavailable');
    return node.adapter.portTarget(sandbox.runtimeId, port);
  } });
monitorPorts(portsEnabled, () => dataPlane.cutPorts(), () => node.daemon.disablePorts(),
  () => { console.error('ports cleanup failed; retrying'); });
export const server = createAgentServer(tls, async (req, res, role) => {
  const reply = (status: number, body: unknown) => { res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body)); };
  try {
    const url = new URL(req.url ?? '/', 'https://agent');
    if (url.pathname.startsWith('/v1/ports/')) { await dataPlane.http(req, res, role); return; }
    if (url.pathname === '/v1/node/heartbeat' && req.method === 'POST') {
      if (req.headers['x-tenant-id'] || url.searchParams.has('tenantId')) throw new ExecutionNodeError('custody_revoked');
      reply(200, control.heartbeat(role, await readJsonBody(req))); return;
    }
    const header = req.headers['x-tenant-id'];
    const scope = requestScope(req.url ?? '/', typeof header === 'string' ? header : undefined, role);
    if (scope.scope === 'node' && ['/v1/node/drain', '/v1/node/undrain', '/v1/node/status'].includes(url.pathname) && req.method === 'POST') {
      const op = url.pathname.split('/').pop() as 'drain' | 'undrain' | 'status';
      const ticket = req.headers['x-operator-ticket'];
      const result = control.operate(role, op, typeof ticket === 'string' ? ticket : undefined);
      node.admission.draining = control.draining;
      reply(200, result); return;
    }
    if (url.pathname === '/v1/node' && req.method === 'GET') {
      reply(200, { contractVersion: EXECUTION_NODE_CONTRACT_VERSION, nodeId: 'artifact-builder-vm-1',
        nodeInstanceId, nodeEpoch, provenancePublicKey, draining: control.draining, classes: ['sandbox'],
        rootfs: { baseId: 'shared-rootfs', kind: 'rootfs', identityDigest: required('ROOTFS_DIGEST') },
        parentSlice: { name: 'builder.slice', memoryMaxMiB: reservableMiB, memoryLowMiB: 1408, memorySwapMaxMiB: 512 },
        intermediateSlice: { name: 'builder-tenant.slice', memoryLowMiB: 1408 }, hostMemory,
        metrics: nodeMetrics(node), tenantSlices: Object.fromEntries((['sentropic', 'immo'] as const).map(id =>
          [id, node.admission.quotaSnapshot(id, `/builder.slice/builder-tenant.slice/builder-tenant-${id}.slice`)])),
        capabilities: { supportedOps: ['node', 'quotas', 'bases', 'create', 'start', 'claim', 'stop', 'export', 'delete', 'renew', 'revoke-custody', 'write', ...(portsEnabled() ? ['ports'] : [])] } }); return;
    }
    if (scope.scope === 'tenant' && url.pathname === `/v1/tenants/${scope.tenantId}/quotas` && req.method === 'GET') {
      reply(200, node.admission.quotaSnapshot(scope.tenantId,
        `/builder.slice/builder-tenant.slice/builder-tenant-${scope.tenantId}.slice`)); return;
    }
    if (scope.scope !== 'tenant') { reply(404, { error: 'unknown_route' }); return; }
    if (req.method === 'GET' && /^\/v1\/sandboxes\/[a-zA-Z0-9-]+$/.test(url.pathname)) {
      const result = await api.dispatch({ path: url.pathname, method: 'GET', tenantId: scope.tenantId, role, body: {} });
      reply(result.status, result.body); return;
    }
    const encoded = req.headers['x-execution-ticket'];
    if (typeof encoded !== 'string') throw new ExecutionNodeError('custody_revoked', 'execution ticket required');
    const ticket = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as TicketEnvelope;
    const result = await api.dispatch({ path: url.pathname, method: req.method ?? '', tenantId: scope.tenantId,
      role, body: await readJsonBody(req), ticket });
    if (Buffer.isBuffer(result.body)) {
      const protectedHeader = Buffer.from(JSON.stringify({ alg: 'EdDSA', typ: 'JWT' })).toString('base64url');
      const claims = Buffer.from(JSON.stringify({ ...result.provenance, nodeInstanceId, nodeEpoch, tenantId: scope.tenantId,
        archiveSha256: createHash('sha256').update(result.body).digest('hex'), exportedAt: new Date().toISOString() })).toString('base64url');
      const signingInput = `${protectedHeader}.${claims}`;
      const jws = `${signingInput}.${sign(null, Buffer.from(signingInput), provenanceKey).toString('base64url')}`;
      res.writeHead(result.status, { 'content-type': 'application/gzip', 'x-artifact-provenance': jws }).end(result.body);
    }
    else reply(result.status, result.body);
  } catch (error) {
    reply(error instanceof ExecutionNodeError ? error.status : 500,
      { error: error instanceof ExecutionNodeError ? error.code : 'internal_error' });
  }
});
server.on('upgrade', (req, socket, head) => { void dataPlane.upgrade(req, socket, head, agentRole(req) ?? ''); });
server.requestTimeout = 5000;
server.maxHeadersCount = 64;
server.listen(Number(process.env.AGENT_PORT ?? 8443), '0.0.0.0');
process.on('SIGTERM', () => { server.close(); });
