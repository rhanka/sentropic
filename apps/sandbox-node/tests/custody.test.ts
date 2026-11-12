import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CustodyGuard } from '../src/custody.js';

describe('custody revocation for sandboxes and isolates', () => {
  it('should persist epoch 2 before ack and reject epoch 1 after late notification and restart', () => {
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
        expect(guard.revoke('immo', resourceId, 2)).toMatchObject({ activeCustodyEpoch: 2, closedStreams: 1 });
        expect(closed).toEqual([[1008, true]]);
        expect(guard.revoke('immo', resourceId, 1).activeCustodyEpoch).toBe(2);
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
