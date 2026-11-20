import { resolveRequestedTargets, type ReasoningEffort } from '@sentropic/llm-mesh';
import type { GatewayWire } from '../ports/dispatch.js';

const VALID_EFFORTS: ReadonlySet<string> = new Set(['none', 'low', 'medium', 'high', 'xhigh', 'max']);
const LOT1_REWRITE_WIRES: ReadonlySet<GatewayWire> = new Set(['anthropic-messages', 'openai-chat-completions']);

export interface StageRewriteRule {
  readonly ruleId: string;
  readonly matchModel: string;
  readonly matchEffort?: ReasoningEffort;
  readonly targetModel: string;
  readonly targetEffort?: ReasoningEffort;
}

export interface StageRewriteTrace {
  readonly stageId: string;
  readonly ruleId: string;
  readonly fromModel: string;
  readonly toModel: string;
  readonly fromEffort?: string;
  readonly toEffort?: string;
}

export interface StageRewriteOptions {
  readonly stageId: string;
  readonly rules: readonly StageRewriteRule[];
}

export interface StageRewriteInput {
  readonly wire: GatewayWire;
  readonly body: unknown;
  readonly model: string;
  readonly effort?: ReasoningEffort;
  readonly stageRewriteCount?: number;
}

export interface StageRewriteResult {
  readonly rewritten: boolean;
  readonly originModel: string;
  readonly model: string;
  readonly effort?: ReasoningEffort;
  readonly body: unknown;
  readonly stageRewriteCount: number;
  readonly trace?: StageRewriteTrace;
}

export class StageRewriteEngine {
  private readonly stageId: string;
  private readonly rules: readonly StageRewriteRule[];

  constructor(options: StageRewriteOptions) {
    if (!options.stageId.trim()) throw new Error('StageRewriteEngine requires a non-empty stageId');
    for (const rule of options.rules) {
      if (!rule.ruleId.trim() || !rule.matchModel.trim() || !rule.targetModel.trim()) {
        throw new Error(`Invalid stage rewrite rule: ${rule.ruleId}`);
      }
      if (rule.matchEffort !== undefined && !VALID_EFFORTS.has(rule.matchEffort)) {
        throw new Error(`Invalid matchEffort "${rule.matchEffort}" in rule ${rule.ruleId}`);
      }
      if (rule.targetEffort !== undefined && !VALID_EFFORTS.has(rule.targetEffort)) {
        throw new Error(`Invalid targetEffort "${rule.targetEffort}" in rule ${rule.ruleId}`);
      }
      const resolution = resolveRequestedTargets({ requestedModel: rule.targetModel }, true);
      if (resolution.kind === 'unknown-model') {
        throw new Error(`Unknown rewrite target model "${rule.targetModel}" in rule ${rule.ruleId}`);
      }
    }
    this.stageId = options.stageId;
    this.rules = [...options.rules];
  }

  rewrite(input: StageRewriteInput): StageRewriteResult {
    const count = input.stageRewriteCount ?? 0;
    if (count >= 1 || !LOT1_REWRITE_WIRES.has(input.wire)) {
      return {
        rewritten: false, originModel: input.model, model: input.model,
        effort: input.effort, body: input.body, stageRewriteCount: count,
      };
    }
    const rule = this.rules.find((candidate) =>
      candidate.matchModel === input.model
      && (candidate.matchEffort === undefined || candidate.matchEffort === input.effort));
    if (!rule) {
      return {
        rewritten: false, originModel: input.model, model: input.model,
        effort: input.effort, body: input.body, stageRewriteCount: count,
      };
    }
    const raw: Record<string, unknown> = input.body && typeof input.body === 'object' && !Array.isArray(input.body)
      ? { ...(input.body as Record<string, unknown>) }
      : { model: rule.targetModel };
    raw.model = rule.targetModel;
    if (rule.targetEffort !== undefined) {
      if (input.wire === 'openai-chat-completions') {
        const hasObj = Boolean(raw.reasoning && typeof raw.reasoning === 'object' && !Array.isArray(raw.reasoning));
        if (raw.reasoning_effort !== undefined || !hasObj) raw.reasoning_effort = rule.targetEffort;
        if (hasObj) raw.reasoning = { ...(raw.reasoning as Record<string, unknown>), effort: rule.targetEffort };
      } else {
        const existing = raw.reasoning && typeof raw.reasoning === 'object' && !Array.isArray(raw.reasoning)
          ? (raw.reasoning as Record<string, unknown>) : {};
        raw.reasoning = { ...existing, effort: rule.targetEffort };
      }
    }
    const trace: StageRewriteTrace = {
      stageId: this.stageId,
      ruleId: rule.ruleId,
      fromModel: input.model,
      toModel: rule.targetModel,
      ...(input.effort !== undefined ? { fromEffort: input.effort } : {}),
      ...(rule.targetEffort !== undefined ? { toEffort: rule.targetEffort } : {}),
    };
    return {
      rewritten: true,
      originModel: input.model,
      model: rule.targetModel,
      effort: rule.targetEffort ?? input.effort,
      body: raw,
      stageRewriteCount: count + 1,
      trace,
    };
  }
}
