/**
 * @sentropic/flow — WorkflowStore port.
 *
 * Manages the catalog of workflow definitions for a workspace:
 * lookup, listing, upsert, fork, detach, reset, delete, and
 * workspace-type seeding.
 *
 * The interface is intentionally generic (`TActor`, `TWorkflow`,
 * `TUpsertItem`, `TForkInput`) so the package stays decoupled from
 * the app-specific Drizzle row types. Postgres adapters live in
 * `api/src/services/flow/postgres-workflow-store.ts`.
 *
 * Per spec/SPEC_EVOL_BR26_FLOW_FACADE.md §2.
 */

export interface WorkspaceTypeWorkflowEntry<TWorkflowDefinition = unknown> {
  workflow: TWorkflowDefinition;
  isDefault: boolean;
  triggerStage: string | null;
}

export interface WorkflowStore<
  TActor = unknown,
  TWorkflow = unknown,
  TUpsertItem = unknown,
  TForkInput = unknown,
  TWorkspaceType = unknown,
> {
  /** List all workflow configs visible to the actor's workspace. */
  list(actor: TActor): Promise<TWorkflow[]>;

  /** Upsert a batch of workflow configs into the actor's workspace. */
  upsertMany(actor: TActor, items: TUpsertItem[]): Promise<TWorkflow[]>;

  /**
   * Fork an existing workflow definition into the actor's workspace
   * (creating a workspace-level override of a system definition).
   */
  fork(actor: TActor, id: string, input: TForkInput): Promise<TWorkflow>;

  /** Detach a workflow definition from its lineage root. */
  detach(actor: TActor, id: string): Promise<TWorkflow>;

  /** Reset a workflow definition to its lineage root config. */
  reset(actor: TActor, id: string): Promise<TWorkflow>;

  /** Delete a workspace-level workflow definition. */
  delete(actor: TActor, id: string): Promise<void>;

  /**
   * Seed the workspace with the default workflow catalog for the given
   * workspace type. Idempotent. Takes the actor because the underlying
   * implementation needs the workspace + role context to upsert
   * workflow + agent definitions through the same authz path.
   */
  seedForWorkspaceType(actor: TActor, type: TWorkspaceType): Promise<void>;
}
