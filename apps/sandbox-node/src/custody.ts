import { closeSync, existsSync, fsyncSync, ftruncateSync, openSync, readFileSync, writeSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ExecutionNodeTenantId } from './contract.js';
import { ExecutionNodeError } from './errors.js';

export interface CustodyToken {
  tenantId: ExecutionNodeTenantId; resourceId: string; custodyEpoch: number;
  issuedAt: string; deadlineAt: string;
}
type Stream = { epoch: number; timer: ReturnType<typeof setTimeout>; close: (wsCode: 1008, tcpReset: true) => void };

/** Caller authenticates mTLS and verifies the signed token before this epoch gate. */
export class CustodyGuard {
  private readonly epochs = new Map<string, number>();
  private readonly streams = new Map<string, Set<Stream>>();
  private heartbeatAt = Number.NEGATIVE_INFINITY;

  constructor(private readonly walPath: string, private readonly now = Date.now) {
    if (existsSync(walPath)) {
      const bytes = readFileSync(walPath);
      const end = bytes.lastIndexOf(10) + 1;
      for (const line of bytes.subarray(0, end).toString('utf8').split('\n').filter(Boolean)) {
        const { key, epoch } = JSON.parse(line) as { key: string; epoch: number };
        if (typeof key !== 'string' || !Number.isSafeInteger(epoch) || epoch < 0) throw new Error('invalid custody WAL');
        this.epochs.set(key, Math.max(this.epochs.get(key) ?? 0, epoch));
      }
      if (end !== bytes.length) {
        const fd = openSync(walPath, 'r+');
        try { ftruncateSync(fd, end); fsyncSync(fd); } finally { closeSync(fd); }
      }
    }
  }

  heartbeat(): void { this.heartbeatAt = this.now(); }
  requireHeartbeat(): void {
    if (this.now() - this.heartbeatAt > 5000) throw new ExecutionNodeError('control_plane_unavailable');
  }

  authorize(token: CustodyToken, tenantId: ExecutionNodeTenantId, resourceId: string, mutation = true): void {
    const issued = Date.parse(token.issuedAt), deadline = Date.parse(token.deadlineAt);
    if (token.tenantId !== tenantId || token.resourceId !== resourceId
      || !Number.isSafeInteger(token.custodyEpoch) || token.custodyEpoch < 0
      || !Number.isFinite(issued) || !Number.isFinite(deadline) || deadline - issued > 60_000
      || deadline <= this.now() || issued > this.now() || deadline <= issued
      || token.custodyEpoch < (this.epochs.get(`${tenantId}:${resourceId}`) ?? 0)) {
      throw new ExecutionNodeError('custody_revoked');
    }
    if (mutation && this.now() - this.heartbeatAt > 5000) throw new ExecutionNodeError('control_plane_unavailable');
  }

  attach(token: CustodyToken, close: Stream['close']): () => void {
    this.authorize(token, token.tenantId, token.resourceId, false);
    const key = `${token.tenantId}:${token.resourceId}`;
    const streams = this.streams.get(key) ?? new Set<Stream>();
    const timer = setTimeout(() => { streams.delete(stream); close(1008, true); }, Date.parse(token.deadlineAt) - this.now());
    timer.unref();
    const stream = { epoch: token.custodyEpoch, close, timer };
    streams.add(stream); this.streams.set(key, streams);
    return () => { clearTimeout(timer); streams.delete(stream); };
  }

  revoke(tenantId: ExecutionNodeTenantId, resourceId: string, received: number) {
    if (!Number.isSafeInteger(received) || received < 0) throw new ExecutionNodeError('command_id_payload_mismatch');
    const key = `${tenantId}:${resourceId}`;
    const epoch = Math.max(this.epochs.get(key) ?? 0, received);
    const fd = openSync(this.walPath, 'a', 0o600);
    try { writeSync(fd, `${JSON.stringify({ key, epoch })}\n`); fsyncSync(fd); }
    finally { closeSync(fd); }
    const directory = openSync(dirname(this.walPath), 'r');
    try { fsyncSync(directory); } finally { closeSync(directory); }
    this.epochs.set(key, epoch);
    let closedStreams = 0;
    for (const stream of this.streams.get(key) ?? []) {
      if (stream.epoch >= epoch) continue;
      clearTimeout(stream.timer); stream.close(1008, true); this.streams.get(key)!.delete(stream); closedStreams++;
    }
    return { activeCustodyEpoch: epoch, closedStreams, ackedAt: new Date(this.now()).toISOString() };
  }
}
