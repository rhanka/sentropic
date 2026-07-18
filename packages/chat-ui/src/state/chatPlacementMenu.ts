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
  type ChatPlacement,
  type ChatPlacementId,
  type CommitFn,
  type HostSurfaces,
  type PlacementPersistence,
  type PlacementSnapshot,
} from './chatPlacement.js';

// --- Web host capability set --------------------------------------------------

const WEB_HOST_SURFACES: HostSurfaces = {
  supported: [
    'drawer.right.primary',
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

// --- Menu items (Right/Left/Center/Full) --------------------------------------

const MENU_ITEM_IDS: ChatPlacementId[] = [
  'floating.right',
  'floating.left',
  'floating.center',
  'full',
];

const MENU_ITEM_LABELS: Record<ChatPlacementId, string> = {
  'floating.right': 'Right',
  'floating.left': 'Left',
  'floating.center': 'Center',
  full: 'Full',
};

export type ChatPlacementMenuItem = {
  id: ChatPlacementId;
  label: string;
  placement: ChatPlacement;
};

const MENU_ITEMS: ChatPlacementMenuItem[] = MENU_ITEM_IDS.map((id) => ({
  id,
  label: MENU_ITEM_LABELS[id],
  placement: parsePlacementId(id),
}));

// --- D6 persistence: chat-ui/placement/v1/${userId}/${hostId}/${workspace} ---

export const buildChatPlacementPersistenceKey = (opts: {
  userId: string;
  hostId: string;
  workspace: string;
}): string => `chat-ui/placement/v1/${opts.userId}/${opts.hostId}/${opts.workspace}`;

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

// --- Public factory ------------------------------------------------------------

export type CreateChatPlacementMenuOptions = {
  userId: string;
  hostId: string;
  workspace: string;
  /** Storage adapter override (tests / non-window hosts). Defaults to globalThis.localStorage. */
  storage?: Storage;
  /** Defaults to the legacy floating-right placement. */
  defaultPlacement?: ChatPlacement;
};

export type ChatPlacementMenu = {
  /** The 4 selectable menu entries: Right / Left / Center / Full. */
  items: ChatPlacementMenuItem[];
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

  const controller = createPlacementController({
    hostSurfaces: WEB_HOST_SURFACES,
    commit: webCommit,
    defaultPlacement,
    persistence,
  });

  // D6: `requested` is seeded from persistence synchronously, but `effective`
  // (what current() reports) only advances after a successful commit. Restore
  // any persisted intent immediately so a returning user's chosen placement
  // becomes active without the host having to know about this protocol detail.
  const seeded = controller.snapshot().requested;
  void controller.requestPlacement(seeded);

  return {
    items: MENU_ITEMS,
    current: () => controller.snapshot().effective,
    request: async (placement) => {
      await controller.requestPlacement(placement);
    },
    subscribe: (cb) => controller.subscribe((s) => cb(s.effective)),
    snapshot: () => controller.snapshot(),
  };
}
