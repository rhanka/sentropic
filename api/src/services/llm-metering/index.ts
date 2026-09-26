/**
 * LLM metering — barrel.
 *
 * - Observe-only sink (`recordLlmUsage`) for non-gateway API calls.
 * - Gateway budget admission, route settlement, reservation reaper and the pricing single writer
 *   (Lot D B3c): one `cost_ledger` row per settled gateway request; the gateway never wires
 *   `recordLlmUsage`.
 */

export { recordLlmUsage } from './cost-ledger-sink';
export type { MeteringObservation } from './cost-ledger-sink';
export { mergeStreamUsage, normalizeProviderUsage, toMeshTokenUsage } from './usage-normalizer';
export * from './budget-admission';
export * from './route-settlement';
export * from './reservation-reaper';
export * from './model-pricing-writer';
