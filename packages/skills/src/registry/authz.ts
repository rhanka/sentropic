/**
 * Authorization context types declared LOCALLY in `@sentropic/skills`.
 *
 * Per BR19-N1 (BRANCH.md Feedback Loop), `@sentropic/contracts` does not yet
 * exist on this branch baseline. The shapes below mirror the planned contract
 * surface that BR-14b/BR-26 will lift into `@sentropic/contracts`. When that
 * package lands, this file becomes a thin re-export and the structural
 * compatibility is preserved (no runtime churn for downstream consumers).
 *
 * Design constraints frozen in SPEC_EVOL_BR19 §3:
 *   - `roles` and `workspaceTypes` mirror `ContextFilter` for AND-combined
 *     filtering inside `resolveTools()`.
 *   - `permissionMode` distinguishes 'allowlist' (only `allowedTools` are
 *     callable) from 'open' (any catalog tool is callable subject to
 *     contextFilter / authzRequirements).
 *   - `allowedTools` is consulted only in 'allowlist' mode.
 */

/**
 * Per-tenant context (workspace, organisation, …). Kept narrow on purpose;
 * concrete adapters extend it without breaking structural compatibility.
 */
export interface TenantContext {
  /** Tenant / workspace id. Required for audit; not used for authz directly. */
  readonly tenantId: string;
  /**
   * Workspace type (e.g. 'ai-ideas', 'opportunity'). Drives
   * `ContextFilter.workspaceTypes` matching.
   */
  readonly workspaceType?: string;
}

/**
 * Permission mode applied by `resolveTools()`:
 *   - 'allowlist': only tools whose name is in `allowedTools` are exposed.
 *   - 'open': all catalog tools matching `ContextFilter` are exposed
 *     (subject to `authzRequirements.permissions` if declared).
 */
export type PermissionMode = 'allowlist' | 'open';

/**
 * Caller authorisation context. Combined with the per-skill `ContextFilter`
 * and `SkillAuthzRequirements` to decide which tools are exposed.
 */
export interface AuthzContext {
  readonly tenant: TenantContext;
  /** Caller roles (e.g. 'admin', 'editor'). */
  readonly roles: ReadonlyArray<string>;
  /**
   * Permission slugs granted to the caller (matched against
   * `SkillAuthzRequirements.permissions`).
   */
  readonly permissions: ReadonlyArray<string>;
  /** Determines how `allowedTools` is interpreted. */
  readonly permissionMode: PermissionMode;
  /**
   * Tool names the caller may invoke when `permissionMode === 'allowlist'`.
   * Ignored in 'open' mode.
   */
  readonly allowedTools: ReadonlyArray<string>;
}

/**
 * Tool descriptor returned by `SkillsToolRegistry.resolveTools(authz)`.
 * Mirrors the planned `@sentropic/contracts` `ResolvedTool` shape:
 * the LLM-callable surface plus the back-pointer to the owning skill so the
 * dispatcher can locate the handler / sandbox entry.
 */
export interface ResolvedTool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
  readonly outputSchema?: Record<string, unknown>;
  /** Owning skill name; used by chat-core to dispatch back to the skill. */
  readonly skillName: string;
  /** Mirrors `SkillTool.sideEffect`. */
  readonly sideEffect?: boolean;
  /** Mirrors `SkillTool.requiresApproval`. */
  readonly requiresApproval?: boolean;
}

/**
 * Minimal `ToolRegistry` shape. Mirrors the planned `@sentropic/contracts`
 * surface so `chat-core` can later swap the local interface for the canonical
 * one without API change. Adapters must produce the same `ResolvedTool[]`
 * regardless of the underlying source (skills, MCP server, hand-rolled).
 */
export interface ToolRegistry {
  resolveTools(
    authz: AuthzContext,
    options?: { skillName?: string },
  ): ReadonlyArray<ResolvedTool>;
}
