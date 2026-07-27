/**
 * chatPlacementMenu — headless "Move chat to…" menu model (SPEC_EVOL_CHAT_SURFACES,
 * surfaces L1c-menu).
 *
 * Framework-neutral (no DOM, no Svelte): composes the SHIPPED chatPlacement
 * controller with the web host's capability set, a trivial class-swap commit
 * (ChatDock re-renders via placementContainerClasses — there is no physical
 * DOM re-parent to perform), and a per-user/host/workspace localStorage
 * persistence adapter (D6). The visual popup affordance lives in
 * ChatDock.svelte; this module owns only intent + the 4-item menu surface.
 */

import {
  createPlacementController,
  parsePlacementId,
  placementId,
  type ChatPlacement,
  type ChatPlacementId,
  type CommitFn,
  type DrawerSide,
  type FloatingAnchor,
  type HostSurfaces,
  type PlacementPersistence,
  type PlacementSnapshot,
} from './chatPlacement.js';

// --- Web host capability set --------------------------------------------------

const WEB_HOST_SURFACES: HostSurfaces = {
  supported: [
    'drawer.right.primary',
    'drawer.left.primary',
    'floating.right',
    'floating.left',
    'floating.center',
    'full',
  ],
  reparent: 'dom',
  fallbackChain: ['floating.right', 'drawer.right.primary'],
};

// Web commit is a trivial class-swap: ChatDock re-renders its ONE stable
// container via placementContainerClasses(current placement) — there is no
// real DOM re-parent to perform here, so the commit always succeeds.
const webCommit: CommitFn = async () => ({ ok: true });

// --- Menu groups + labels -----------------------------------------------------

export type ChatPlacementMenuLabels = {
  menuLabel: string;
  modeGroupLabel: string;
  sideGroupLabel: string;
  panel: string;
  floating: string;
  full: string;
  right: string;
  center: string;
  left: string;
};

export const createDefaultChatPlacementMenuLabels = (
  overrides: Partial<ChatPlacementMenuLabels> = {},
): ChatPlacementMenuLabels => ({
  menuLabel: 'Move chat to…',
  modeGroupLabel: 'Mode',
  sideGroupLabel: 'Side',
  panel: 'Panel',
  floating: 'Floating',
  full: 'Full screen',
  right: 'Right',
  center: 'Center',
  left: 'Left',
  ...overrides,
});

export const createFrenchChatPlacementMenuLabels = (
  overrides: Partial<ChatPlacementMenuLabels> = {},
): ChatPlacementMenuLabels => createDefaultChatPlacementMenuLabels({
  menuLabel: 'Déplacer le chat vers…',
  modeGroupLabel: 'Mode',
  sideGroupLabel: 'Côté',
  panel: 'Panneau',
  floating: 'Libre',
  full: 'Plein écran',
  right: 'Droite',
  center: 'Centre',
  left: 'Gauche',
  ...overrides,
});

export type ChatPlacementMenuItem = {
  id: 'panel' | 'floating' | 'full' | 'right' | 'center' | 'left';
  label: string;
  placement: ChatPlacement;
  checked: boolean;
};

export type ChatPlacementMenuGroup = {
  id: 'mode' | 'side';
  label: string;
  items: ChatPlacementMenuItem[];
};

// --- D6 persistence: chat-ui/placement/v1/${userId}/${hostId}/${workspace} ---

export const buildChatPlacementPersistenceKey = (opts: {
  userId: string;
  hostId: string;
  workspace: string;
}): string => `chat-ui/placement/v1/${opts.userId}/${opts.hostId}/${opts.workspace}`;

const buildChatPlacementSideMemoryKey = (persistenceKey: string): string =>
  `${persistenceKey}/sides`;

const resolveDefaultStorage = (): Storage | undefined => {
  try {
    return typeof globalThis !== 'undefined'
      ? (globalThis as { localStorage?: Storage }).localStorage
      : undefined;
  } catch {
    // Accessing localStorage can throw (e.g. private-mode / sandboxed iframes).
    return undefined;
  }
};

const createLocalStoragePersistence = (
  key: string,
  storage: Storage | undefined,
): PlacementPersistence => ({
  read: () => {
    if (!storage) return null;
    try {
      return storage.getItem(key);
    } catch {
      return null;
    }
  },
  write: (id) => {
    if (!storage) return;
    try {
      storage.setItem(key, id);
    } catch {
      // Ignore quota/security errors — persistence is best-effort.
    }
  },
});

type ChatPlacementSideMemory = {
  drawerSide: DrawerSide;
  floatingAnchor: FloatingAnchor;
};

const readSideMemory = (
  storage: Storage | undefined,
  key: string,
): Partial<ChatPlacementSideMemory> => {
  if (!storage) return {};
  try {
    const parsed = JSON.parse(storage.getItem(key) ?? 'null') as Partial<ChatPlacementSideMemory> | null;
    return {
      ...(parsed?.drawerSide === 'left' || parsed?.drawerSide === 'right'
        ? { drawerSide: parsed.drawerSide }
        : {}),
      ...(parsed?.floatingAnchor === 'left'
        || parsed?.floatingAnchor === 'center'
        || parsed?.floatingAnchor === 'right'
        ? { floatingAnchor: parsed.floatingAnchor }
        : {}),
    };
  } catch {
    return {};
  }
};

// --- Public factory ------------------------------------------------------------

export type CreateChatPlacementMenuOptions = {
  userId: string;
  hostId: string;
  workspace: string;
  /** Storage adapter override (tests / non-window hosts). Defaults to globalThis.localStorage. */
  storage?: Storage;
  /** Defaults to the legacy floating-right placement. */
  defaultPlacement?: ChatPlacement;
  /** Localised menu copy. Defaults to the reusable English preset. */
  labels?: Partial<ChatPlacementMenuLabels>;
};

export type ChatPlacementMenu = {
  /** Resolved localised labels used by the visual host. */
  labels: ChatPlacementMenuLabels;
  /** The contextual MODE and SIDE groups rendered by a visual host. */
  groups(): ChatPlacementMenuGroup[];
  /** The currently active (last committed) placement. */
  current(): ChatPlacement;
  /** Request a placement change; resolves once the transition settles. */
  request(placement: ChatPlacement): Promise<void>;
  /** Notified with the new active placement whenever it changes. Returns an unsubscribe fn. */
  subscribe(cb: (current: ChatPlacement) => void): () => void;
  /** Full underlying controller snapshot, for hosts that need more than `current()`. */
  snapshot(): PlacementSnapshot;
};

export function createChatPlacementMenu(
  opts: CreateChatPlacementMenuOptions,
): ChatPlacementMenu {
  const storage = opts.storage ?? resolveDefaultStorage();
  const persistenceKey = buildChatPlacementPersistenceKey(opts);
  const persistence = createLocalStoragePersistence(persistenceKey, storage);
  const defaultPlacement: ChatPlacement =
    opts.defaultPlacement ?? { kind: 'floating', anchor: 'right' };
  const labels = createDefaultChatPlacementMenuLabels(opts.labels);

  const storedSideMemory = readSideMemory(storage, buildChatPlacementSideMemoryKey(persistenceKey));
  let drawerSide: DrawerSide = storedSideMemory.drawerSide ?? (defaultPlacement.kind === 'drawer'
    ? defaultPlacement.side
    : 'right');
  let floatingAnchor: FloatingAnchor = storedSideMemory.floatingAnchor ?? (defaultPlacement.kind === 'floating'
    ? defaultPlacement.anchor
    : 'right');

  // D6: `requested` is seeded from persistence synchronously, and — via
  // seedEffectiveFromRequested — `effective` (what current() reports) is
  // ALSO seeded synchronously to that same persisted-supported intent, so a
  // returning user's chosen placement is active immediately. This does NOT
  // go through requestPlacement, so construction never issues a persistence
  // write: only an explicit request() (real user action) persists. Writing
  // on construction would otherwise persist the default placement (e.g.
  // floating.right) under an anonymous/pre-auth key and could clobber an
  // already-stored value on every re-construction.
  const controller = createPlacementController({
    hostSurfaces: WEB_HOST_SURFACES,
    commit: webCommit,
    defaultPlacement,
    persistence,
    seedEffectiveFromRequested: true,
  });

  const rememberSide = (placement: ChatPlacement) => {
    if (placement.kind === 'drawer' && placement.occupancy === 'primary') {
      drawerSide = placement.side;
    }
    if (placement.kind === 'floating') floatingAnchor = placement.anchor;
  };

  const writeSideMemory = () => {
    if (!storage) return;
    try {
      storage.setItem(
        buildChatPlacementSideMemoryKey(persistenceKey),
        JSON.stringify({ drawerSide, floatingAnchor }),
      );
    } catch {
      // Persistence is best-effort, matching the placement intent adapter.
    }
  };

  rememberSide(controller.snapshot().effective);

  const groups = (): ChatPlacementMenuGroup[] => {
    const current = controller.snapshot().effective;
    const panelPlacement: ChatPlacement = {
      kind: 'drawer', side: drawerSide, occupancy: 'primary',
    };
    const floatingPlacement: ChatPlacement = { kind: 'floating', anchor: floatingAnchor };
    const mode: ChatPlacementMenuGroup = {
      id: 'mode',
      label: labels.modeGroupLabel,
      items: [
        { id: 'panel', label: labels.panel, placement: panelPlacement, checked: current.kind === 'drawer' },
        { id: 'floating', label: labels.floating, placement: floatingPlacement, checked: current.kind === 'floating' },
        { id: 'full', label: labels.full, placement: { kind: 'full' }, checked: current.kind === 'full' },
      ],
    };
    if (current.kind === 'full') return [mode];
    const sideItems: ChatPlacementMenuItem[] = current.kind === 'drawer'
      ? (['right', 'left'] as DrawerSide[]).map((side) => ({
          id: side,
          label: labels[side],
          placement: { kind: 'drawer', side, occupancy: 'primary' },
          checked: current.side === side,
        }))
      : (['right', 'center', 'left'] as FloatingAnchor[]).map((anchor) => ({
          id: anchor,
          label: labels[anchor],
          placement: { kind: 'floating', anchor },
          checked: current.anchor === anchor,
        }));
    return [mode, { id: 'side', label: labels.sideGroupLabel, items: sideItems }];
  };

  return {
    labels,
    groups,
    current: () => controller.snapshot().effective,
    request: async (placement) => {
      rememberSide(placement);
      writeSideMemory();
      await controller.requestPlacement(placement);
    },
    subscribe: (cb) => controller.subscribe((s) => cb(s.effective)),
    snapshot: () => controller.snapshot(),
  };
}
