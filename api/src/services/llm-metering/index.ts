/**
 * LLM metering — barrel.
 *
 * Observe-only v0: exposes the cost-ledger sink. The mesh `onResponse` wiring
 * (attribution + hook construction) lands in Lot 2.
 */

export { recordLlmUsage } from './cost-ledger-sink';
export type { MeteringObservation } from './cost-ledger-sink';
