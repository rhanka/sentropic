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

/** Host performs the physical re-parent; resolves ok, or fails with a reason. */
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
  let effective = defaultPlacement; // not yet committed to the seeded intent
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

  const notify = () => {
    const s = snapshot();
    for (const cb of listeners) cb(s);
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
    const resolution = resolveTarget(target);
    if ('reason' in resolution) {
      lastResolution = { status: 'rejected', reason: resolution.reason };
      notify();
      return { status: 'rejected', placement: effective, reason: resolution.reason };
    }
    const resolvedTarget = resolution.resolved;

    // D6: persist intent IMMEDIATELY (before commit), even if it later redirects.
    requested = target;
    persistence?.write(placementId(target));

    const id = ++pendingCounter;
    pending = { id, target, resolvedTarget };
    notify();

    const committed = await commit(resolvedTarget, id);

    // D13: a newer request superseded this one → ignore this ack entirely.
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

  const refreshEnvironment = (revision: number) => {
    environmentRevision = revision;
    notify();
  };

  const subscribe = (cb: (s: PlacementSnapshot) => void): (() => void) => {
    listeners.add(cb);
    cb(snapshot());
    return () => listeners.delete(cb);
  };

  return { snapshot, requestPlacement, refreshEnvironment, subscribe };
}
