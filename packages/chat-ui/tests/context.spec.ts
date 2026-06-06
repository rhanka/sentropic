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
      { type: 'folder', id: 'late', label: 'Late', active: true, used: true, lastUsedAt: '2026-06-01T00:00:00.000Z' },
    ];
    const active = selectActiveChatContexts(entries);
    expect(active[0].id).toBe('late');
    expect(active[1].id).toBe('early');
  });
});

// ---------------------------------------------------------------------------
// 4. createContextModule — updateFromRoute → label-resolve → store-update
// ---------------------------------------------------------------------------

describe('createContextModule — updateFromRoute', () => {
  it('detects route context and inserts entry into store', () => {
    const host = makeFakeHost({ 'folder:f1': 'My Folder' });
    const mod = createContextModule(host);
    const emissions = collectStore(mod);

    mod.updateFromRoute({ routeId: '/folder/[id]', params: { id: 'f1' } });

    const last = emissions[emissions.length - 1];
    expect(last).toHaveLength(1);
    expect(last[0].type).toBe('folder');
    expect(last[0].id).toBe('f1');
    expect(last[0].active).toBe(true);
  });

  it('resolves label async and patches store', async () => {
    const host = makeFakeHost({ 'folder:f1': 'Resolved Folder' });
    const mod = createContextModule(host);
    const emissions = collectStore(mod);

    // Label starts as fallback (id) because resolveContextLabel is async
    mod.updateFromRoute({ routeId: '/folder/[id]', params: { id: 'f1' } });

    // Wait for async label resolution
    await new Promise((r) => setTimeout(r, 10));

    const last = emissions[emissions.length - 1];
    expect(last[0].label).toBe('Resolved Folder');
  });

  it('emits empty store initially', () => {
    const host = makeFakeHost();
    const mod = createContextModule(host);
    const emissions: ChatContextEntry[][] = [];
    mod.entries.subscribe((v) => emissions.push([...v]));
    expect(emissions[0]).toHaveLength(0);
  });

  it('does not add entry for null route context', () => {
    const host = makeFakeHost();
    const mod = createContextModule(host);
    const emissions = collectStore(mod);

    mod.updateFromRoute({ routeId: '/dashboard', params: {} });

    expect(emissions[emissions.length - 1]).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 5. createContextModule — toggleActive
// ---------------------------------------------------------------------------

describe('createContextModule — toggleActive', () => {
  it('flips active state of matching entry', () => {
    const host = makeFakeHost();
    const mod = createContextModule(host);
    const emissions = collectStore(mod);

    mod.updateFromRoute({ routeId: '/folder/[id]', params: { id: 'f1' } });
    const before = emissions[emissions.length - 1][0];
    expect(before.active).toBe(true);

    mod.toggleActive('folder', 'f1');
    const after = emissions[emissions.length - 1][0];
    expect(after.active).toBe(false);
  });

  it('toggling inactive→active sets lastUsedAt', () => {
    const host = makeFakeHost();
    const mod = createContextModule(host);
    collectStore(mod);

    mod.updateFromRoute({ routeId: '/folder/[id]', params: { id: 'f1' } });
    mod.toggleActive('folder', 'f1'); // now inactive
    mod.toggleActive('folder', 'f1'); // back to active — should set lastUsedAt

    let current: ChatContextEntry[] = [];
    mod.entries.subscribe((v) => { current = v; })();
    expect(current[0].active).toBe(true);
    expect(current[0].lastUsedAt).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// 6. createContextModule — markUsed
// ---------------------------------------------------------------------------

describe('createContextModule — markUsed', () => {
  it('marks entry as used and sets lastUsedAt', () => {
    const host = makeFakeHost();
    const mod = createContextModule(host);
    collectStore(mod);

    mod.updateFromRoute({ routeId: '/folder/[id]', params: { id: 'f1' } });
    mod.markUsed({ routeId: '/folder/[id]', params: { id: 'f1' } });

    let current: ChatContextEntry[] = [];
    mod.entries.subscribe((v) => { current = v; })();
    expect(current[0].used).toBe(true);
    expect(current[0].lastUsedAt).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// 7. CRITICAL — prefs-migration test (data-loss prevention)
//
// Legacy localStorage entries use:
//   - lastUsedAt: number (epoch-ms) instead of ISO-8601 string
//   - contextType/contextId field names instead of type/id
//   - "usecase" type instead of "initiative"
//
// The context-adapter.ts (app side) handles contextType→type and
// usecase→initiative migrations. The module.ts loadPrefs handles
// any remaining shape by treating the incoming data as pre-normalized
// (it expects type/id/lastUsedAt:string per ChatContextEntry).
//
// This test proves that when context-adapter.ts normalizes legacy prefs
// (epoch-ms→ISO, usecase→initiative, contextType→type) before calling
// module.loadPrefs, the module loads correctly without data loss.
// ---------------------------------------------------------------------------

describe('CRITICAL: prefs migration — legacy epoch-ms + usecase→initiative', () => {
  /**
   * Simulates what context-adapter.ts must do:
   * normalize legacy stored entries before feeding to module.loadPrefs.
   */
  function normalizeLegacyContextEntry(raw: Record<string, unknown>): Record<string, unknown> {
    // Field rename: contextType→type, contextId→id
    const type = String(raw['contextType'] ?? raw['type'] ?? '');
    const id = raw['contextId'] != null ? String(raw['contextId']) : raw['id'] != null ? String(raw['id']) : undefined;
    // Type migration: "usecase" → "initiative"
    const normalizedType = type === 'usecase' ? 'initiative' : type;
    // lastUsedAt: number (epoch-ms) → ISO-8601 string
    let lastUsedAt: string | undefined;
    const rawLastUsed = raw['lastUsedAt'];
    if (typeof rawLastUsed === 'number' && rawLastUsed > 0) {
      lastUsedAt = new Date(rawLastUsed).toISOString();
    } else if (typeof rawLastUsed === 'string') {
      lastUsedAt = rawLastUsed;
    }
    return {
      type: normalizedType,
      id,
      label: String(raw['label'] ?? ''),
      active: typeof raw['active'] === 'boolean' ? raw['active'] : true,
      used: typeof raw['used'] === 'boolean' ? raw['used'] : true,
      lastUsedAt,
    };
  }

  it('loads normalized legacy prefs without data loss', () => {
    // Simulate stored legacy prefs from old AppChatPanel format
    const LEGACY_EPOCH_MS = 1748822400000; // 2026-06-02T00:00:00.000Z
    const legacyRaw = {
      contexts: [
        // Legacy: contextType/contextId, lastUsedAt as number, type "usecase"
        {
          contextType: 'usecase',
          contextId: 'uc-123',
          label: 'Q1 Growth Initiative',
          active: true,
          used: true,
          lastUsedAt: LEGACY_EPOCH_MS,
        },
        // Legacy: folder, epoch-ms
        {
          contextType: 'folder',
          contextId: 'f-456',
          label: 'Operations',
          active: false,
          used: true,
          lastUsedAt: 1748736000000,
        },
      ],
      toolEnabledById: { documents: true },
      extensionRestrictedToolset: false,
    };

    // Adapter normalizes
    const normalized = {
      contexts: legacyRaw.contexts.map(normalizeLegacyContextEntry),
      toolEnabledById: legacyRaw.toolEnabledById,
      extensionRestrictedToolset: legacyRaw.extensionRestrictedToolset,
    };

    // Module receives normalized data via host.loadPrefs
    const host = makeFakeHost({}, {
      loadPrefs(_sessionId: string | null) { return normalized; },
    });
    const mod = createContextModule(host);
    mod.loadPrefs('session-1');

    let current: ChatContextEntry[] = [];
    mod.entries.subscribe((v) => { current = v; })();

    // Verify: two entries loaded
    expect(current).toHaveLength(2);

    // Entry 1: usecase→initiative migration
    const initiative = current.find((e) => e.id === 'uc-123');
    expect(initiative).toBeDefined();
    expect(initiative!.type).toBe('initiative');
    expect(initiative!.label).toBe('Q1 Growth Initiative');
    expect(initiative!.active).toBe(true);
    expect(initiative!.used).toBe(true);
    // lastUsedAt must be ISO-8601 string parseable back to original epoch
    expect(typeof initiative!.lastUsedAt).toBe('string');
    expect(new Date(initiative!.lastUsedAt!).getTime()).toBe(LEGACY_EPOCH_MS);

    // Entry 2: folder entry preserved
    const folder = current.find((e) => e.id === 'f-456');
    expect(folder).toBeDefined();
    expect(folder!.type).toBe('folder');
    expect(folder!.active).toBe(false);
    expect(folder!.used).toBe(true);
    expect(typeof folder!.lastUsedAt).toBe('string');
    expect(new Date(folder!.lastUsedAt!).getTime()).toBe(1748736000000);
  });

  it('handles empty contexts array without error', () => {
    const host = makeFakeHost({}, {
      loadPrefs(_sessionId: string | null) {
        return { contexts: [], toolEnabledById: {} };
      },
    });
    const mod = createContextModule(host);
    mod.loadPrefs('session-2');

    let current: ChatContextEntry[] = [];
    mod.entries.subscribe((v) => { current = v; })();
    expect(current).toHaveLength(0);
  });

  it('handles null loadPrefs without error', () => {
    const host = makeFakeHost();
    const mod = createContextModule(host);
    expect(() => mod.loadPrefs(null)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 8. savePrefs — merges contexts into prefs object
// ---------------------------------------------------------------------------

describe('createContextModule — savePrefs', () => {
  it('includes current entries in saved prefs', () => {
    const host = makeFakeHost();
    const mod = createContextModule(host);

    mod.updateFromRoute({ routeId: '/folder/[id]', params: { id: 'f1' } });
    mod.savePrefs('session-1', { toolEnabledById: { documents: true } });

    const saved = host.savedPrefs as Record<string, unknown>;
    expect(saved).toBeDefined();
    const contexts = saved['contexts'] as ChatContextEntry[];
    expect(contexts).toHaveLength(1);
    expect(contexts[0].type).toBe('folder');
    expect(contexts[0].id).toBe('f1');
    expect(saved['toolEnabledById']).toEqual({ documents: true });
  });
});

// ---------------------------------------------------------------------------
// 9. Zero sentropic domain strings in src/context/
// ---------------------------------------------------------------------------

describe('domain neutrality: zero sentropic domain strings in src/context/', () => {
  const contextDir = path.resolve(process.cwd(), 'src', 'context');
  const DOMAIN_STRINGS = [
    'organization',
    'folder',
    'initiative',
    'usecase',
    'executive_summary',
  ];

  it('src/context/ directory exists', () => {
    expect(fs.existsSync(contextDir)).toBe(true);
  });

  for (const term of DOMAIN_STRINGS) {
    it(`no "${term}" literal in src/context/ source files`, () => {
      const files = fs.readdirSync(contextDir).filter((f) => f.endsWith('.ts'));
      for (const file of files) {
        const content = fs.readFileSync(path.join(contextDir, file), 'utf8');
        // Allow in comments only — check non-comment lines
        const codeLines = content
          .split('\n')
          .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'));
        const codeContent = codeLines.join('\n');
        expect(codeContent, `"${term}" found in ${file} (code, not comment)`).not.toContain(term);
      }
    });
  }
});

// ---------------------------------------------------------------------------
// 10. index barrel re-exports
// ---------------------------------------------------------------------------

describe('context/index.ts re-exports', () => {
  it('exports createContextModule', async () => {
    const mod = await import('../src/context/index.js');
    expect(typeof mod.createContextModule).toBe('function');
  });

  it('exports toChatRouteContextKey', async () => {
    const mod = await import('../src/context/index.js');
    expect(typeof mod.toChatRouteContextKey).toBe('function');
  });

  it('exports upsertRouteContextEntry', async () => {
    const mod = await import('../src/context/index.js');
    expect(typeof mod.upsertRouteContextEntry).toBe('function');
  });

  it('exports selectActiveChatContexts', async () => {
    const mod = await import('../src/context/index.js');
    expect(typeof mod.selectActiveChatContexts).toBe('function');
  });

  it('exports createNoopChatContextProvider', async () => {
    const mod = await import('../src/context/index.js');
    expect(typeof mod.createNoopChatContextProvider).toBe('function');
  });
});
