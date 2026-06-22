/**
 * CostContext — resolved from the VERIFIED caller identity (spec §2), NEVER
 * from the request body. It is the financial attribution key ("who consumed /
 * who pays") that BR-47 rolls cost_events by (spec §5). v0 stub: shape only;
 * the real resolver (caller-auth via auth-hono) lands in Lot 2.
 */
export interface CostContext {
  readonly tenantId: string;
  readonly workspaceId?: string;
  readonly principalId: string;
  /** Origin surface of the call (e.g. `chat-server`, `api-tools`, `layer-c`). */
  readonly source: string;
  readonly correlationId: string;
  /** The code site that issued the call, for observability. */
  readonly callSite?: string;
  /** BR-47 budget scope this spend rolls into. */
  readonly budgetScope?: string;
}
