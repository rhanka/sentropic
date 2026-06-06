/**
 * tool-scope-adapter.ts — Sentropic app-side tool-scope catalog.
 *
 * Owns all domain-specific tool ID sets and workspace-type logic that
 * was previously in @sentropic/chat-ui/utils/chat-tool-scope.
 *
 * The package (chat-tool-scope.ts) retains only generic pure functions:
 *   computeEnabledToolIds, computeToolToggleDefaults, computeVisibleToolToggleIds,
 *   isExtensionRestrictedToolsetMode.
 *
 * D7 split: Sentropic tool IDs and workspace-type mapping stay app-side.
 */

import type { ChatToolScopeToggle } from '@sentropic/chat-ui/utils/chat-tool-scope';

// ---------------------------------------------------------------------------
// WorkspaceType (Sentropic domain — stays app-side after D7)
// ---------------------------------------------------------------------------

export type WorkspaceType = 'neutral' | 'ai-priorities' | 'opportunity' | 'code';

// ---------------------------------------------------------------------------
// Tool IDs available per workspace type (§14.2)
// ---------------------------------------------------------------------------

const EXTENDED_OBJECT_TOOL_IDS = new Set<string>([
  'solutions_list', 'solution_get', 'proposals_list', 'proposal_get',
  'products_list', 'product_get', 'gate_review',
  'document_generate', 'batch_create_organizations',
]);

const CROSS_WORKSPACE_TOOL_IDS = new Set<string>([
  'workspace_list', 'initiative_search', 'task_dispatch',
]);

const AI_PRIORITIES_TOOL_IDS = new Set<string>([
  'document_generate',
]);

const WORKSPACE_TYPE_TOOL_IDS: Record<WorkspaceType, ReadonlySet<string>> = {
  'ai-priorities': AI_PRIORITIES_TOOL_IDS,
  opportunity: EXTENDED_OBJECT_TOOL_IDS,
  code: new Set<string>(),
  neutral: CROSS_WORKSPACE_TOOL_IDS,
};

/** Returns the set of additional tool IDs allowed for a workspace type. */
export const getWorkspaceTypeToolIds = (wsType: WorkspaceType | null): ReadonlySet<string> =>
  wsType ? (WORKSPACE_TYPE_TOOL_IDS[wsType] ?? new Set()) : new Set();

/** All tool IDs that are workspace-type-specific (used for filtering). */
const ALL_WORKSPACE_TYPE_SPECIFIC_TOOL_IDS = new Set<string>([
  ...EXTENDED_OBJECT_TOOL_IDS,
  ...CROSS_WORKSPACE_TOOL_IDS,
  ...AI_PRIORITIES_TOOL_IDS,
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
    const hasSpecificTool = toggle.toolIds.some((id) => ALL_WORKSPACE_TYPE_SPECIFIC_TOOL_IDS.has(id));
    if (!hasSpecificTool) return true;
    return toggle.toolIds.some((id) => allowed.has(id) || !ALL_WORKSPACE_TYPE_SPECIFIC_TOOL_IDS.has(id));
  });
};

// ---------------------------------------------------------------------------
// Extension / VSCode allowed tool IDs (Sentropic runtime — app-side)
// ---------------------------------------------------------------------------

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
