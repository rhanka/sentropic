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
    if (!request.body || typeof request.body !== 'object' || Array.isArray(request.body)) throw new ExecutionNodeError('command_id_payload_mismatch');
    const body = request.body as Record<string, unknown>;
    const commandId = body.commandId;
    if (typeof commandId !== 'string' || !commandId) throw new ExecutionNodeError('command_id_payload_mismatch', 'commandId required');
    if (path === '/v1/bases/ensure' && method === 'POST') {
      daemon.authorizeCommand(ticket, tenantId, commandId, body, method, path, body.ownership as ExecutionNodeOwnership);
      const base = body.base as TenantBase;
      if (base?.tenantId !== tenantId) throw new ExecutionNodeError('cross_tenant_base_forbidden');
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
    const sandbox = daemon.getSandbox(tenantId, id);
    if (!sandbox) throw new ExecutionNodeError('unknown_node_instance');
    const devScope = body.devScope as ExecutionNodeDevScope | undefined;
    validateDevScope(devScope);
    if (JSON.stringify(devScope) !== JSON.stringify(sandbox.devScope)) throw new ExecutionNodeError('command_id_payload_mismatch', 'session devScope mismatch');
    daemon.authorizeCommand(ticket, tenantId, commandId, body, method, path,
      operation === 'claim' ? (body.claim as { ownership: ExecutionNodeOwnership }).ownership : sandbox.ownership);
    if (method === 'DELETE' && !operation) return { status: 200, body: await daemon.deleteSandbox(tenantId, id, { ...body, commandId, ticket }) };
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
    if (operation === 'renew') return { status: 200, body: daemon.renewSandbox(tenantId, id) };
    if (operation === 'write') {
      if (typeof body.path !== 'string' || typeof body.contentBase64 !== 'string') throw new ExecutionNodeError('command_id_payload_mismatch');
      await daemon.writeFile(tenantId, id, { ...body, path: body.path, commandId, devScope, contentBase64: body.contentBase64, ticket });
      return { status: 200, body: { written: true } };
    }
    if (operation === 'revoke-custody') return { status: 200, body: this.custody.revoke(tenantId, id, Number(body.custodyEpoch)) };
    throw new ExecutionNodeError('command_id_payload_mismatch', 'unknown lifecycle operation');
  }
}
