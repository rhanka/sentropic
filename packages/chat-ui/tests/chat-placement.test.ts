import { describe, expect, it, vi } from 'vitest';
import {
  createPlacementController,
  parsePlacementId,
  placementId,
  placementsEqual,
  type ChatPlacement,
  type CommitFn,
  type HostSurfaces,
} from '../src/state/chatPlacement';

const P = {
  drawerRight: { kind: 'drawer', side: 'right', occupancy: 'primary' } as ChatPlacement,
  drawerLeft: { kind: 'drawer', side: 'left', occupancy: 'primary' } as ChatPlacement,
  stackedBottom: {
    kind: 'drawer',
    side: 'right',
    occupancy: 'stacked',
    stickiness: 'bottom',
  } as ChatPlacement,
  floatingCenter: { kind: 'floating', anchor: 'center' } as ChatPlacement,
  full: { kind: 'full' } as ChatPlacement,
};

const okCommit: CommitFn = async () => ({ ok: true });

const webHost: HostSurfaces = {
  supported: [
    'drawer.right.primary',
    'drawer.left.primary',
    'drawer.right.stacked.bottom',
    'floating.center',
    'full',
  ],
  reparent: 'dom',
  fallbackChain: ['drawer.right.primary', 'floating.center', 'full'],
};

describe('chatPlacement — canonical ids (D2)', () => {
  it('round-trips every taxonomy member through id/parse', () => {
    for (const p of Object.values(P)) {
      expect(parsePlacementId(placementId(p))).toEqual(p);
    }
  });

  it('normalizes ids: stacked always carries stickiness, primary never does', () => {
    expect(placementId(P.drawerRight)).toBe('drawer.right.primary');
    expect(placementId(P.stackedBottom)).toBe('drawer.right.stacked.bottom');
    expect(placementId(P.full)).toBe('full');
  });

  it('rejects malformed ids', () => {
    expect(() => parsePlacementId('drawer.right')).toThrow();
    expect(() => parsePlacementId('drawer.right.stacked')).toThrow();
    expect(() => parsePlacementId('floating')).toThrow();
    expect(() => parsePlacementId('nope')).toThrow();
  });

  it('placementsEqual compares by canonical id', () => {
    expect(placementsEqual(P.drawerRight, { ...P.drawerRight })).toBe(true);
    expect(placementsEqual(P.drawerRight, P.drawerLeft)).toBe(false);
  });
});

describe('chatPlacement — capability negotiation (D3)', () => {
  it('exposes supported and available; available intersects viability', () => {
    const isViable = (id: string) => id !== 'full'; // full temporarily unavailable
    const ctrl = createPlacementController({
      hostSurfaces: webHost,
      commit: okCommit,
      defaultPlacement: P.drawerRight,
      isViable,
    });
    const s = ctrl.snapshot();
    expect(s.supported.map(placementId)).toContain('full');
    expect(s.available.map(placementId)).not.toContain('full');
    expect(s.available.map(placementId)).toContain('drawer.right.primary');
  });
});

describe('chatPlacement — transitions (D13)', () => {
  it('applies a supported+viable target and sets effective only after commit', async () => {
    const commit = vi.fn(okCommit);
    const ctrl = createPlacementController({
      hostSurfaces: webHost,
      commit,
      defaultPlacement: P.drawerRight,
    });
    const r = await ctrl.requestPlacement(P.floatingCenter);
    expect(r.status).toBe('applied');
    expect(commit).toHaveBeenCalledTimes(1);
    expect(placementId(ctrl.snapshot().effective)).toBe('floating.center');
    expect(ctrl.snapshot().pending).toBeUndefined();
  });

  it('rejects an unsupported target without committing', async () => {
    const commit = vi.fn(okCommit);
    const ctrl = createPlacementController({
      hostSurfaces: { ...webHost, supported: ['drawer.right.primary'] },
      commit,
      defaultPlacement: P.drawerRight,
    });
    const r = await ctrl.requestPlacement(P.full);
    expect(r.status).toBe('rejected');
    expect(r.reason).toBe('unsupported');
    expect(commit).not.toHaveBeenCalled();
  });

  it('redirects to the fallback chain when the target is temporarily unavailable', async () => {
    const ctrl = createPlacementController({
      hostSurfaces: webHost,
      commit: okCommit,
      defaultPlacement: P.drawerRight,
      isViable: (id) => id !== 'full', // requested full → not viable → fallback
    });
    const r = await ctrl.requestPlacement(P.full);
    expect(r.status).toBe('redirected');
    // fallbackChain = [drawer.right.primary, floating.center, full]; first viable = drawer.right.primary
    expect(placementId(r.placement)).toBe('drawer.right.primary');
  });

  it('leaves effective unchanged and reports failed when the host commit fails', async () => {
    const commit: CommitFn = async () => ({ ok: false, reason: 'host-failure' });
    const ctrl = createPlacementController({
      hostSurfaces: webHost,
      commit,
      defaultPlacement: P.drawerRight,
    });
    const r = await ctrl.requestPlacement(P.floatingCenter);
    expect(r.status).toBe('failed');
    expect(r.reason).toBe('host-failure');
    expect(placementId(ctrl.snapshot().effective)).toBe('drawer.right.primary');
  });

  it('ignores a superseded commit ack (newer request wins)', async () => {
    // First commit resolves slowly; a second request arrives before it settles.
    let releaseFirst: (v: { ok: true }) => void = () => {};
    const commit: CommitFn = (target) =>
      placementId(target) === 'floating.center'
        ? new Promise((res) => (releaseFirst = res))
        : Promise.resolve({ ok: true });

    const ctrl = createPlacementController({
      hostSurfaces: webHost,
      commit,
      defaultPlacement: P.drawerRight,
    });

    const first = ctrl.requestPlacement(P.floatingCenter); // hangs
    const second = await ctrl.requestPlacement(P.drawerLeft); // supersedes, commits now
    expect(second.status).toBe('applied');
    expect(placementId(ctrl.snapshot().effective)).toBe('drawer.left.primary');

    releaseFirst({ ok: true }); // late ack for the superseded first request
    const firstResult = await first;
    expect(firstResult.status).toBe('superseded');
    // effective must remain the newer placement, not the superseded one
    expect(placementId(ctrl.snapshot().effective)).toBe('drawer.left.primary');
  });
});

describe('chatPlacement — persistence & authority (D6)', () => {
  it('persists user intent immediately on request, even when it redirects', async () => {
    const store = new Map<string, string>();
    const persistence = {
      read: () => store.get('k') ?? null,
      write: (id: string) => void store.set('k', id),
    };
    const ctrl = createPlacementController({
      hostSurfaces: webHost,
      commit: okCommit,
      defaultPlacement: P.drawerRight,
      persistence,
      isViable: (id) => id !== 'full',
    });
    await ctrl.requestPlacement(P.full); // redirects, but intent = full is persisted
    expect(store.get('k')).toBe('full');
    expect(placementId(ctrl.snapshot().requested)).toBe('full');
  });

  it('seeds requested from a supported persisted intent; ignores unsupported/malformed', () => {
    const supported = createPlacementController({
      hostSurfaces: webHost,
      commit: okCommit,
      defaultPlacement: P.drawerRight,
      persistence: { read: () => 'floating.center', write: () => {} },
    });
    expect(placementId(supported.snapshot().requested)).toBe('floating.center');

    const unsupported = createPlacementController({
      hostSurfaces: { ...webHost, supported: ['drawer.right.primary'] },
      commit: okCommit,
      defaultPlacement: P.drawerRight,
      persistence: { read: () => 'floating.center', write: () => {} },
    });
    expect(placementId(unsupported.snapshot().requested)).toBe('drawer.right.primary');
  });
});

describe('chatPlacement — supersession & failure hardening (code review)', () => {
  it('a newer REJECTED request still supersedes an older in-flight one', async () => {
    let releaseFirst: (v: { ok: true }) => void = () => {};
    const commit: CommitFn = (target) =>
      placementId(target) === 'floating.center'
        ? new Promise((res) => (releaseFirst = res))
        : Promise.resolve({ ok: true });

    const ctrl = createPlacementController({
      hostSurfaces: { ...webHost, supported: ['drawer.right.primary', 'floating.center'] },
      commit,
      defaultPlacement: P.drawerRight,
    });

    const first = ctrl.requestPlacement(P.floatingCenter); // hangs
    const rejected = await ctrl.requestPlacement(P.full); // unsupported → rejected, but supersedes
    expect(rejected.status).toBe('rejected');

    releaseFirst({ ok: true }); // late ack for the now-superseded first request
    const firstResult = await first;
    expect(firstResult.status).toBe('superseded');
    // The superseded first request must NOT have mutated effective.
    expect(placementId(ctrl.snapshot().effective)).toBe('drawer.right.primary');
    expect(ctrl.snapshot().pending).toBeUndefined();
  });

  it('three concurrent requests where the latest commit fails leaves effective unchanged', async () => {
    const gates: Record<string, (v: { ok: true } | { ok: false; reason: 'host-failure' }) => void> = {};
    const commit: CommitFn = (target) =>
      new Promise((res) => (gates[placementId(target)] = res));

    const ctrl = createPlacementController({
      hostSurfaces: webHost,
      commit,
      defaultPlacement: P.drawerRight,
    });

    const a = ctrl.requestPlacement(P.floatingCenter);
    const b = ctrl.requestPlacement(P.drawerLeft);
    const c = ctrl.requestPlacement(P.full); // latest

    gates['floating.center']({ ok: true }); // a: superseded
    gates['drawer.left.primary']({ ok: true }); // b: superseded
    gates['full']({ ok: false, reason: 'host-failure' }); // c: latest → fails

    expect((await a).status).toBe('superseded');
    expect((await b).status).toBe('superseded');
    expect((await c).status).toBe('failed');
    // No committed transition landed → effective stays at the initial default.
    expect(placementId(ctrl.snapshot().effective)).toBe('drawer.right.primary');
    expect(ctrl.snapshot().pending).toBeUndefined();
  });

  it('a thrown/rejected commit becomes a terminal failed result (no dangling pending)', async () => {
    const commit: CommitFn = () => Promise.reject(new Error('boom'));
    const ctrl = createPlacementController({
      hostSurfaces: webHost,
      commit,
      defaultPlacement: P.drawerRight,
    });
    const r = await ctrl.requestPlacement(P.floatingCenter);
    expect(r.status).toBe('failed');
    expect(r.reason).toBe('host-failure');
    expect(ctrl.snapshot().pending).toBeUndefined();
    expect(ctrl.snapshot().lastResolution).toEqual({ status: 'failed', reason: 'host-failure' });
  });

  it('ignores an out-of-order (stale) environment revision', () => {
    const seen: number[] = [];
    const ctrl = createPlacementController({
      hostSurfaces: webHost,
      commit: okCommit,
      defaultPlacement: P.drawerRight,
      isViable: (id, env) => (env >= 2 ? id !== 'full' : true), // rev 2 hides full
    });
    ctrl.subscribe((s) => seen.push(s.available.length));
    ctrl.refreshEnvironment(2); // full hidden now
    const afterRev2 = ctrl.snapshot().available.map(placementId);
    ctrl.refreshEnvironment(1); // stale → ignored, no recompute
    expect(ctrl.snapshot().available.map(placementId)).toEqual(afterRev2);
    expect(afterRev2).not.toContain('full');
  });

  it('does not persist an unsupported target as intent', async () => {
    const store = new Map<string, string>();
    const ctrl = createPlacementController({
      hostSurfaces: { ...webHost, supported: ['drawer.right.primary'] },
      commit: okCommit,
      defaultPlacement: P.drawerRight,
      persistence: { read: () => store.get('k') ?? null, write: (id) => void store.set('k', id) },
    });
    await ctrl.requestPlacement(P.full); // unsupported
    expect(store.has('k')).toBe(false);
    expect(placementId(ctrl.snapshot().requested)).toBe('drawer.right.primary');
  });

  it('placementId throws on a runtime-invalid placement (defensive)', () => {
    expect(() => placementId({ kind: 'bogus' } as never)).toThrow();
  });
});

describe('chatPlacement — subscriber resilience (code review)', () => {
  it('isolates a throwing listener so the others still receive the snapshot', async () => {
    const ctrl = createPlacementController({
      hostSurfaces: webHost,
      commit: okCommit,
      defaultPlacement: P.drawerRight,
    });
    const good: string[] = [];
    ctrl.subscribe(() => {
      throw new Error('bad listener');
    });
    ctrl.subscribe((s) => good.push(placementId(s.effective)));
    await ctrl.requestPlacement(P.floatingCenter);
    expect(good).toContain('floating.center'); // survived the throwing peer
  });

  it('coalesces a reentrant notify so listeners end on the latest snapshot', async () => {
    const ctrl = createPlacementController({
      hostSurfaces: webHost,
      commit: okCommit,
      defaultPlacement: P.drawerRight,
    });
    const seen: string[] = [];
    let reentered = false;
    ctrl.subscribe((s) => {
      seen.push(placementId(s.effective));
      // Reentrant request from within a notification (once).
      if (!reentered && placementId(s.effective) === 'floating.center') {
        reentered = true;
        void ctrl.requestPlacement(P.drawerLeft);
      }
    });
    await ctrl.requestPlacement(P.floatingCenter);
    // eventual consistency: the last-seen effective must be the latest committed.
    expect(seen[seen.length - 1]).toBe('drawer.left.primary');
  });
});

describe('chatPlacement — subscription', () => {
  it('subscribe pushes current snapshot and stops after unsubscribe', async () => {
    const ctrl = createPlacementController({
      hostSurfaces: webHost,
      commit: okCommit,
      defaultPlacement: P.drawerRight,
    });
    const seen: string[] = [];
    const off = ctrl.subscribe((s) => seen.push(placementId(s.effective)));
    expect(seen).toEqual(['drawer.right.primary']); // immediate push
    await ctrl.requestPlacement(P.floatingCenter);
    expect(seen).toContain('floating.center');
    const count = seen.length;
    off();
    await ctrl.requestPlacement(P.drawerLeft);
    expect(seen.length).toBe(count); // no further notifications
  });
});
