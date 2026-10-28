/**
 * context.spec.ts — Deterministic tests for the @sentropic/chat-ui/context module.
 *
 * Tests:
 *   1. context-entry.ts: toChatRouteContextKey, upsertRouteContextEntry,
 *      selectActiveChatContexts
 *   2. module.ts / createContextModule: fake-host harness
 *      - updateFromRoute → label-resolve → store-update
 *      - toggleActive
 *      - markUsed
 *      - loadPrefs migration: legacy epoch-ms lastUsedAt + usecase→initiative type
 *   3. CRITICAL: prefs-migration test (data-loss prevention)
 *   4. Zero sentropic domain strings in src/context/ (runtime string scan)
 *
 * Environment: node (no DOM, no Svelte).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import {
  toChatRouteContextKey,
  upsertRouteContextEntry,
  selectActiveChatContexts,
} from '../src/context/context-entry.js';
import { createContextModule } from '../src/context/module.js';
import type { ContextHost } from '../src/context/module.js';
import type { ChatContextEntry } from '../src/state/chat-context.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a minimal fake ContextHost for testing. */
function makeFakeHost(
  labels: Record<string, string> = {},
  overrides: Partial<ContextHost> = {},
): ContextHost & { savedPrefs: unknown } {
  let savedPrefs: unknown = null;
  return {
    detectContext({ routeId, params }) {
      if (routeId === '/folder/[id]' && params['id']) {
        return { primaryContextType: 'folder', primaryContextId: params['id'] };
      }
      if (routeId === '/initiative/[id]' && params['id']) {
        return { primaryContextType: 'initiative', primaryContextId: params['id'] };
      }
      return null;
    },
    resolveContextLabel(type, id) {
      const key = `${type}:${id}`;
      return Promise.resolve(labels[key] ?? '');
    },
    iconFor(_type) { return null; },
    loadPrefs(_sessionId) { return null; },
    savePrefs(_sessionId, prefs) { savedPrefs = prefs; },
    get savedPrefs() { return savedPrefs; },
    ...overrides,
  } as ContextHost & { savedPrefs: unknown };
}

function collectStore(mod: ReturnType<typeof createContextModule>): ChatContextEntry[][] {
  const emissions: ChatContextEntry[][] = [];
  const unsub = mod.entries.subscribe((v) => emissions.push([...v]));
  // unsub called at end of test is intentional — vitest cleans up automatically.
  void unsub;
  return emissions;
}

// ---------------------------------------------------------------------------
// 1. toChatRouteContextKey
// ---------------------------------------------------------------------------

describe('toChatRouteContextKey', () => {
  it('returns null for null/undefined', () => {
    expect(toChatRouteContextKey(null)).toBeNull();
    expect(toChatRouteContextKey(undefined)).toBeNull();
  });

  it('returns null when id is missing', () => {
    expect(toChatRouteContextKey({ type: 'folder' })).toBeNull();
  });

  it('returns null when type is missing', () => {
    expect(toChatRouteContextKey({ id: 'abc' })).toBeNull();
  });

  it('returns type:id when both present', () => {
    expect(toChatRouteContextKey({ type: 'folder', id: 'f1' })).toBe('folder:f1');
  });

  it('works with any open string type', () => {
    expect(toChatRouteContextKey({ type: 'signal', id: 's99' })).toBe('signal:s99');
  });
});

// ---------------------------------------------------------------------------
// 2. upsertRouteContextEntry
// ---------------------------------------------------------------------------

describe('upsertRouteContextEntry', () => {
  const ISO = '2026-06-01T00:00:00.000Z';

  it('inserts a new entry when none exists', () => {
    const { entries, nextRouteKey, shouldLoadName } = upsertRouteContextEntry({
      entries: [],
      contextType: 'folder',
      contextId: 'f1',
      label: 'My Folder',
      previousRouteKey: null,
      nowIso: ISO,
      used: false,
    });
    expect(entries).toHaveLength(1);
    expect(entries[0].type).toBe('folder');
    expect(entries[0].id).toBe('f1');
    expect(entries[0].label).toBe('My Folder');
    expect(entries[0].active).toBe(true);
    expect(entries[0].used).toBe(false);
    expect(nextRouteKey).toBe('folder:f1');
    expect(shouldLoadName).toBe(false);
  });

  it('sets shouldLoadName=true when label equals contextId (fallback)', () => {
    const { shouldLoadName } = upsertRouteContextEntry({
      entries: [],
      contextType: 'folder',
      contextId: 'f1',
      label: '',
      previousRouteKey: null,
      nowIso: ISO,
      used: false,
    });
    expect(shouldLoadName).toBe(true);
  });

  it('updates an existing entry label + active', () => {
    const initial: ChatContextEntry[] = [
      { type: 'folder', id: 'f1', label: 'Old Name', active: false, used: true },
    ];
    const { entries } = upsertRouteContextEntry({
      entries: initial,
      contextType: 'folder',
      contextId: 'f1',
      label: 'New Name',
      previousRouteKey: null,
      nowIso: ISO,
      used: false,
    });
    expect(entries).toHaveLength(1);
    expect(entries[0].label).toBe('New Name');
    expect(entries[0].active).toBe(true);
    expect(entries[0].used).toBe(true); // unchanged (was true, used=false)
  });

  it('removes unused previous route entry on route change', () => {
    const initial: ChatContextEntry[] = [
      { type: 'folder', id: 'old', label: 'Old Folder', active: true, used: false },
    ];
    const { entries } = upsertRouteContextEntry({
      entries: initial,
      contextType: 'folder',
      contextId: 'new',
      label: 'New Folder',
      previousRouteKey: 'folder:old',
      nowIso: ISO,
      used: false,
    });
    // old (unused) entry removed, new entry added
    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe('new');
  });

  it('keeps used entry even when route changes', () => {
    const initial: ChatContextEntry[] = [
      { type: 'folder', id: 'old', label: 'Old Folder', active: true, used: true },
    ];
    const { entries } = upsertRouteContextEntry({
      entries: initial,
      contextType: 'folder',
      contextId: 'new',
      label: 'New Folder',
      previousRouteKey: 'folder:old',
      nowIso: ISO,
      used: false,
    });
    expect(entries).toHaveLength(2);
  });

  it('returns null nextRouteKey when contextType is null', () => {
    const { nextRouteKey } = upsertRouteContextEntry({
      entries: [],
      contextType: null,
      contextId: null,
      label: '',
      previousRouteKey: null,
      nowIso: ISO,
      used: false,
    });
    expect(nextRouteKey).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 3. selectActiveChatContexts
// ---------------------------------------------------------------------------

describe('selectActiveChatContexts', () => {
  it('returns only active+used entries', () => {
    const entries: ChatContextEntry[] = [
      { type: 'folder', id: 'f1', label: 'A', active: true, used: true, lastUsedAt: '2026-01-02T00:00:00.000Z' },
      { type: 'folder', id: 'f2', label: 'B', active: false, used: true },
      { type: 'folder', id: 'f3', label: 'C', active: true, used: false },
    ];
    const active = selectActiveChatContexts(entries);
    expect(active).toHaveLength(1);
    expect(active[0].id).toBe('f1');
  });

  it('sorts by lastUsedAt descending', () => {
    const entries: ChatContextEntry[] = [
      { type: 'folder', id: 'early', label: 'Early', active: true, used: true, lastUsedAt: '2026-01-01T00:00:00.000Z' },
