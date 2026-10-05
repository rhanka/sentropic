import type { ProviderId } from '../providers.js';

export type Json = null | boolean | number | string | readonly Json[]
  | { readonly [key: string]: Json };
/** Canonical nonnegative integer decimal micro-USD, never floating point. */
export type MicroUsd = string;

export interface EvaluatorRef {
  providerId: ProviderId;
  evaluatorId: string;
  revision: string;
}

export interface JudgeInputs {
  input?: Json;
  output?: Json;
  context?: readonly Json[];
  reference?: Json;
  state?: Json;
}

export type JudgeCriterion =
  | { kind: 'binary'; instructions: string; criteria?: { true: string; false: string } }
  | { kind: 'graded'; instructions: string;
      direction: 'higher-is-better' | 'lower-is-better' | 'unordered';
      levels: readonly { label: string; description: string }[] }
  | { kind: 'choice'; instructions: string;
      options: readonly { id: string; description: string }[] }
  | { kind: 'registered'; criteriaId: string; revision: string };

export type DecisionRule =
  | { kind: 'provider' }
  | { kind: 'threshold'; field: 'score'; op: 'gte' | 'lte'; value: number }
  | { kind: 'labels'; passing: readonly string[] };

export interface JudgeRequest {
  schemaVersion: 1;
  evaluator: EvaluatorRef;
  inputs: JudgeInputs;
  criterion: JudgeCriterion;
  decision?: DecisionRule;
  policy?: {
    budget?: { maxCostMicroUsd: MicroUsd };
    timeoutMs?: number;
    explanation?: 'none' | 'if-available' | 'required';
  };
  raw?: { mode: 'none' | 'allowlisted'; maxBytes?: number };
  correlationId?: string;
}
