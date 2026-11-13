import type { createExecutionNode } from './index.js';
import type { ExecutionNodeDevScope, ExecutionNodeOwnership, ExecutionNodeTenantId } from './contract.js';
import type { TicketEnvelope } from './daemon.js';
import { CustodyGuard } from './custody.js';
import { ExecutionNodeError } from './errors.js';
import { validateDevScope } from './mounts.js';
import { ensureBase } from './base-store.js';
import type { TenantBase } from './mounts.js';

type Node = ReturnType<typeof createExecutionNode>;
export interface AgentRequest {
  path: string; method: string; role: string; tenantId: ExecutionNodeTenantId;
  body: unknown; ticket?: TicketEnvelope;
}
export class AgentApi {
  constructor(private readonly node: Node, private readonly custody: CustodyGuard) {}

  async dispatch(request: AgentRequest): Promise<{ status: number; body: unknown }> {
    const { daemon } = this.node;
    const { path, method, tenantId, role, ticket } = request;
    if (role !== 'control-plane') throw new ExecutionNodeError('custody_revoked');
    if (method === 'GET') {
      const match = /^\/v1\/sandboxes\/([a-zA-Z0-9-]+)$/.exec(path);
      if (!match) throw new ExecutionNodeError('command_id_payload_mismatch');
      const sandbox = daemon.peekSandbox(tenantId, match[1]!);
      if (!sandbox) return { status: 404, body: { error: 'sandbox_not_found' } };
      return { status: 200, body: { tenantId, id: sandbox.id, physicalUid: sandbox.id,
        state: sandbox.state, ownership: sandbox.ownership, allProcessesExited: sandbox.allProcessesExited,
        nodeInstanceId: daemon.nodeInstanceId, nodeEpoch: daemon.nodeEpoch } };
    }
    this.custody.requireHeartbeat();
    if (!request.body || typeof request.body !== 'object' || Array.isArray(request.body)) throw new ExecutionNodeError('command_id_payload_mismatch');
    const body = request.body as Record<string, unknown>;
    const commandId = body.commandId;
    if (typeof commandId !== 'string' || !commandId) throw new ExecutionNodeError('command_id_payload_mismatch', 'commandId required');
    if (path === `/v1/tenants/${tenantId}/bases` && method === 'PUT') {
      daemon.authorizeCommand(ticket, tenantId, commandId, body, method, path, body.ownership as ExecutionNodeOwnership);
      const base = body.base as TenantBase;
      if (base?.tenantId !== tenantId) throw new ExecutionNodeError('cross_tenant_base_forbidden');
      if (base.kind === 'rootfs') throw new ExecutionNodeError('cross_tenant_base_forbidden', 'rootfs is delivered with the agent');
      await ensureBase(base, String(body.url)); this.node.bases.register(base);
      return { status: 200, body: base };
    }
    if (path === '/v1/sandboxes' && method === 'POST') {
      const input = body as unknown as Parameters<typeof daemon.createSandbox>[0];
      if (input.spec?.tenantId !== tenantId) throw new ExecutionNodeError('cross_tenant_base_forbidden');
      return { status: 201, body: await daemon.createSandbox({ ...input, ticket }) };
    }
    const match = /^\/v1\/sandboxes\/([a-zA-Z0-9-]+)(?:\/(start|claim|stop|export|renew|revoke-custody|write))?$/.exec(path);
    if (!match) throw new ExecutionNodeError('command_id_payload_mismatch', 'unknown lifecycle route');
    const id = match[1]!, operation = match[2];
    if (operation === 'start' || operation === 'claim') this.node.admission.requireAccepting();
    const sandbox = daemon.getSandbox(tenantId, id);
    if (!sandbox) throw new ExecutionNodeError('unknown_node_instance');
    const devScope = body.devScope as ExecutionNodeDevScope | undefined;
    validateDevScope(devScope);
    if (JSON.stringify(devScope) !== JSON.stringify(sandbox.devScope)) throw new ExecutionNodeError('command_id_payload_mismatch', 'session devScope mismatch');
    daemon.authorizeCommand(ticket, tenantId, commandId, body, method, path,
      operation === 'claim' ? (body.claim as { ownership: ExecutionNodeOwnership }).ownership : sandbox.ownership);
    if (ticket) this.custody.authorize({ tenantId, resourceId: id, custodyEpoch: ticket.ticket.ownership.custodyEpoch,
      issuedAt: ticket.ticket.issuedAt, deadlineAt: ticket.ticket.deadlineAt }, tenantId, id);
    if (method === 'DELETE' && !operation) return { status: 200, body: await daemon.deleteSandbox(tenantId, id, { ...body, commandId, devScope, ticket }) };
    if (method !== 'POST') throw new ExecutionNodeError('command_id_payload_mismatch');
    if (operation === 'start') return { status: 200, body: await daemon.promoteToRunning(tenantId, id, { ...body, commandId, ticket } as Parameters<typeof daemon.promoteToRunning>[2]) };
    if (operation === 'claim') return { status: 200, body: await daemon.claimSandbox({ ...body, commandId, ticket, standbyId: id } as Parameters<typeof daemon.claimSandbox>[0]) };
    if (operation === 'stop') {
      const record = await daemon.stopSandbox(tenantId, id, { ...body, commandId, ticket } as Parameters<typeof daemon.stopSandbox>[2]);
      return { status: record.allProcessesExited ? 200 : 202, body: record };
    }
    if (operation === 'export') {
      const result = await daemon.exportArtifacts(tenantId, id, { ...body, commandId, ticket } as Parameters<typeof daemon.exportArtifacts>[2]);
      return { status: 200, body: result.bytes };
    }
    if (operation === 'renew') return { status: 200, body: daemon.renewSandbox(tenantId, id, { ...body, commandId, devScope, ticket }) };
    if (operation === 'write') {
      if (typeof body.path !== 'string' || typeof body.contentBase64 !== 'string') throw new ExecutionNodeError('command_id_payload_mismatch');
      await daemon.writeFile(tenantId, id, { ...body, path: body.path, commandId, devScope, contentBase64: body.contentBase64, ticket });
      return { status: 200, body: { written: true } };
    }
    if (operation === 'revoke-custody') {
      const result = this.custody.revoke(tenantId, id, Number(body.minCustodyEpoch));
      sandbox.ownership = { ...sandbox.ownership, custodyEpoch: result.activeCustodyEpoch };
      return { status: 200, body: result };
    }
    throw new ExecutionNodeError('command_id_payload_mismatch', 'unknown lifecycle operation');
  }
}
