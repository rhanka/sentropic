import { LUNA_MAX_INPUT_TOKENS, LUNA_MAX_OUTPUT_TOKENS } from '../../src/config/models';

export const NANO_CANDIDATES = ['gpt-6-luna', 'gpt-5.6-luna'] as const;
export type NanoCandidate = typeof NANO_CANDIDATES[number];
export type NanoUsage = { input: number; output: number; reasoning: number; cached: number; cacheWrite?: number };
export const qualificationSelected = (scope?: string): boolean =>
  scope?.trim() === 'tests/ai/nano-replacement-qualification.test.ts';

// Official Standard USD/million-token rates fetched October 17, 2026.
const prices = {
  'gpt-6-luna': { input: 0.10, cached: 0.01, output: 0.50 },
  'gpt-5.6-luna': { input: 0.20, cached: 0.02, output: 1.20 },
};
const rates = (model: NanoCandidate, input: number) => ({
  input: prices[model].input * (input > 272_000 ? 2 : 1),
  cached: prices[model].cached * (input > 272_000 ? 2 : 1),
  output: prices[model].output * (input > 272_000 ? 1.5 : 1),
});
export const priceNanoUsage = (model: NanoCandidate, usage: NanoUsage): number => {
  const price = rates(model, usage.input);
  const cacheWrite = usage.cacheWrite ?? 0;
  return ((usage.input - usage.cached - cacheWrite) * price.input + usage.cached * price.cached
    + cacheWrite * price.input * 1.25 + usage.output * price.output) / 1_000_000;
};

export type NanoReservation = Readonly<{
  model: NanoCandidate; ordinal: number; maxOutputTokens: number; reservedMicroUsd: number;
}>;

/** Reserve against the provider's 922k maximum input, long tariff and cache-write premium. */
export const createNanoBudget = (append: (event: Record<string, unknown>) => void, limitUsd = 15, maxCalls = 38) => {
  if (!Number.isFinite(limitUsd) || limitUsd <= 0 || !Number.isInteger(maxCalls) || maxCalls < 1) throw new Error('Invalid qualification budget');
  const limitMicroUsd = Math.floor(Math.min(15, limitUsd) * 1_000_000);
  let chargedMicroUsd = 0;
  let calls = 0;
  let closed = false;
  let active: NanoReservation | null = null;
  const snapshot = () => ({ chargedMicroUsd, calls, closed, pending: active !== null });
  const reserve = (model: NanoCandidate, maxOutputTokens: number): NanoReservation => {
    if (closed) throw new Error('Qualification budget is closed');
    if (active || calls >= Math.min(38, maxCalls)) throw new Error('Qualification call limit or concurrency exceeded');
    if (!NANO_CANDIDATES.includes(model) || !Number.isInteger(maxOutputTokens) || maxOutputTokens < 1 || maxOutputTokens > LUNA_MAX_OUTPUT_TOKENS) {
      throw new Error('Qualification model or output budget refused');
    }
    const price = rates(model, LUNA_MAX_INPUT_TOKENS);
    const reservedMicroUsd = Math.ceil(LUNA_MAX_INPUT_TOKENS * price.input * 1.25 + maxOutputTokens * price.output);
    if (chargedMicroUsd + reservedMicroUsd > limitMicroUsd) throw new Error('Qualification dollar budget exhausted');
    calls += 1;
    chargedMicroUsd += reservedMicroUsd;
    active = Object.freeze({ model, ordinal: calls, maxOutputTokens, reservedMicroUsd });
    try { append({ type: 'reserved', ...active, ...snapshot() }); }
    catch { closed = true; throw new Error('Qualification reservation journal failed'); }
    return active;
  };
  const settle = (ticket: NanoReservation, usage: NanoUsage | null) => {
    if (closed || ticket !== active) throw new Error('Qualification reservation is closed or unknown');
    if (!usage || !(['input', 'output', 'reasoning', 'cached'] as const).every((key) => Number.isInteger(usage[key]) && usage[key] >= 0)
      || usage.input > LUNA_MAX_INPUT_TOKENS || usage.output > ticket.maxOutputTokens || usage.reasoning > usage.output || usage.cached > usage.input
      || !Number.isInteger(usage.cacheWrite ?? 0) || (usage.cacheWrite ?? 0) < 0 || usage.cached + (usage.cacheWrite ?? 0) > usage.input) {
      closed = true;
      throw new Error('Qualification usage is missing or violates the reserved limits');
    }
    const price = rates(ticket.model, usage.input);
    const upperMicroUsd = Math.ceil(usage.input * price.input * 1.25 + usage.output * price.output);
    chargedMicroUsd += upperMicroUsd - ticket.reservedMicroUsd;
    active = null;
    const costUsd = priceNanoUsage(ticket.model, usage);
    try { append({ type: 'settled', ordinal: ticket.ordinal, model: ticket.model, usage, costUsd, ...snapshot() }); }
    catch { closed = true; throw new Error('Qualification settlement journal failed'); }
    return costUsd;
  };
  return { reserve, settle, snapshot, close: () => { closed = true; } };
};
