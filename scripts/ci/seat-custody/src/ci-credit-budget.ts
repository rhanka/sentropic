import { ensure } from './seat-admission.ts';
export type Price = { model: string; input: number; output: number; maxInput: number;
  maxOutput: number; context: number; validUntil: number; qualified: boolean };
export const retiredModel = (model: string) => ['gpt-4.1-nano', 'gpt-4.1-nano-2025-04-14'].includes(model);
export const quoteCredit = (envelope: { input: number; output: number; framingQualified: boolean },
  price: Price, now: number) => {
  ensure(price.qualified && !retiredModel(price.model) && price.validUntil > now
    && [price.input, price.output, price.maxInput, price.maxOutput, price.context]
      .every(n => Number.isFinite(n) && n > 0), 'credit-price-unqualified');
  ensure(envelope.framingQualified && Number.isSafeInteger(envelope.input) && envelope.input > 0
    && Number.isSafeInteger(envelope.output) && envelope.output > 0
    && envelope.input <= Math.min(272_000, price.maxInput) && envelope.output <= price.maxOutput
    && envelope.input + envelope.output <= price.context, 'credit-envelope');
  const micro = Math.ceil(envelope.input * price.input + envelope.output * price.output);
  ensure(Number.isSafeInteger(micro) && micro > 0 && micro <= 120_000, 'credit-request-cap');
  return micro;
};
export const imageTokens = (width: number, height: number, detail?: string) => {
  ensure(Number.isSafeInteger(width) && width > 0 && Number.isSafeInteger(height) && height > 0
    && width <= 100_000 && height <= 100_000, 'image-dimensions');
  ensure(detail === undefined || ['high', 'auto', 'original'].includes(detail), 'image-detail');
  return Math.ceil(Math.min(Math.ceil(width / 32) * Math.ceil(height / 32), detail === 'high' ? 2500 : 30000) * 1.2) + 1;
};
export type CreditSegment = { campaign: string; binding: string; runId: string; runAttempt: number;
  day: string; endDay?: string; index: number; maxMicro: number; maxAttempts: number;
  settledMicro?: number; settledAttempts?: number };
export type CreditState = { version: 1; segments: Record<string, CreditSegment> };
export const initialCreditState = (): CreditState => ({ version: 1, segments: {} });
export const allocateSegment = (state: CreditState, segment: CreditSegment) => {
  ensure(state.version === 1 && segment.campaign && /^[a-f0-9]{64}$/.test(segment.binding)
    && /^\d+$/.test(segment.runId) && Number.isSafeInteger(segment.runAttempt) && segment.runAttempt > 0,
  'credit-segment-binding');
  ensure(Number.isSafeInteger(segment.maxMicro) && segment.maxMicro > 0 && segment.maxMicro <= 2_000_000
    && Number.isSafeInteger(segment.maxAttempts) && segment.maxAttempts > 0 && segment.maxAttempts <= 250,
  'credit-segment-cap');
  const all = Object.values(state.segments);
  const previous = all.filter(s => s.campaign === segment.campaign);
  ensure(segment.index === previous.length + 1 && previous.every(s => s.binding === segment.binding)
    && !all.some(s => s.runId === segment.runId), 'credit-segment-replay');
  const end = segment.endDay ?? segment.day;
  const startDate = new Date(`${segment.day}T00:00:00.000Z`);
  const endDate = new Date(`${end}T00:00:00.000Z`);
  ensure(Number.isFinite(startDate.valueOf()) && startDate.toISOString().slice(0, 10) === segment.day
    && Number.isFinite(endDate.valueOf()) && endDate.toISOString().slice(0, 10) === end
    && endDate.valueOf() - startDate.valueOf() >= 0
    && endDate.valueOf() - startDate.valueOf() <= 86_400_000, 'credit-segment-day');
  for (const day of new Set([segment.day, end])) {
    const inDay = all.filter(s => s.day <= day && (s.endDay ?? s.day) >= day);
    ensure(inDay.reduce((n, s) => n + (s.settledMicro ?? s.maxMicro), segment.maxMicro) <= 5_000_000
      && inDay.reduce((n, s) => n + (s.settledAttempts ?? s.maxAttempts), segment.maxAttempts) <= 1000, 'credit-day-cap');
    const month = day.slice(0, 7);
    const inMonth = all.filter(s => s.day.slice(0, 7) <= month && (s.endDay ?? s.day).slice(0, 7) >= month);
    ensure(inMonth.reduce((n, s) => n + (s.settledMicro ?? s.maxMicro), segment.maxMicro) <= 25_000_000
      && inMonth.reduce((n, s) => n + (s.settledAttempts ?? s.maxAttempts), segment.maxAttempts) <= 5000, 'credit-month-cap');
  }
  state.segments[`${segment.campaign}:${segment.index}`] = structuredClone(segment);
  return structuredClone(segment);
};
