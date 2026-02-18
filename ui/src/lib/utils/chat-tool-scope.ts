export type ChatToolScopeToggle = {
  id: string;
  toolIds: string[];
};

export const EXTENSION_NEW_SESSION_ALLOWED_TOOL_IDS = new Set<string>([
  'web_search',
  'web_extract',
]);

export const isExtensionRestrictedToolsetMode = (input: {
  mode: 'ai' | 'comments';
  hasExtensionRuntime: boolean;
  sessionId: string | null;
  extensionRestrictedToolset: boolean;
}): boolean =>
  input.mode === 'ai' &&
  input.hasExtensionRuntime &&
  (!input.sessionId || input.extensionRestrictedToolset);

export const computeToolToggleDefaults = (input: {
  toolToggles: ChatToolScopeToggle[];
  restrictedMode: boolean;
  allowedToolIds?: ReadonlySet<string>;
}): Record<string, boolean> => {
  const allowedToolIds =
    input.allowedToolIds ?? EXTENSION_NEW_SESSION_ALLOWED_TOOL_IDS;
  const defaults: Record<string, boolean> = {};
  for (const toggle of input.toolToggles) {
    defaults[toggle.id] = input.restrictedMode
      ? toggle.toolIds.some((id) => allowedToolIds.has(id))
      : true;
  }
  return defaults;
};

export const computeVisibleToolToggleIds = (input: {
  toolToggles: ChatToolScopeToggle[];
  restrictedMode: boolean;
  allowedToolIds?: ReadonlySet<string>;
}): string[] => {
  const allowedToolIds =
    input.allowedToolIds ?? EXTENSION_NEW_SESSION_ALLOWED_TOOL_IDS;
  if (!input.restrictedMode) {
    return input.toolToggles.map((toggle) => toggle.id);
  }
  return input.toolToggles
    .filter((toggle) => toggle.toolIds.some((id) => allowedToolIds.has(id)))
    .map((toggle) => toggle.id);
};

export const computeEnabledToolIds = (input: {
  toolToggles: ChatToolScopeToggle[];
  toolEnabledById: Record<string, boolean>;
  restrictedMode: boolean;
  allowedToolIds?: ReadonlySet<string>;
}): string[] => {
  const allowedToolIds =
    input.allowedToolIds ?? EXTENSION_NEW_SESSION_ALLOWED_TOOL_IDS;
  const enabled = new Set<string>();
  for (const toggle of input.toolToggles) {
    if (input.toolEnabledById[toggle.id] !== false) {
      toggle.toolIds.forEach((id) => enabled.add(id));
    }
  }
  const ids = Array.from(enabled);
  if (!input.restrictedMode) return ids;
  return ids.filter((id) => allowedToolIds.has(id));
};
