export type WorkspaceType = 'neutral' | 'ai-ideas' | 'opportunity' | 'code';

export type ChatToolScopeToggle = {
  id: string;
  toolIds: string[];
};

// Tool IDs available per workspace type (§14.2)
const EXTENDED_OBJECT_TOOL_IDS = new Set<string>([
  'solutions_list', 'solution_get', 'proposals_list', 'proposal_get',
  'products_list', 'product_get', 'gate_review',
  'document_generate', 'batch_create_organizations',
]);

const CROSS_WORKSPACE_TOOL_IDS = new Set<string>([
  'workspace_list', 'initiative_search', 'task_dispatch',
]);

const AI_IDEAS_TOOL_IDS = new Set<string>([
  'document_generate',
]);

const WORKSPACE_TYPE_TOOL_IDS: Record<WorkspaceType, ReadonlySet<string>> = {
  'ai-ideas': AI_IDEAS_TOOL_IDS,
  opportunity: EXTENDED_OBJECT_TOOL_IDS,
  code: new Set<string>(), // no extra tools
  neutral: CROSS_WORKSPACE_TOOL_IDS,
};

/** Returns the set of additional tool IDs allowed for a workspace type. */
export const getWorkspaceTypeToolIds = (wsType: WorkspaceType | null): ReadonlySet<string> =>
  wsType ? (WORKSPACE_TYPE_TOOL_IDS[wsType] ?? new Set()) : new Set();

/** All tool IDs that are workspace-type-specific (used for filtering). */
const ALL_WORKSPACE_TYPE_SPECIFIC_TOOL_IDS = new Set<string>([
  ...EXTENDED_OBJECT_TOOL_IDS,
  ...CROSS_WORKSPACE_TOOL_IDS,
  ...AI_IDEAS_TOOL_IDS,
]);

/**
 * Filter tool toggles based on workspace type.
 * Removes workspace-type-specific tools that don't belong to the current workspace type.
 */
export const filterToolTogglesByWorkspaceType = (
  toolToggles: ChatToolScopeToggle[],
  workspaceType: WorkspaceType | null,
): ChatToolScopeToggle[] => {
  const allowed = getWorkspaceTypeToolIds(workspaceType);
  return toolToggles.filter((toggle) => {
    // Keep toggle if none of its tools are workspace-type-specific
    const hasSpecificTool = toggle.toolIds.some((id) => ALL_WORKSPACE_TYPE_SPECIFIC_TOOL_IDS.has(id));
    if (!hasSpecificTool) return true;
    // Keep toggle if at least one of its tools is allowed for this workspace type
    return toggle.toolIds.some((id) => allowed.has(id) || !ALL_WORKSPACE_TYPE_SPECIFIC_TOOL_IDS.has(id));
  });
};

export const EXTENSION_NEW_SESSION_ALLOWED_TOOL_IDS = new Set<string>([
  'web_search',
  'web_extract',
  'tab_read',
  'tab_action',
]);

export const VSCODE_NEW_SESSION_ALLOWED_TOOL_IDS = new Set<string>([
  'plan',
  'bash',
  'ls',
  'rg',
  'file_read',
  'file_edit',
  'git',
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
