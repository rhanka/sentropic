/**
 * Backward-compatible thin re-export shell.
 *
 * The canonical seed catalog now lives in
 * `packages/flow/src/seeds/workflows.ts` and is exposed via the
 * `@sentropic/flow` façade.
 *
 * Lot 5 of BR-26 (default-workflows + default-agents seeds slice):
 * workflow seed data moved into `@sentropic/flow`. Consumers still
 * import named symbols from this file; their call sites will be
 * rebound to the façade at Lot N-3 under `BR26-EX3` (BR26-Q5 lean:
 * thin re-export until consumer rebinding).
 *
 * Per spec/SPEC_EVOL_BR26_FLOW_FACADE.md §3 + §4 (Lot 5).
 */

export type {
  DefaultWorkflowDefinition,
  DefaultWorkflowTaskDefinition,
  DefaultWorkflowTransitionDefinition,
  GenerationAgentKey,
  InitiativeGenerationWorkflowTaskKey,
  WorkspaceTypeWorkflowSeed,
} from '@sentropic/flow';

export {
  CODE_ANALYSIS_WORKFLOW,
  DEFAULT_USE_CASE_GENERATION_WORKFLOW,
  OPPORTUNITY_IDENTIFICATION_WORKFLOW,
  OPPORTUNITY_QUALIFICATION_WORKFLOW,
  USE_CASE_GENERATION_WORKFLOW_KEY,
  WORKSPACE_TYPE_WORKFLOW_SEEDS,
  getWorkflowSeedsForType,
} from '@sentropic/flow';
