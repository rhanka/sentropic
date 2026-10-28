/**
 * BR14a Lot 5 — @sentropic/chat-ui local tools store.
 *
 * UI-generic core for local-tool availability, definitions, executions,
 * permission prompts, and policy operations. Host-specific transport is
 * supplied through a `LocalToolsAdapter` (see `../hosts/types.ts`).
 *
 * Default adapter reads `globalThis.chrome.runtime`, which is satisfied
 * by:
 * - Chrome extension content/side-panel context (native).
 * - VSCode webview context (`installExtensionRuntimeShim` in
 *   `ui/vscode-ext/webview-entry.ts` installs a `chrome.runtime` shim
 *   bridging messages through the host).
 *
 * Hosts that cannot rely on `globalThis.chrome` (tests, future embedded
 * hosts) may inject their own adapter via `setLocalToolsAdapter`.
 *
 * Public re-exports (BR14a Lot 5):
 * - `LocalToolName`, `LocalToolDefinition`, `LocalToolExecution`,
 *   `LocalToolExecutionStatus`, `LocalToolPermissionPolicy`,
 *   `LocalToolPermissionDecision`, `LocalToolPermissionRequest`,
 *   `LocalToolPermissionPolicyEntry`.
 * - `localToolsStore`, `getLocalToolDefinitions`,
 *   `isLocalToolName`, `isLocalToolRuntimeAvailable`.
 * - `executeLocalTool`, `decideLocalToolPermission`,
 *   `listLocalToolPermissionPolicies`, `upsertLocalToolPermissionPolicy`,
 *   `deleteLocalToolPermissionPolicy`.
 * - `LocalToolPermissionRequiredError`, `setLocalToolsAdapter`.
 *
 * Host-extensible registration (open local-tool seam):
 * - `BUILTIN_LOCAL_TOOL_NAMES` — the closed set of sentropic-shipped tool names.
 * - `registerLocalTool`, `registerLocalTools`, `unregisterLocalTool`,
 *   `clearRegisteredLocalTools`, `listRegisteredLocalTools` — let an external
 *   host (Diag, OpenERP, mermaid-editor) register its own tool name + definition
 *   so `isLocalToolName` recognizes it and `getLocalToolDefinitions` advertises
 *   it, without editing this package's enum. The executor stays host-injected
 *   through `attachLocalToolMachine` / `setLocalToolsAdapter`.
 */
import { writable } from 'svelte/store';

import type { LocalToolsAdapter } from '@sentropic/chat-runtime/hosts/types';

/**
 * Closed set of local tool names shipped by sentropic (Chrome tab tools +
 * VSCode workspace tools). External hosts widen the recognized set at runtime
 * via `registerLocalTool` — they do NOT edit this list.
 */
export const BUILTIN_LOCAL_TOOL_NAMES = [
  'tab_read',
  'tab_action',
  'tab_read_dom',
  'tab_screenshot',
  'tab_click',
  'tab_type',
  'tab_scroll',
  'tab_info',
  'bash',
  'ls',
  'rg',
  'file_read',
