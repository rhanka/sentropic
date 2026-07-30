/**
 * chatPlacement — headless chat surface placement controller (SPEC_EVOL_CHAT_SURFACES).
 *
 * Framework-neutral (no DOM, no Svelte): the placement STATE MACHINE + the D13
 * async prepare/commit transaction protocol. Hosts inject the real container
 * commit (re-parent) + a persistence adapter + environment viability; the design
 * system provides the visual Drawer/DropZone. This module owns only intent,
 * capability negotiation and transition sequencing.
 *
 * Decisions implemented here: D2 (taxonomy + canonical IDs), D3 (host capability
 * set), D6 (persist intent immediately, host-authoritative effective, monotonic
 * revisions), D13 (versioned async prepare/commit; effective changes only after
 * a successful commit; redirects preserve requested; superseded acks ignored).
 */

// --- D2: placement taxonomy + canonical IDs ---------------------------------

export type DrawerSide = 'left' | 'right';
export type FloatingAnchor = 'left' | 'center' | 'right';
export type Stickiness = 'top' | 'bottom';

export type ChatPlacement =
  | { kind: 'drawer'; side: DrawerSide; occupancy: 'primary' }
  | { kind: 'drawer'; side: DrawerSide; occupancy: 'stacked'; stickiness: Stickiness }
  | { kind: 'floating'; anchor: FloatingAnchor }
  | { kind: 'full' };

export type ChatPlacementId = string;

/** Canonical, normalized string id — the identity used for equality + capability sets. */
export function placementId(p: ChatPlacement): ChatPlacementId {
  switch (p.kind) {
    case 'drawer':
      return p.occupancy === 'stacked'
        ? `drawer.${p.side}.stacked.${p.stickiness}`
        : `drawer.${p.side}.primary`;
    case 'floating':
      return `floating.${p.anchor}`;
    case 'full':
      return 'full';
    default:
      throw new Error(
        `Invalid ChatPlacement: ${JSON.stringify(p)}`,
      );
  }
}

/** Parse a canonical id back to a normalized placement (throws on malformed). */
export function parsePlacementId(id: ChatPlacementId): ChatPlacement {
  const parts = id.split('.');
  if (id === 'full') return { kind: 'full' };
  if (parts[0] === 'floating' && parts.length === 2) {
    const anchor = parts[1] as FloatingAnchor;
    if (anchor === 'left' || anchor === 'center' || anchor === 'right') {
      return { kind: 'floating', anchor };
    }
  }
  if (parts[0] === 'drawer') {
    const side = parts[1] as DrawerSide;
    if (side === 'left' || side === 'right') {
      if (parts[2] === 'primary' && parts.length === 3) {
        return { kind: 'drawer', side, occupancy: 'primary' };
      }
      if (parts[2] === 'stacked' && parts.length === 4) {
        const stickiness = parts[3] as Stickiness;
        if (stickiness === 'top' || stickiness === 'bottom') {
          return { kind: 'drawer', side, occupancy: 'stacked', stickiness };
        }
      }
    }
  }
  throw new Error(`Invalid ChatPlacementId: ${id}`);
}

export function placementsEqual(a: ChatPlacement, b: ChatPlacement): boolean {
  return placementId(a) === placementId(b);
}

// --- D3: host capability set -------------------------------------------------

export type ReparentKind = 'dom' | 'command';

export type HostSurfaces = {
  /** Exact placement IDs this host can mount (NOT a boolean product). */
  supported: ChatPlacementId[];
  /** dom = web move (DnD viable); command = host API (e.g. vscode). */
  reparent: ReparentKind;
  /** Deterministic redirect order when a requested target is unavailable. */
  fallbackChain: ChatPlacementId[];
};

// --- D13: transition protocol ------------------------------------------------

export type PlacementReason =
  | 'unsupported'
  | 'temporarily-unavailable'
  | 'occupied'
  | 'viewport'
  | 'host-failure'
  | 'superseded';

export type PlacementResolutionStatus =
  | 'applied'
  | 'redirected'
  | 'rejected'
  | 'failed'
  | 'superseded';

export type PlacementSnapshot = {
  requested: ChatPlacement; // persisted user intent
  effective: ChatPlacement; // last successfully committed placement
  supported: ChatPlacement[]; // permanent host support
  available: ChatPlacement[]; // presently viable (supported ∧ environment)
  pending?: { id: number; target: ChatPlacement; resolvedTarget: ChatPlacement };
  lastResolution?: { status: PlacementResolutionStatus; reason?: PlacementReason };
};

export type PlacementResult = {
  status: PlacementResolutionStatus;
  placement: ChatPlacement;
  reason?: PlacementReason;
};

/**
 * Host performs the physical re-parent; resolves ok, or fails with a reason.
 *
 * HOST CONTRACT (the controller cannot enforce this — it only sequences intent):
 * commits MUST be serialized per controller, and a commit for a `revision`
 * older than the latest MUST be rejected or made a no-op. Otherwise a superseded
 * move can still land its physical side-effect after a newer one, leaving the
 * DOM at an older placement than the controller's `effective`. A thrown/rejected
 * commit is treated by the controller as `{ ok: false, reason: 'host-failure' }`.
 */
export type CommitFn = (
  target: ChatPlacement,
  revision: number,
) => Promise<{ ok: true } | { ok: false; reason: PlacementReason }>;

export type PlacementPersistence = {
  read: () => ChatPlacementId | null;
  write: (id: ChatPlacementId) => void;
};

export type PlacementControllerConfig = {
  hostSurfaces: HostSurfaces;
  commit: CommitFn;
  defaultPlacement: ChatPlacement;
  /** Optional persisted user intent (D6). Malformed/unsupported values are ignored. */
  persistence?: PlacementPersistence;
  /** Temporary viability gate (viewport, occupancy). Defaults to always viable. */
  isViable?: (id: ChatPlacementId, environmentRevision: number) => boolean;
  /**
   * When true, `effective` is seeded directly (synchronously, on construction)
   * from the persisted-supported intent (falling back to `defaultPlacement`)
   * WITHOUT going through `requestPlacement` — so construction never issues a
   * commit or a persistence write. Only an explicit `requestPlacement()` call
   * (i.e. real user/host action) persists. Defaults to false, preserving the
   * existing behavior where `effective` starts at `defaultPlacement` until the
   * host explicitly requests the seeded intent.
   */
  seedEffectiveFromRequested?: boolean;
};

export type PlacementController = {
  snapshot(): PlacementSnapshot;
  /** Async prepare/commit (D13). One-frame for DOM hosts, multi-step for command hosts. */
  requestPlacement(target: ChatPlacement): Promise<PlacementResult>;
  /** Recompute `available` for a new environment revision (pure, host-signalled). */
  refreshEnvironment(revision: number): void;
  subscribe(cb: (s: PlacementSnapshot) => void): () => void;
};

export function createPlacementController(
  config: PlacementControllerConfig,
): PlacementController {
  const { hostSurfaces, commit, persistence, defaultPlacement } = config;
  const isViable = config.isViable ?? (() => true);
  const supportedSet = new Set(hostSurfaces.supported);

  const supported = hostSurfaces.supported.map(parsePlacementId);

  // D6: seed requested from persisted intent when it is supported; else default.
  const seededId = persistence?.read() ?? null;
  const initialRequested: ChatPlacement =
    seededId && supportedSet.has(seededId)
      ? parsePlacementId(seededId)
      : defaultPlacement;

  let environmentRevision = 0;
  let requested = initialRequested;
  // Not yet committed to the seeded intent — UNLESS the host opted into
  // synchronous seeding (seedEffectiveFromRequested), in which case `effective`
  // starts at the persisted-supported intent directly, with no commit/write.
  let effective = config.seedEffectiveFromRequested ? initialRequested : defaultPlacement;
  let pending: PlacementSnapshot['pending'] | undefined;
  let lastResolution: PlacementSnapshot['lastResolution'] | undefined;
  let pendingCounter = 0;

  const listeners = new Set<(s: PlacementSnapshot) => void>();

  const computeAvailable = (): ChatPlacement[] =>
    supported.filter((p) => isViable(placementId(p), environmentRevision));

  const snapshot = (): PlacementSnapshot => ({
    requested,
    effective,
    supported: [...supported],
    available: computeAvailable(),
    pending,
    lastResolution,
  });

  // Reentrancy- and exception-safe notification: iterate a stable copy of the
  // listener set (so subscribe/unsubscribe mid-notify is safe), isolate each
  // listener's exceptions (one throwing listener never aborts the others or the
  // caller's transition), and coalesce reentrant notify() calls into one more
  // pass with a fresh snapshot so listeners always end on the latest state.
  let notifying = false;
  let renotify = false;
  const notify = () => {
    if (notifying) {
      renotify = true;
      return;
    }
    notifying = true;
    try {
      do {
        renotify = false;
        const s = snapshot();
        for (const cb of [...listeners]) {
          try {
            cb(s);
          } catch {
            /* isolate listener failure */
          }
        }
      } while (renotify);
    } finally {
      notifying = false;
    }
  };

  /** Resolve a requested target to a viable one, walking the fallback chain. */
  const resolveTarget = (
    target: ChatPlacement,
  ): { resolved: ChatPlacement } | { reason: PlacementReason } => {
    const targetId = placementId(target);
    if (!supportedSet.has(targetId)) return { reason: 'unsupported' };
    if (isViable(targetId, environmentRevision)) return { resolved: target };
    for (const id of hostSurfaces.fallbackChain) {
      if (supportedSet.has(id) && isViable(id, environmentRevision)) {
        return { resolved: parsePlacementId(id) };
      }
    }
    return { reason: 'temporarily-unavailable' };
  };

  const requestPlacement = async (
    target: ChatPlacement,
  ): Promise<PlacementResult> => {
    // Allocate the monotonic revision FIRST — before any resolution outcome —
    // so ANY newer request (even one that ends up rejected) supersedes an
    // older in-flight one. `pending` from a prior in-flight request is cleared;
    // that request's late ack will see id !== pendingCounter and be superseded.
    const id = ++pendingCounter;
    const targetId = placementId(target); // throws on a runtime-invalid object

    if (!supportedSet.has(targetId)) {
      pending = undefined;
      lastResolution = { status: 'rejected', reason: 'unsupported' };
      notify();
      return { status: 'rejected', placement: effective, reason: 'unsupported' };
    }

    // D6: persist a SUPPORTED user intent immediately (before commit), even if
    // it later redirects or the commit fails — intent is preserved separately
    // from host-authoritative `effective`. Unsupported targets are NOT persisted
    // (they can never be honored on this host and would poison a reload seed).
    requested = target;
    persistence?.write(targetId);

    const resolution = resolveTarget(target);
    if ('reason' in resolution) {
      pending = undefined;
      lastResolution = { status: 'rejected', reason: resolution.reason };
      notify();
      return { status: 'rejected', placement: effective, reason: resolution.reason };
    }
    const resolvedTarget = resolution.resolved;

    pending = { id, target, resolvedTarget };
    notify();

    let committed: { ok: true } | { ok: false; reason: PlacementReason };
    try {
      committed = await commit(resolvedTarget, id);
    } catch {
      committed = { ok: false, reason: 'host-failure' };
    }

    // D13: a newer request superseded this one → ignore this ack entirely
    // (do NOT clear pending — it belongs to the newer request now).
    if (id !== pendingCounter) {
      return { status: 'superseded', placement: effective, reason: 'superseded' };
    }
    pending = undefined;

    if (!committed.ok) {
      lastResolution = { status: 'failed', reason: committed.reason };
      notify();
      return { status: 'failed', placement: effective, reason: committed.reason };
    }

    effective = resolvedTarget;
    const redirected = !placementsEqual(resolvedTarget, target);
    lastResolution = { status: redirected ? 'redirected' : 'applied' };
    notify();
    return {
      status: redirected ? 'redirected' : 'applied',
      placement: effective,
    };
  };

  // Recompute `available` for a NEWER environment revision (monotonic: a stale/
  // out-of-order revision is ignored). This never auto-corrects `effective` —
  // `effective` = last committed, `available` = currently viable; if a viewport
  // shrink makes `effective` non-viable, the HOST must issue a new
  // requestPlacement (and revalidate any in-flight `pending` against viability).
  const refreshEnvironment = (revision: number) => {
    if (revision <= environmentRevision) return;
    environmentRevision = revision;
    notify();
  };

  const subscribe = (cb: (s: PlacementSnapshot) => void): (() => void) => {
    listeners.add(cb);
    try {
      cb(snapshot()); // immediate push — isolated like notify()
    } catch {
      /* isolate listener failure */
    }
    return () => listeners.delete(cb);
  };

  return { snapshot, requestPlacement, refreshEnvironment, subscribe };
}
