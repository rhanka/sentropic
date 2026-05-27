/**
 * Portable tool-permission schema. Host-agnostic types extracted from the
 * Chrome extension's `tool-permissions.ts`; persistence and backend sync stay
 * host-side.
 */

export type ToolPermissionPolicy = 'allow' | 'deny';

export type ToolPermissionDecision =
    | 'allow_once'
    | 'deny_once'
    | 'allow_always'
    | 'deny_always';

export type ToolPermissionEntry = {
    toolName: string;
    origin: string;
    policy: ToolPermissionPolicy;
    updatedAt: string;
};

export type ToolPermissionRequest = {
    requestId: string;
    toolName: string;
    origin: string;
    tabId?: number;
    tabUrl?: string;
    tabTitle?: string;
    details?: Record<string, unknown>;
};
