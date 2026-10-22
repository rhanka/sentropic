import type { AuthResolver } from '../auth.js';
import type { DecisionSelectionOptions } from './service.js';
import type { DecisionBudgetPort, DecisionReceiptSink } from './budget.js';
import type { DecisionClock } from './execution.js';
import type { EvaluatorRef } from './request.js';

export interface DecisionServiceOptions extends DecisionSelectionOptions {
  resolveAuth: AuthResolver;
  resolvePrice(key: { providerId: string; modelId: string }): unknown | Promise<unknown>;
  /** Closed over verified caller identity; request JSON never selects financial ownership. */
  authorize(evaluator: EvaluatorRef): boolean | Promise<boolean>;
  budget: DecisionBudgetPort;
  receipts: DecisionReceiptSink;
  clock?: DecisionClock;
  generateId?: () => string;
}
