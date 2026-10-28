/**
 * BR14a Lot 5 — @sentropic/chat-ui/stores/localTools contract tests.
 *
 * These tests exercise the package-owned UI-generic core (definitions,
 * runtime detection, execute/permission/permission-policy flows) via
 * the injected `LocalToolsAdapter`, mirroring host behavior without
 * touching `globalThis.chrome`. Host-app coverage continues in
 * `ui/tests/stores/localTools.test.ts`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

import type { LocalToolsAdapter } from '../src/hosts/types.js';
import {
  BUILTIN_LOCAL_TOOL_NAMES,
  LocalToolPermissionRequiredError,
  clearRegisteredLocalTools,
  decideLocalToolPermission,
  deleteLocalToolPermissionPolicy,
  executeLocalTool,
  getLocalToolDefinitions,
  isLocalToolName,
  isLocalToolRuntimeAvailable,
  listLocalToolPermissionPolicies,
  listRegisteredLocalTools,
  localToolsStore,
  registerLocalTool,
  registerLocalTools,
  setLocalToolsAdapter,
  unregisterLocalTool,
  upsertLocalToolPermissionPolicy,
} from '../src/stores/localTools.js';

const RENDER_MERMAID = {
  name: 'render_mermaid',
  description: 'Render a Mermaid diagram in the host app.',
  parameters: {
    type: 'object',
    properties: { source: { type: 'string' } },
    required: ['source'],
  },
} as const;

const resetState = () => {
  localToolsStore.set({
    available: false,
    tools: getLocalToolDefinitions(),
    executions: {},
  });
