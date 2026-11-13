import { mkdtempSync, rmSync, appendFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { CustodyGuard } from '../src/custody.js';

describe('custody revocation for sandboxes and isolates', () => {
  it('should close attached streams at their deadline without a revocation', () => {
    vi.useFakeTimers();
    const dir = mkdtempSync(join(tmpdir(), 'expiry-'));
    try {
      const guard = new CustodyGuard(join(dir, 'wal'));
      const close = vi.fn();
      guard.attach({ tenantId: 'immo', resourceId: 'x', custodyEpoch: 1,
        issuedAt: new Date().toISOString(), deadlineAt: new Date(Date.now() + 60_000).toISOString() }, close);
      vi.advanceTimersByTime(59_999);
      expect(close).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(close).toHaveBeenCalledExactlyOnceWith(1008, true);
    } finally { vi.useRealTimers(); rmSync(dir, { recursive: true }); }
  });

  it('should recover a torn tail, truncate it and preserve subsequent revocations', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'torn-'));
    try {
      const wal = join(dir, 'wal');
      await new CustodyGuard(wal).revoke('immo', 'x', 3);
      appendFileSync(wal, '{"key":"immo:x","epoch":');
      const recovered = new CustodyGuard(wal);
      expect((await recovered.revoke('immo', 'x', 2)).activeCustodyEpoch).toBe(3);
      expect(readFileSync(wal, 'utf8').trim().split('\n').map(line => JSON.parse(line).epoch)).toEqual([3, 3]);
      expect((await new CustodyGuard(wal).revoke('immo', 'x', 1)).activeCustodyEpoch).toBe(3);
    } finally { rmSync(dir, { recursive: true }); }
  });
  it('should persist epoch 2 before ack and reject epoch 1 after late notification and restart', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'custody-'));
    try {
      let now = 100_000;
      const wal = join(dir, 'epochs.wal');
      const guard = new CustodyGuard(wal, () => now);
      guard.heartbeat();
      for (const resourceId of ['sandbox-1', 'isolate-1']) {
        const token = { tenantId: 'immo' as const, resourceId, custodyEpoch: 1,
          issuedAt: new Date(now).toISOString(), deadlineAt: new Date(now + 60_000).toISOString() };
        const closed: unknown[] = [];
        guard.attach(token, (...args) => { closed.push(args); });
        const revocation = guard.revoke('immo', resourceId, 2);
        expect(closed).toEqual([[1008, true]]);
        expect(await revocation).toMatchObject({ activeCustodyEpoch: 2, closedStreams: 1 });
        expect((await guard.revoke('immo', resourceId, 1)).activeCustodyEpoch).toBe(2);
        expect(() => guard.attach(token, () => {})).toThrowError(/custody_revoked/);
        const restarted = new CustodyGuard(wal, () => now);
        expect(() => restarted.authorize(token, 'immo', resourceId)).toThrowError(/custody_revoked/);
        guard.authorize({ ...token, custodyEpoch: 2 }, 'immo', resourceId);
      }
      now += 5001;
      expect(() => guard.authorize({ tenantId: 'immo', resourceId: 'new', custodyEpoch: 1,
        issuedAt: new Date(now).toISOString(), deadlineAt: new Date(now + 1000).toISOString() }, 'immo', 'new'))
        .toThrowError(/control_plane_unavailable/);
    } finally { rmSync(dir, { recursive: true }); }
  });
});
