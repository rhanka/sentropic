import type { JudgeError } from './errors.js';
import type { EvaluatorRef } from './request.js';
import type { JudgeUsage } from './receipt.js';
import type { JudgeVerdict } from './verdict.js';

/** Adapter evidence stays available when verdict validation fails after dispatch. */
interface JudgeAdapterEvidence {
  usage: JudgeUsage;
  servedEvaluator: EvaluatorRef | null;
  servedModelId: string | null;
  providerRequestId?: string;
  providerLatencyMs?: number;
}

/** Implementations must validate verdict/usage independently and sanitize upstream IDs. */
export type JudgeAdapterResult = JudgeAdapterEvidence & (
  | { ok: true; verdict: JudgeVerdict }
  | { ok: false; error: JudgeError }
);
