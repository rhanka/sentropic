import { cleanNativeMeasured, safeInputCategories } from './gw-native-qualification-receipts';
import { requireQualification, type QualificationDb } from './gw-native-qualification-readiness';

type Case = { model: string; name: string; count: boolean; native: boolean; stream: boolean };
const number = (value: unknown): number | null => Number.isSafeInteger(value) && (value as number) >= 0 ? value as number : null;
const reasons = ['incomplete_input', 'invalid_input', 'cache_write_split_unknown', 'served_model_unverified',
  'served_model_mismatch', 'input_breakdown_changed', 'incomplete_output', 'invalid_output', 'missing_usage'];
export const qualificationLedgerEvidence = (planned: Case, requestId: string, rows: Record<string, any>[], holds: Record<string, any>[], outbox: number,
  persist?: (evidence: Record<string, unknown>) => void): Record<string, any> => {
  const financial = rows.filter(row => row.idempotency_key === requestId && row.hold_id != null && row.cost_micro_usd != null);
  const observations = rows.filter(row => row.response_id === requestId && row.hold_id == null);
  if (planned.count) {
    requireQualification(rows.length === 0 && holds.length === 0 && outbox === 0);
    const evidence = { financialRows: 0, observationRows: 0, holds: 0, outboxEvents: 0 }; persist?.(evidence); return evidence;
  }
  requireQualification(financial.length === 1 && holds.length === 1 && holds[0]?.status === 'settled' && outbox === 1);
  if (!planned.native) { const evidence = { financialRows: 1, holds: 1, outboxEvents: 1 }; persist?.(evidence); return evidence; }
  requireQualification(rows.length === 2 && observations.length === 1 && observations[0]?.cost_micro_usd == null
    && observations[0]?.credential_source === 'environment' && observations[0]?.idempotency_key !== requestId);
  const observation = observations[0]!; const charged = financial[0]!;
  const raw = observation.usage_raw ?? {};
  requireQualification(charged.attempts?.length === 1 && number(charged.input_tokens) !== null && number(charged.output_tokens) !== null
    && typeof charged.attempts[0]?.estimated === 'boolean' && typeof raw.estimated === 'boolean'
    && typeof raw.fallback_present === 'boolean' && typeof raw.iterations_present === 'boolean');
  const counts = [raw.input_tokens, raw.cache_read_input_tokens ?? 0, raw.cache_creation_input_tokens ?? 0];
  requireQualification(counts.every(value => number(value) !== null));
  const physical = counts.reduce((sum, value) => sum + value, 0);
  requireQualification(Number.isSafeInteger(physical) && observation.input_tokens === physical
    && number(observation.output_tokens) !== null && observation.total_tokens === physical + observation.output_tokens);
  const evidence = { financialRows: 1, observationRows: 1, holds: 1, outboxEvents: 1,
    inputTokens: physical, outputTokens: observation.output_tokens, totalTokens: observation.total_tokens,
    chargedInputTokens: number(charged.input_tokens), chargedOutputTokens: number(charged.output_tokens),
    financialEstimated: charged.attempts?.[0]?.estimated === true, estimated: raw.estimated === true,
    input_usage_validated: raw.input_usage_validated === true,
    input_usage_source: ['json', 'message_start', 'message_delta'].includes(raw.input_usage_source) ? raw.input_usage_source : 'absent',
    uncertainty_reason: raw.uncertainty_reason == null ? 'absent' : reasons.includes(raw.uncertainty_reason) ? raw.uncertainty_reason : 'other',
    fallback_present: raw.fallback_present === true, iterations_present: raw.iterations_present === true,
    final_output_observed: raw.final_output_observed === true, splitInferred: raw.cache_write_split_reason === 'cache_write_split_inferred',
    rawInput: safeInputCategories(raw) };
  persist?.(evidence);
  if (planned.name !== 'websearch') requireQualification(raw.native_pricing_policy === 'anthropic-cache-2026-10-02'
    && cleanNativeMeasured(planned.model, observation, charged, planned.stream));
  return evidence;
};
/** Poll only SELECTs for the existing bounded asynchronous observation, never re-send HTTP. */
export const readQualificationLedger = async (db: QualificationDb, planned: Case, requestId: string, persist?: (evidence: Record<string, unknown>) => void) => {
  requireQualification(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(requestId));
  const deadline = Date.now() + 1_000; let rows: Record<string, any>[];
  do {
    rows = (await db.query(`SELECT idempotency_key, hold_id, cost_micro_usd, response_id, credential_source,
      input_tokens, output_tokens, total_tokens, usage_raw, attempts FROM control.cost_ledger
      WHERE idempotency_key = $1 OR response_id = $1`, [requestId])).rows;
    if (planned.count || rows.length >= (planned.native ? 2 : 1) || Date.now() >= deadline) break;
    await new Promise(resolve => setTimeout(resolve, 25));
  } while (true);
  const holds = (await db.query(`SELECT status FROM control.budget_holds WHERE request_id = $1`, [requestId])).rows;
  const outbox = Number((await db.query(`SELECT count(*) AS n FROM control.event_outbox WHERE aggregate_id = $1`, [requestId])).rows[0]?.n);
  return qualificationLedgerEvidence(planned, requestId, rows, holds, outbox, persist);
};
