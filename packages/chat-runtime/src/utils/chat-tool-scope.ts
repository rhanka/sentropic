/**
 * chat-tool-scope.ts — Generic tool-scope pure functions.
 *
 * Domain-neutral: operates on {id, toolIds} toggle shapes only.
 * No Sentropic-specific tool IDs, workspace types, or extension runtime sets.
 *
 * Those app-specific values live in ui/src/lib/chat/tool-scope-adapter.ts (D7 split).
 */

export type ChatToolScopeToggle = {
  id: string;
  toolIds: string[];
};

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
  const defaults: Record<string, boolean> = {};
  for (const toggle of input.toolToggles) {
    const allowed = input.allowedToolIds ?? new Set<string>();
    defaults[toggle.id] = input.restrictedMode
      ? toggle.toolIds.some((id) => allowed.has(id))
