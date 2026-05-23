export type ChatContextType =
  | 'organization'
  | 'folder'
  | 'initiative'
  | 'executive_summary';

export type ChatRouteContext = {
  primaryContextType: ChatContextType;
  primaryContextId?: string;
};

export type ChatContextEntry = {
  contextType: ChatContextType;
  contextId?: string;
  label: string;
  active: boolean;
  used: boolean;
  lastUsedAt: number;
};

type RouteParams = Record<string, string | undefined>;

export const detectChatRouteContext = (input: {
  routeId: string | null | undefined;
  params: RouteParams;
  currentFolderId: string | null | undefined;
}): ChatRouteContext | null => {
  const routeId = input.routeId ?? '';
  const id = input.params.id;

  if (routeId === '/initiative/[id]' && id) {
    return { primaryContextType: 'initiative', primaryContextId: id };
  }

  if (
    (routeId === '/initiative' ||
      routeId === '/dashboard' ||
      routeId === '/matrix') &&
    input.currentFolderId
  ) {
    return {
      primaryContextType: 'folder',
      primaryContextId: input.currentFolderId,
    };
  }

  if (routeId === '/folders/[id]' && id) {
    return { primaryContextType: 'folder', primaryContextId: id };
  }

  if (routeId === '/organizations/[id]' && id) {
    return { primaryContextType: 'organization', primaryContextId: id };
  }

  if (routeId === '/organizations') {
    return { primaryContextType: 'organization' };
  }

  if (routeId === '/folders') {
    return { primaryContextType: 'folder' };
  }

  return null;
};

export const toChatRouteContextKey = (
  entry: ChatContextEntry | ChatRouteContext | null | undefined,
): string | null => {
  if (!entry) return null;
  const contextType =
    'primaryContextType' in entry ? entry.primaryContextType : entry.contextType;
  const contextId =
    'primaryContextType' in entry ? entry.primaryContextId : entry.contextId;
  return contextType && contextId ? `${contextType}:${contextId}` : null;
};

export const upsertRouteContextEntry = (input: {
  entries: readonly ChatContextEntry[];
  context: ChatRouteContext | null;
  label: string;
  previousRouteKey: string | null;
  now: number;
  used: boolean;
}): {
  entries: ChatContextEntry[];
  nextRouteKey: string | null;
  shouldLoadName: boolean;
} => {
  const nextRouteKey = toChatRouteContextKey(input.context);
  let entries = [...input.entries];

  if (input.previousRouteKey && input.previousRouteKey !== nextRouteKey) {
    entries = entries.filter(
      (entry) =>
        !(toChatRouteContextKey(entry) === input.previousRouteKey && !entry.used),
    );
  }

  const contextType = input.context?.primaryContextType;
  const contextId = input.context?.primaryContextId;
  if (!contextType || !contextId) {
    return { entries, nextRouteKey, shouldLoadName: false };
  }

  const index = entries.findIndex(
    (entry) =>
      entry.contextType === contextType && entry.contextId === contextId,
  );
  const label = input.label || contextId;

  if (index === -1) {
    entries = [
      {
        contextType,
        contextId,
        label,
        active: true,
        used: input.used,
        lastUsedAt: input.now,
      },
      ...entries,
    ];
  } else {
    entries = [...entries];
    const current = entries[index];
    entries[index] = {
      ...current,
      label,
      active: true,
      used: input.used ? true : current.used,
      lastUsedAt: input.used ? input.now : current.lastUsedAt,
    };
  }

  return {
    entries,
    nextRouteKey,
    shouldLoadName: label === contextId,
  };
};

export const selectActiveChatContexts = (
  entries: readonly ChatContextEntry[],
): ChatContextEntry[] =>
  entries
    .filter((entry) => entry.active && entry.used)
    .sort((left, right) => right.lastUsedAt - left.lastUsedAt);
