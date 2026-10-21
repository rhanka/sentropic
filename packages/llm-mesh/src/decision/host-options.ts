import type { AuthResolver } from '../auth.js';
import type { JudgeSelectionOptions } from './service.js';
import type { JudgeBudgetPort, JudgeReceiptSink } from './budget.js';
import type { JudgeClock } from './execution.js';
import type { EvaluatorRef } from './request.js';

export interface JudgeServiceOptions extends JudgeSelectionOptions {
  resolveAuth: AuthResolver;
  resolvePrice(key: { providerId: 'typesafe'; modelId: string }): unknown | Promise<unknown>;
  /** Closed over verified caller identity; request JSON never selects financial ownership. */
  authorize(evaluator: EvaluatorRef): boolean | Promise<boolean>;
  budget: JudgeBudgetPort;
  receipts: JudgeReceiptSink;
  clock?: JudgeClock;
  generateId?: () => string;
}
