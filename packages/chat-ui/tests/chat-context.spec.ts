import { describe, expect, it, vi } from 'vitest';
import {
  createNoopChatContextProvider,
  type ChatContextEntry,
  type ChatContextProvider,
  type ReadableStore,
} from '../src/state/chat-context.js';

// ---------------------------------------------------------------------------
// createNoopChatContextProvider
// ---------------------------------------------------------------------------

describe('createNoopChatContextProvider', () => {
  it('should return an object with a context store', () => {
    const provider = createNoopChatContextProvider();
    expect(provider).toBeDefined();
    expect(typeof provider.context).toBe('object');
    expect(typeof provider.context.subscribe).toBe('function');
  });

  it('should emit an empty array immediately on subscribe', () => {
    const provider = createNoopChatContextProvider();
    const received: ChatContextEntry[][] = [];
    provider.context.subscribe((val) => received.push(val));
    expect(received).toHaveLength(1);
    expect(received[0]).toEqual([]);
  });

  it('should return an unsubscribe function that is callable without error', () => {
    const provider = createNoopChatContextProvider();
    let unsub: (() => void) | undefined;
    unsub = provider.context.subscribe(() => undefined);
    expect(() => unsub?.()).not.toThrow();
  });

  it('should not call subscriber again after initial emission (no-op store)', () => {
    const provider = createNoopChatContextProvider();
    const received: ChatContextEntry[][] = [];
    provider.context.subscribe((val) => received.push(val));
    // No further emissions are expected from the no-op store.
    expect(received).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// ChatContextEntry shape — structural checks
// ---------------------------------------------------------------------------

describe('ChatContextEntry type structural checks', () => {
  it('should accept a minimal entry (type + label only)', () => {
    const entry: ChatContextEntry = { type: 'folder', label: 'My Folder' };
    expect(entry.type).toBe('folder');
    expect(entry.label).toBe('My Folder');
    expect(entry.id).toBeUndefined();
    expect(entry.active).toBeUndefined();
    expect(entry.used).toBeUndefined();
    expect(entry.lastUsedAt).toBeUndefined();
  });

  it('should accept a fully-populated entry', () => {
    const entry: ChatContextEntry = {
      type: 'initiative',
      id: 'init-123',
      label: 'Q1 Growth',
      active: true,
      used: true,
      lastUsedAt: '2026-06-02T00:00:00.000Z',
    };
    expect(entry.type).toBe('initiative');
    expect(entry.id).toBe('init-123');
    expect(entry.active).toBe(true);
    expect(entry.used).toBe(true);
    expect(entry.lastUsedAt).toBe('2026-06-02T00:00:00.000Z');
  });

  it('should accept unknown domain types (open string — neutral)', () => {
    const entry: ChatContextEntry = { type: 'signal', id: 'sig-999', label: 'Weekly Signal' };
    expect(entry.type).toBe('signal');
  });
});

// ---------------------------------------------------------------------------
// ChatContextProvider structural checks — host-supplied readable
// ---------------------------------------------------------------------------

describe('ChatContextProvider contract', () => {
  it('should accept a host-supplied readable that emits entries', () => {
    const entries: ChatContextEntry[] = [
      { type: 'organization', id: 'org-1', label: 'Acme Corp', active: true, used: false },
    ];

    // Simulate a minimal host-side store.
    const mockStore: ReadableStore<ChatContextEntry[]> = {
      subscribe(run) {
        run(entries);
        return () => undefined;
      },
    };

    const provider: ChatContextProvider = { context: mockStore };
    const received: ChatContextEntry[][] = [];
    provider.context.subscribe((val) => received.push(val));

    expect(received).toHaveLength(1);
    expect(received[0]).toHaveLength(1);
    expect(received[0][0].type).toBe('organization');
    expect(received[0][0].label).toBe('Acme Corp');
  });

  it('should support multiple subscribers independently', () => {
    const provider = createNoopChatContextProvider();
    const first: ChatContextEntry[][] = [];
    const second: ChatContextEntry[][] = [];

    provider.context.subscribe((val) => first.push(val));
    provider.context.subscribe((val) => second.push(val));

    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Assignability proof — Sentropic app shape maps to neutral interface
// ---------------------------------------------------------------------------

describe('assignability: Sentropic app context-provider shape maps to ChatContextEntry', () => {
  /**
   * The app's ChatContextEntry uses:
   *   contextType (string), contextId? (string), label (string),
   *   active (boolean), used (boolean), lastUsedAt (number — epoch ms).
   *
   * The neutral ChatContextEntry uses:
   *   type (string), id? (string), label (string),
   *   active? (boolean), used? (boolean), lastUsedAt? (string — ISO-8601).
   *
   * The adapter below proves the mapping is trivial (no structural mismatch).
   */
  type AppChatContextEntry = {
    contextType: string;
    contextId?: string;
    label: string;
    active: boolean;
    used: boolean;
    lastUsedAt: number;
  };

  const mapAppEntryToNeutral = (app: AppChatContextEntry): ChatContextEntry => ({
    type: app.contextType,
    id: app.contextId,
    label: app.label,
    active: app.active,
    used: app.used,
    lastUsedAt: new Date(app.lastUsedAt).toISOString(),
  });

  it('should map a Sentropic app entry to a neutral ChatContextEntry', () => {
    const appEntry: AppChatContextEntry = {
      contextType: 'folder',
      contextId: 'folder-42',
      label: 'My Folder',
      active: true,
      used: true,
      lastUsedAt: 1748822400000,
    };

    const neutral = mapAppEntryToNeutral(appEntry);

    expect(neutral.type).toBe('folder');
    expect(neutral.id).toBe('folder-42');
    expect(neutral.label).toBe('My Folder');
    expect(neutral.active).toBe(true);
    expect(neutral.used).toBe(true);
    expect(typeof neutral.lastUsedAt).toBe('string');
    // ISO-8601 string is parseable back to the original epoch.
    expect(new Date(neutral.lastUsedAt!).getTime()).toBe(1748822400000);
  });

  it('should map an entry without contextId (active top-level route)', () => {
    const appEntry: AppChatContextEntry = {
      contextType: 'organization',
      label: 'All Orgs',
      active: true,
      used: false,
      lastUsedAt: 0,
    };
    const neutral = mapAppEntryToNeutral(appEntry);
    expect(neutral.type).toBe('organization');
    expect(neutral.id).toBeUndefined();
  });
});
