/** Host custody and financial authority. Never import this surface into a consumer. */
export { createJudgeService } from './service.js';
export { createJevAdapter } from './adapter.js';
export { jevDescriptor } from './jev-descriptor.js';
export type { JevAdapterOptions } from './adapter.js';
export type { JudgeServiceOptions } from './host-options.js';
export type { JudgeHostPolicy } from './policy.js';
export type { EvaluatorDescriptor, ResolvedJudgeCriterion } from './jev-descriptor.js';
export type { JudgeBudgetPort, JudgeReceiptSink, JudgeAdmission, JudgeAdmissionResult,
  JudgeDispatchResult, JudgeSettlement } from './budget.js';
export type { JudgePrice, JudgeQuote } from './pricing.js';
export type { JudgeClock } from './execution.js';
