/**
 * context-provider.test.ts — migrated from context-provider.ts (Lot 3)
 *
 * Tests the new context-adapter (app-side) + package helpers (neutral).
 * Old imports from $lib/chat/context-provider are replaced by:
 *   - detectChatRouteContext → $lib/chat/context-adapter
 *   - upsertRouteContextEntry, toChatRouteContextKey, selectActiveChatContexts → @sentropic/chat-ui/context
 */
import { describe, expect, it } from 'vitest';
import { detectChatRouteContext } from '$lib/chat/context-adapter';
import {
  toChatRouteContextKey,
  upsertRouteContextEntry,
  selectActiveChatContexts,
  type ChatContextEntry,
} from '@sentropic/chat-ui/context';

describe('chat context provider (migrated)', () => {
  it('detects route-backed chat context without reading Svelte stores', () => {
    expect(
      detectChatRouteContext({
        routeId: '/initiative/[id]',
        params: { id: 'uc_1' },
        currentFolderId: 'fld_current',
      }),
    ).toEqual({ primaryContextType: 'initiative', primaryContextId: 'uc_1' });

    expect(
      detectChatRouteContext({
        routeId: '/dashboard',
        params: {},
        currentFolderId: 'fld_current',
      }),
    ).toEqual({ primaryContextType: 'folder', primaryContextId: 'fld_current' });

    expect(
      detectChatRouteContext({
        routeId: '/organizations',
        params: {},
        currentFolderId: null,
      }),
    ).toEqual({ primaryContextType: 'organization' });

    expect(
      detectChatRouteContext({
        routeId: '/settings',
        params: {},
        currentFolderId: null,
      }),
    ).toBeNull();
  });

  it('upserts route entries and removes stale unused route context (neutral shape)', () => {
    const nowIso = new Date(30).toISOString();
    const entries: ChatContextEntry[] = [
      {
        type: 'folder',
        id: 'fld_old',
        label: 'Old folder',
        active: true,
        used: false,
        lastUsedAt: new Date(10).toISOString(),
      },
      {
        type: 'organization',
        id: 'org_used',
        label: 'Used org',
        active: true,
        used: true,
        lastUsedAt: new Date(20).toISOString(),
      },
    ];

    const result = upsertRouteContextEntry({
      entries,
      contextType: 'initiative',
      contextId: 'uc_1',
      label: 'Use case',
      previousRouteKey: 'folder:fld_old',
      nowIso,
      used: false,
    });

    expect(result.nextRouteKey).toBe('initiative:uc_1');
    expect(result.shouldLoadName).toBe(false);
    expect(result.entries).toEqual([
      {
        type: 'initiative',
        id: 'uc_1',
        label: 'Use case',
        active: true,
        used: false,
        lastUsedAt: undefined,
      },
      entries[1],
    ]);
  });

  it('marks active contexts as used and keeps them sorted by recent usage', () => {
    const now1 = new Date(100).toISOString();
    const now2 = new Date(200).toISOString();

    const entries = upsertRouteContextEntry({
      entries: [],
      contextType: 'folder',
      contextId: 'fld_1',
      label: 'fld_1',
      previousRouteKey: null,
      nowIso: now1,
      used: true,
    }).entries;

    expect(toChatRouteContextKey(entries[0])).toBe('folder:fld_1');
    expect(
      upsertRouteContextEntry({
        entries,
        contextType: 'folder',
        contextId: 'fld_1',
        label: 'Folder one',
        previousRouteKey: 'folder:fld_1',
        nowIso: now2,
        used: true,
      }),
    ).toMatchObject({
      shouldLoadName: false,
      entries: [
        {
          type: 'folder',
          id: 'fld_1',
          label: 'Folder one',
          active: true,
          used: true,
          lastUsedAt: now2,
        },
      ],
    });

    expect(
      selectActiveChatContexts([
        { ...entries[0], active: true, used: true, lastUsedAt: new Date(10).toISOString() },
        {
          type: 'initiative',
          id: 'uc_2',
          label: 'Second',
          active: true,
          used: true,
          lastUsedAt: new Date(30).toISOString(),
        },
        {
          type: 'organization',
          id: 'org_inactive',
          label: 'Inactive',
          active: false,
          used: true,
          lastUsedAt: new Date(40).toISOString(),
        },
      ]).map((entry) => entry.id),
    ).toEqual(['uc_2', 'fld_1']);
  });
});
