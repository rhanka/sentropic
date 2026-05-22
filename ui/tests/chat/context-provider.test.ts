import { describe, expect, it } from 'vitest';
import {
  detectChatRouteContext,
  selectActiveChatContexts,
  toChatRouteContextKey,
  upsertRouteContextEntry,
  type ChatContextEntry,
} from '$lib/chat/context-provider';

describe('chat context provider', () => {
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

  it('upserts route entries and removes stale unused route context', () => {
    const entries: ChatContextEntry[] = [
      {
        contextType: 'folder',
        contextId: 'fld_old',
        label: 'Old folder',
        active: true,
        used: false,
        lastUsedAt: 10,
      },
      {
        contextType: 'organization',
        contextId: 'org_used',
        label: 'Used org',
        active: true,
        used: true,
        lastUsedAt: 20,
      },
    ];

    const result = upsertRouteContextEntry({
      entries,
      context: { primaryContextType: 'initiative', primaryContextId: 'uc_1' },
      label: 'Use case',
      previousRouteKey: 'folder:fld_old',
      now: 30,
      used: false,
    });

    expect(result.nextRouteKey).toBe('initiative:uc_1');
    expect(result.shouldLoadName).toBe(false);
    expect(result.entries).toEqual([
      {
        contextType: 'initiative',
        contextId: 'uc_1',
        label: 'Use case',
        active: true,
        used: false,
        lastUsedAt: 30,
      },
      entries[1],
    ]);
  });

  it('marks active contexts as used and keeps them sorted by recent usage', () => {
    const entries = upsertRouteContextEntry({
      entries: [],
      context: { primaryContextType: 'folder', primaryContextId: 'fld_1' },
      label: 'fld_1',
      previousRouteKey: null,
      now: 100,
      used: true,
    }).entries;

    expect(toChatRouteContextKey(entries[0])).toBe('folder:fld_1');
    expect(
      upsertRouteContextEntry({
        entries,
        context: { primaryContextType: 'folder', primaryContextId: 'fld_1' },
        label: 'Folder one',
        previousRouteKey: 'folder:fld_1',
        now: 200,
        used: true,
      }),
    ).toMatchObject({
      shouldLoadName: false,
      entries: [
        {
          contextType: 'folder',
          contextId: 'fld_1',
          label: 'Folder one',
          active: true,
          used: true,
          lastUsedAt: 200,
        },
      ],
    });

    expect(
      selectActiveChatContexts([
        { ...entries[0], active: true, used: true, lastUsedAt: 10 },
        {
          contextType: 'initiative',
          contextId: 'uc_2',
          label: 'Second',
          active: true,
          used: true,
          lastUsedAt: 30,
        },
        {
          contextType: 'organization',
          contextId: 'org_inactive',
          label: 'Inactive',
          active: false,
          used: true,
          lastUsedAt: 40,
        },
      ]).map((entry) => entry.contextId),
    ).toEqual(['uc_2', 'fld_1']);
  });
});
