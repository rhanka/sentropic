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
