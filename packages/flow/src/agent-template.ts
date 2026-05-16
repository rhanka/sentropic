/**
 * @sentropic/flow — AgentTemplate port.
 *
 * Single boundary for resolving an agent definition into a concrete
 * runtime config: renders `promptTemplate` with `{{placeholder}}`,
 * applies `agentSelection` rules (`defaultAgentKey` + conditional
 * `rules[]`), and overlays skill-supplied instructions/tools.
 *
 * SPEC_STUDY_ARCHITECTURE_BOUNDARIES §14 invariant: same
 * `agentId + state` MUST yield the same `ResolvedAgentConfig` before
 * and after each extraction slice.
 *
 * BR26-Q2: `resolve()` accepts an optional `authz` param even though
 * unused by the Postgres adapter, to lock the contract before
 * `@sentropic/skills` lands.
 *
 * Per spec/SPEC_EVOL_BR26_FLOW_FACADE.md §2 + §6.
 */

export interface ResolvedAgentConfig {
  systemPrompt: string;
  tools: string[];
  modelPrefs: Record<string, unknown>;
}

export interface AgentTemplate<
  TActor = unknown,
  TAgent = unknown,
  TUpsertItem = unknown,
  TForkInput = unknown,
  TWorkspaceType = unknown,
  TAuthz = unknown,
> {
  list(actor: TActor): Promise<TAgent[]>;

  upsertMany(actor: TActor, items: TUpsertItem[]): Promise<TAgent[]>;

  fork(actor: TActor, id: string, input: TForkInput): Promise<TAgent>;

  detach(actor: TActor, id: string): Promise<TAgent>;

  reset(actor: TActor, id: string): Promise<TAgent>;

  delete(actor: TActor, id: string): Promise<void>;

  /** Idempotent default-agent seed for a workspace type. */
  seedForWorkspaceType(workspaceId: string, type: TWorkspaceType): Promise<void>;

  /**
   * Resolve an agent definition into a runtime config: renders
   * promptTemplate, applies agentSelection rules, overlays skills.
   *
   * @param agentId          target agent definition id
   * @param contextVars      placeholder values for the prompt template
   * @param attachedSkills   optional skill keys to overlay
   * @param authz            optional authz context (BR26-Q2 contract lock)
   */
  resolve(
    agentId: string,
    contextVars: Record<string, unknown>,
    attachedSkills?: string[],
    authz?: TAuthz,
  ): Promise<ResolvedAgentConfig>;
}
