/**
 * Optional gating expression evaluated before a skill is exposed to an agent.
 *
 * All entries are AND-combined: a skill is available when the caller's
 * AuthzContext satisfies every populated dimension. An empty / omitted
 * `ContextFilter` means the skill is always available (subject to higher-level
 * marketplace overlay, when present).
 */
export interface ContextFilter {
  /**
   * Workspace types (e.g. 'ai-ideas', 'opportunity') for which the skill is
   * relevant. Empty / omitted = any workspace type.
   */
  readonly workspaceTypes?: ReadonlyArray<string>;
  /**
   * AuthzContext roles required for the skill to be exposed. Empty / omitted =
   * any role.
   */
  readonly roles?: ReadonlyArray<string>;
  /**
   * When true, the skill must not be exposed if the runtime is offline.
   * Defaults to false at parse time.
   */
  readonly requiresOnline?: boolean;
}
