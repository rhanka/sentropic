/**
 * Backward-compatible thin re-export shell.
 *
 * The canonical implementation now lives in
 * `api/src/services/flow/postgres-approval-gate.ts` and is exposed via
 * the `@sentropic/flow` façade (`flowRuntime.ports.approvalGate`).
 *
 * Lot 4 Slice 1 of BR-26: gate evaluation logic moved into the façade
 * adapter. Consumers (`tool-service`, `routes/api/initiatives`,
 * `routes/api/workspaces`, `tests/api/gate-evaluation.test.ts`,
 * `tests/services/flow/replay.spec.ts`) still import named functions
 * from here; their call sites will be rebound to the façade at Lot N-3
 * under `BR26-EX3`.
 *
 * Per spec/SPEC_EVOL_BR26_FLOW_FACADE.md §3 + §4.
 */

export type {
  GateConfig,
  GateCriteria,
  GateEvaluationResult,
  GateMode,
} from '@sentropic/flow';

export {
  evaluateGate,
  getDefaultGateConfig,
  resolveGateConfig,
} from './flow/postgres-approval-gate';
