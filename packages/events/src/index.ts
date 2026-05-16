import type {
  CheckpointVersion,
  EventEnvelope,
  TenantContext,
} from '@sentropic/contracts';

export type { CheckpointVersion, EventEnvelope, TenantContext };

// Wire protocol v1 — see SPEC_STUDY_ARCHITECTURE_BOUNDARIES.md §4

export type WireVersion = 1;
export const WIRE_VERSION: WireVersion = 1;

export type Usage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

export type FinishReason =
  | 'stop'
  | 'length'
  | 'tool-calls'
  | 'content-filter'
  | 'error'
  | 'cancelled';

export type StreamEvent =
  | { type: 'text-delta'; delta: string }
  | { type: 'reasoning-delta'; delta: string }
  | { type: 'tool-call'; id: string; toolName: string; args: unknown }
  | { type: 'tool-result'; id: string; output: unknown; isError?: boolean }
  | {
      type: 'step-finish';
      usage: Usage;
      finishReason: FinishReason;
      costDeltaUsd?: number;
    }
  | { type: 'checkpoint'; version: CheckpointVersion }
  | {
      type: 'error';
      code: string;
      message: string;
      retryable: boolean;
    }
  | { type: 'abort'; reason: string };

export type StreamEventEnvelope = EventEnvelope<StreamEvent>;
