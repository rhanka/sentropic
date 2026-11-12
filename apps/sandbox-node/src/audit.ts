import type { ExecutionNodeTenantId } from './contract.js';

export interface AuditEvent {
  readonly seq: number;
  readonly at: string;
  readonly tenant_id: string;
  readonly node_instance_id: string;
  readonly type: string;
  readonly sandboxId?: string;
  readonly detail?: string;
}

/** Append-only audit log; every row carries tenant_id + node_instance_id. */
export class AuditLog {
  private readonly nodeInstanceId: string;
  private readonly now: () => number;
  private events: AuditEvent[] = [];

  constructor(nodeInstanceId: string, now: () => number = Date.now) {
    this.nodeInstanceId = nodeInstanceId;
    this.now = now;
  }

  record(type: string, tenantId: ExecutionNodeTenantId | string, sandboxId?: string, detail?: string): AuditEvent {
    const event: AuditEvent = {
      seq: this.events.length,
      at: new Date(this.now()).toISOString(),
      tenant_id: tenantId,
      node_instance_id: this.nodeInstanceId,
      type,
      ...(sandboxId === undefined ? {} : { sandboxId }),
      ...(detail === undefined ? {} : { detail }),
    };
    this.events.push(event);
    return event;
  }

  list(filter?: { tenantId?: string }): AuditEvent[] {
    if (!filter?.tenantId) return [...this.events];
    return this.events.filter(event => event.tenant_id === filter.tenantId);
  }

  get size(): number {
    return this.events.length;
  }
}
