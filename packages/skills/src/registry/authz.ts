/**
 * Authorization context types exposed by `@sentropic/skills`.
 *
 * BR19-N1 initially expected these to become direct `@sentropic/contracts`
 * re-exports. The contract package now exists, but its `AuthzContext` is the
 * transverse caller/tool-allowance envelope used by chat-core. Skills still
 * needs local roles, permissions, and workspace type filters for catalog
 * resolution. Keep the existing skills API stable and provide an explicit
 * adapter from the contract shape instead of aliasing incompatible types.
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
 * Exact transverse tenant context shape currently exported by
 * `@sentropic/contracts`. Declared structurally here to avoid coupling the
 * package typecheck target to a built `packages/contracts/dist` artifact.
 */
export interface ContractTenantContext {
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly userId: string;
  readonly sessionId?: string;
  readonly runId?: string;
}

/**
 * Exact transverse permission mode shape currently exported by
 * `@sentropic/contracts`.
 */
export type ContractPermissionMode =
  | 'untrusted'
  | 'on-request'
  | 'on-failure'
  | 'never'
  | 'granular';

/**
 * Exact transverse authz context shape currently exported by
 * `@sentropic/contracts`.
 */
export interface ContractAuthzContext {
  readonly caller: ContractTenantContext;
  readonly allowedTools: ReadonlySet<string>;
  readonly permissionMode: ContractPermissionMode;
}

/**
 * Per-tenant context (workspace, organisation, ...). Kept compatible with the
 * contract tenant context while preserving the BR19 `workspaceType` filter.
 */
export interface TenantContext extends Partial<ContractTenantContext> {
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

export interface ContractAuthzAdapterOptions {
  readonly workspaceType?: string;
  readonly roles?: ReadonlyArray<string>;
  readonly permissions?: ReadonlyArray<string>;
  /**
   * Override the skills exposure mode when the caller already made a
   * marketplace/governance decision outside `@sentropic/skills`.
   */
  readonly permissionMode?: PermissionMode;
}

function defaultSkillsPermissionMode(authz: ContractAuthzContext): PermissionMode {
  if (authz.permissionMode === 'granular' || authz.permissionMode === 'untrusted') {
    return 'allowlist';
  }
  if (authz.allowedTools.size > 0) {
    return 'allowlist';
  }
  return 'open';
}

/**
 * Convert the transverse `@sentropic/contracts` authz envelope into the richer
 * catalog-filtering context consumed by `@sentropic/skills`.
 */
export function authzContextFromContract(
  authz: ContractAuthzContext,
  options: ContractAuthzAdapterOptions = {},
): AuthzContext {
  return {
    tenant: {
      ...authz.caller,
      workspaceType: options.workspaceType,
    },
    roles: options.roles ?? [],
    permissions: options.permissions ?? [],
    permissionMode: options.permissionMode ?? defaultSkillsPermissionMode(authz),
    allowedTools: Array.from(authz.allowedTools),
  };
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
