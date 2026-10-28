import type { AuthResolver } from '../auth.js';
import type { DecisionSelectionOptions } from './service.js';
import type { DecisionBudgetPort, DecisionReceiptSink } from './budget.js';
import type { DecisionClock } from './execution.js';
import type { EvaluatorRef } from './request.js';
import type { DecisionReadinessEvidence } from './qualification.js';

export interface DecisionPriceLookupKey {
  providerId: string; modelId: string;
  /** Backend protocol, price authority and protocol-specific revision carried
   * from the authoritative descriptor, so one revision cannot silently serve
   * two authorities or protocols. */
  protocol: string; authority: string; priceRevision: string;
}

export interface DecisionServiceOptions extends DecisionSelectionOptions {
  /** Isolated host composition; production is the default and refuses qualification descriptors. */
  executionProfile?: 'production' | 'qualification';
  /** Host-owned evidence; caller JSON cannot select an experimental profile or a policy. */
  readiness?: Omit<DecisionReadinessEvidence, 'price'>;
  resolveAuth: AuthResolver;
  resolvePrice(key: DecisionPriceLookupKey): unknown | Promise<unknown>;
  /** Closed over verified caller identity; request JSON never selects financial ownership. */
  authorize(evaluator: EvaluatorRef): boolean | Promise<boolean>;
  budget: DecisionBudgetPort;
  receipts: DecisionReceiptSink;
  clock?: DecisionClock;
  generateId?: () => string;
}
