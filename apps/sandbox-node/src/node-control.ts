import { ExecutionNodeError } from './errors.js';
import type { OperatorGuard, OperatorOperation } from './operator.js';
import type { CustodyGuard } from './custody.js';

export class NodeControl {
  draining = false;
  constructor(private readonly instance: string, private readonly epoch: number,
    private readonly custody: Pick<CustodyGuard, 'heartbeat'>,
    private readonly operator: Pick<OperatorGuard, 'authorize'>, private readonly now = Date.now) {}

  heartbeat(role: string, input: unknown) {
    const body = input as Record<string, unknown> | null;
    const sentAt = typeof body?.sentAt === 'string' ? Date.parse(body.sentAt) : NaN;
    const now = this.now();
    if (role !== 'control-plane' || body?.expectedNodeInstanceId !== this.instance || body?.expectedNodeEpoch !== this.epoch
      || !Number.isFinite(sentAt) || sentAt > now || now - sentAt > 5000) throw new ExecutionNodeError('custody_revoked');
    this.custody.heartbeat();
    return { nodeInstanceId: this.instance, nodeEpoch: this.epoch, heartbeatReceivedAt: new Date(now).toISOString() };
  }

  operate(role: string, op: OperatorOperation, ticket: string | undefined) {
    if (role !== 'operator') throw new ExecutionNodeError('custody_revoked');
    this.operator.authorize(ticket, op);
    if (op !== 'status') this.draining = op === 'drain';
    return { draining: this.draining, drainScope: 'node' };
  }
}
