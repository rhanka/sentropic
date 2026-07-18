import { describe, expect, it, vi } from 'vitest';
import {
  buildChatPlacementPersistenceKey,
  createChatPlacementMenu,
} from '../src/state/chatPlacementMenu';
import { placementId, type ChatPlacement } from '../src/state/chatPlacement';

/** In-memory Storage stand-in — deterministic, no jsdom/global leakage. */
const createMemoryStorage = (): Storage => {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size;
    },
  } as Storage;
};

/** Flush the fire-and-forget restore commit issued at construction time. */
const flushAsync = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('chatPlacementMenu — persistence key (D6)', () => {
  it('builds the exact key format chat-ui/placement/v1/${userId}/${hostId}/${workspace}', () => {
    expect(
      buildChatPlacementPersistenceKey({
        userId: 'user-42',
        hostId: 'sentropic-web',
        workspace: 'ws-9',
      }),
    ).toBe('chat-ui/placement/v1/user-42/sentropic-web/ws-9');
  });

  it('writes to storage under the exact key on request', async () => {
    const storage = createMemoryStorage();
    const setItemSpy = vi.spyOn(storage, 'setItem');
    const menu = createChatPlacementMenu({
      userId: 'user-42',
      hostId: 'sentropic-web',
      workspace: 'ws-9',
      storage,
    });
    await menu.request({ kind: 'full' });
    expect(setItemSpy).toHaveBeenCalledWith(
      'chat-ui/placement/v1/user-42/sentropic-web/ws-9',
      'full',
    );
  });
});

describe('chatPlacementMenu — construction does not write persistence (code review)', () => {
  it('does NOT call storage.setItem during construction (no seed write)', () => {
    const storage = createMemoryStorage();
    const setItemSpy = vi.spyOn(storage, 'setItem');
    createChatPlacementMenu({ userId: 'u1', hostId: 'h1', workspace: 'w1', storage });
    expect(setItemSpy).not.toHaveBeenCalled();
  });

  it('does NOT write the default placement under an anonymous/no-intent key on construction', () => {
    const storage = createMemoryStorage();
    createChatPlacementMenu({ userId: 'anonymous', hostId: 'h1', workspace: 'default', storage });
    expect(storage.getItem('chat-ui/placement/v1/anonymous/h1/default')).toBeNull();
  });

  it('request() (explicit user action) DOES call storage.setItem', async () => {
    const storage = createMemoryStorage();
    const setItemSpy = vi.spyOn(storage, 'setItem');
    const menu = createChatPlacementMenu({ userId: 'u1', hostId: 'h1', workspace: 'w1', storage });
    expect(setItemSpy).not.toHaveBeenCalled();
    await menu.request({ kind: 'full' });
    expect(setItemSpy).toHaveBeenCalledWith('chat-ui/placement/v1/u1/h1/w1', 'full');
  });
});

describe('chatPlacementMenu — items', () => {
  it('exposes exactly 4 items: Right / Left / Center / Full', () => {
    const menu = createChatPlacementMenu({
      userId: 'u1',
      hostId: 'h1',
      workspace: 'w1',
      storage: createMemoryStorage(),
    });
    expect(menu.items.map((i) => i.id)).toEqual([
      'floating.right',
      'floating.left',
      'floating.center',
      'full',
    ]);
    expect(menu.items.map((i) => i.label)).toEqual(['Right', 'Left', 'Center', 'Full']);
    expect(menu.items.find((i) => i.id === 'full')?.placement).toEqual({ kind: 'full' });
  });
});

describe('chatPlacementMenu — request -> current + persistence write', () => {
  it('updates current() after a supported request settles', async () => {
    const menu = createChatPlacementMenu({
      userId: 'u1',
      hostId: 'h1',
      workspace: 'w1',
      storage: createMemoryStorage(),
    });
    await flushAsync();
    await menu.request({ kind: 'floating', anchor: 'center' });
    expect(menu.current()).toEqual({ kind: 'floating', anchor: 'center' });
  });

  it('notifies subscribers with the new current placement', async () => {
    const menu = createChatPlacementMenu({
      userId: 'u1',
      hostId: 'h1',
      workspace: 'w1',
      storage: createMemoryStorage(),
    });
    await flushAsync();
    const seen: string[] = [];
    const unsubscribe = menu.subscribe((p) => seen.push(placementId(p)));
    await menu.request({ kind: 'full' });
    expect(seen).toContain('full');
    unsubscribe();
  });
});

describe('chatPlacementMenu — construction reads persisted intent (D6)', () => {
  it('restores a previously persisted placement as current after construction settles', async () => {
    const storage = createMemoryStorage();
    storage.setItem('chat-ui/placement/v1/u1/h1/w1', 'floating.left');
    const menu = createChatPlacementMenu({ userId: 'u1', hostId: 'h1', workspace: 'w1', storage });
    await flushAsync();
    expect(menu.current()).toEqual({ kind: 'floating', anchor: 'left' });
  });

  it('falls back to the default placement when nothing is persisted', async () => {
    const menu = createChatPlacementMenu({
      userId: 'u1',
      hostId: 'h1',
      workspace: 'w1',
      storage: createMemoryStorage(),
    });
    await flushAsync();
    expect(menu.current()).toEqual({ kind: 'floating', anchor: 'right' });
  });

  it('ignores a persisted value that is unsupported/malformed for this host', async () => {
    const storage = createMemoryStorage();
    storage.setItem('chat-ui/placement/v1/u1/h1/w1', 'drawer.left.primary');
    const menu = createChatPlacementMenu({ userId: 'u1', hostId: 'h1', workspace: 'w1', storage });
    await flushAsync();
    expect(menu.current()).toEqual({ kind: 'floating', anchor: 'right' });
  });
});

describe('chatPlacementMenu — fallback / rejection for an unsupported target', () => {
  it('leaves current() unchanged when the requested placement is unsupported', async () => {
    const menu = createChatPlacementMenu({
      userId: 'u1',
      hostId: 'h1',
      workspace: 'w1',
      storage: createMemoryStorage(),
    });
    await flushAsync();
    const before = menu.current();
    const unsupported: ChatPlacement = { kind: 'drawer', side: 'left', occupancy: 'primary' };
    await menu.request(unsupported);
    expect(menu.current()).toEqual(before);
  });
});

describe('chatPlacementMenu — storage-absent safety', () => {
  it('does not throw when no storage adapter is available (SSR)', async () => {
    expect(() =>
      createChatPlacementMenu({ userId: 'u1', hostId: 'h1', workspace: 'w1', storage: undefined }),
    ).not.toThrow();
  });

  it('request() still resolves and current() still updates without storage', async () => {
    const menu = createChatPlacementMenu({
      userId: 'u1',
      hostId: 'h1',
      workspace: 'w1',
      storage: undefined,
    });
    await flushAsync();
    await expect(menu.request({ kind: 'full' })).resolves.toBeUndefined();
    expect(menu.current()).toEqual({ kind: 'full' });
  });
});

describe('chatPlacementMenu — snapshot()', () => {
  it('exposes the full underlying controller snapshot', () => {
    const menu = createChatPlacementMenu({
      userId: 'u1',
      hostId: 'h1',
      workspace: 'w1',
      storage: createMemoryStorage(),
    });
    const s = menu.snapshot();
    expect(s.supported.map(placementId)).toContain('drawer.right.primary');
    expect(s.supported.map(placementId)).toContain('floating.right');
    expect(s.supported.map(placementId)).toContain('floating.left');
    expect(s.supported.map(placementId)).toContain('floating.center');
    expect(s.supported.map(placementId)).toContain('full');
  });
});
