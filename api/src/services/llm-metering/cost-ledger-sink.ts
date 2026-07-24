/**
 * LLM metering — cost-ledger sink (observe-only v0).
 *
 * Records ONE `control.cost_ledger` row per LLM call. Fed (later) by the
 * `@sentropic/llm-mesh` `onResponse` hook via the mesh-dispatch wiring (Lot 2).
 *
 * Design anchor: `spec/SPEC_EVOL_LLM_METERING_OBSERVABILITY.md` + integration spec §D/§E.
 * - Persistence is app/control-plane owned (ACCOUNT_TRANSPORTS D2: llm-mesh stays DB-agnostic).
 * - Idempotency: `callId` maps to `cost_ledger.idempotency_key` (UNIQUE); the insert uses
 *   `ON CONFLICT DO NOTHING`, so a double-fire (retry/replay) is a no-op.
 * - Observe-only: `usage` is optional/absent on most provider paths today → token counts and
 *   `cost_micro_usd` are null until the usage-envelope / pricing lots.
 */

import type { TokenUsage } from '@sentropic/llm-mesh';

import { createId } from '../../utils/id';
import { db } from '../../db/client';
import { costLedger } from '../../db/control-schema';

/**
 * A single LLM-call observation to persist. Attribution fields (callId, userId, workspaceId,
 * credentialSource) are supplied directly by the caller (the mesh-dispatch wiring); the mesh
 * `onResponse` event supplies operation/provider/model/finishReason/responseId/usage.
 */
export interface MeteringObservation {
  callId: string; // idempotency key (minted at the dispatch boundary)
  operation: 'generate' | 'stream';
  providerId: string;
  modelId: string;
  credentialSource?: string;
  userId?: string;
  workspaceId?: string;
  finishReason?: string;
  responseId?: string;
  usage?: TokenUsage; // from @sentropic/llm-mesh; absent on most paths until Lot 3
}

/**
 * Persist one observation as a `control.cost_ledger` row.
 *
 * Direct insert with `ON CONFLICT (idempotency_key) DO NOTHING` — no outbox, no ambient
 * transaction (observe-only has no downstream consumer; idempotency is constraint-backed).
 * The caller is responsible for fail-open error handling; this function performs the insert
 * and lets the (rare) DB error propagate to the caller's try/catch.
 */
export const recordLlmUsage = async (obs: MeteringObservation): Promise<void> => {
  await db
    .insert(costLedger)
    .values({
      id: createId(),
      idempotencyKey: obs.callId,
      userId: obs.userId ?? null,
      workspaceId: obs.workspaceId ?? null,
      operation: obs.operation,
      providerId: obs.providerId,
      modelId: obs.modelId,
      credentialSource: obs.credentialSource ?? null,
      finishReason: obs.finishReason ?? null,
      responseId: obs.responseId ?? null,
      inputTokens: obs.usage?.inputTokens ?? null,
      outputTokens: obs.usage?.outputTokens ?? null,
      reasoningTokens: obs.usage?.reasoningTokens ?? null,
      totalTokens: obs.usage?.totalTokens ?? null,
      usageRaw: obs.usage?.providerRawUsage ?? null,
      costMicroUsd: null, // pricing is a later lot
    })
    .onConflictDoNothing({ target: costLedger.idempotencyKey });
};
