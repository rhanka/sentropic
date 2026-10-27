import type { RouteUsageCeiling } from '@sentropic/llm-mesh';

/** Unknown dimensions stay absent. Seconds are never converted into LLM tokens. */
export type SpeechUsage = Partial<Pick<RouteUsageCeiling, 'inputTokens' | 'outputTokens'>> & Partial<Record<
  'cacheTokens' | 'audioInputTokens' | 'audioOutputTokens' | 'audioCacheTokens'
  | 'admittedAudioSeconds' | 'connectedSeconds' | 'ttsCharacters' | 'capturedAudioSeconds' | 'localComputeMs', number>>;
export type SpeechDimension = keyof SpeechUsage;
const dimensions: readonly SpeechDimension[] = ['inputTokens', 'outputTokens', 'cacheTokens', 'audioInputTokens',
  'audioOutputTokens', 'audioCacheTokens', 'admittedAudioSeconds', 'connectedSeconds', 'ttsCharacters',
  'capturedAudioSeconds', 'localComputeMs'];
const observational = new Set<SpeechDimension>(['capturedAudioSeconds', 'localComputeMs']);
export const validateSpeechUsage = (usage: SpeechUsage): void => {
  for (const [key, value] of Object.entries(usage)) {
    if (!dimensions.includes(key as SpeechDimension) || !Number.isFinite(value) || value < 0
      || value > Number.MAX_SAFE_INTEGER / 1_000_000
      || ((key.endsWith('Tokens') || key === 'ttsCharacters') && !Number.isSafeInteger(value))) {
      throw new Error('Invalid speech usage dimension');
    }
  }
};

export interface SpeechPrice {
  readonly providerId: string; readonly modelId: string; readonly region: string;
  readonly currency: 'USD'; readonly revision: string; readonly effectiveAtMs: number; readonly expiresAtMs: number;
  /** Integer micro-USD per integer number of native units. Includes applicable taxes/fees. */
  readonly rates: Partial<Record<SpeechDimension, { readonly microUsd: number; readonly per: number }>>;
  readonly fixedMicroUsd: number;
}
const integer = (v: number): boolean => Number.isSafeInteger(v) && v >= 0;
export const priceSpeechUsage = (price: SpeechPrice, usage: SpeechUsage): number => {
  validateSpeechUsage(usage);
  if (price.currency !== 'USD' || !price.revision || !integer(price.fixedMicroUsd)
    || !Number.isFinite(price.effectiveAtMs) || !Number.isFinite(price.expiresAtMs)
    || price.expiresAtMs <= price.effectiveAtMs) throw new Error('Invalid speech price');
  let total = BigInt(price.fixedMicroUsd);
  for (const [key, rate] of Object.entries(price.rates)) {
    if (!dimensions.includes(key as SpeechDimension) || observational.has(key as SpeechDimension)
      || !rate || !integer(rate.microUsd) || !integer(rate.per) || rate.per === 0) throw new Error('Invalid speech rate');
  }
  for (const [key, value] of Object.entries(usage)) {
    if (observational.has(key as SpeechDimension)) continue;
    const rate = price.rates[key as SpeechDimension];
    if (!rate) throw new Error('Speech dimension has no pinned price');
    const scaled = BigInt(Math.ceil(value * 1_000_000));
    const divisor = BigInt(rate.per) * 1_000_000n;
    total += (scaled * BigInt(rate.microUsd) + divisor - 1n) / divisor;
  }
  if (total > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Speech price overflow');
  return Number(total);
};

export interface SpeechUsageUpdate {
  readonly eventId: string; readonly revision: number; readonly mode: 'cumulative' | 'incremental';
  readonly usage: SpeechUsage;
}
export interface SpeechUsageState {
  mode: SpeechUsageUpdate['mode']; revision: number; totals: SpeechUsage;
  events: Record<string, { revision: number; usage: SpeechUsage }>;
}
const canonical = (usage: SpeechUsage): string => JSON.stringify(Object.entries(usage).sort(([a], [b]) => a.localeCompare(b)));
/** Persist this state in the existing hold transaction; recreating a client must not reset dedupe. */
export const normalizeSpeechUsage = (state: SpeechUsageState | undefined, update: SpeechUsageUpdate): SpeechUsageState => {
  validateSpeechUsage(update.usage);
  if (!update.eventId || !Number.isSafeInteger(update.revision) || update.revision < 0
    || !['cumulative', 'incremental'].includes(update.mode) || (state && state.mode !== update.mode)) {
    throw new Error('Invalid speech usage revision');
  }
  const previous = state && Object.hasOwn(state.events, update.eventId) ? state.events[update.eventId] : undefined;
  if (previous && update.revision <= previous.revision) {
    if (update.revision === previous.revision && canonical(previous.usage) !== canonical(update.usage)) {
      throw new Error('Speech usage revision conflict');
    }
    return structuredClone(state!);
  }
  if (state && update.mode === 'cumulative' && update.revision <= state.revision) {
    if (update.revision === state.revision && canonical(state.totals) !== canonical(update.usage)) {
      throw new Error('Speech cumulative revision conflict');
    }
    return structuredClone(state);
  }
  const next: SpeechUsageState = structuredClone(state ?? { mode: update.mode, revision: -1, totals: {}, events: {} });
  if (!previous && Object.keys(next.events).length >= 4096) throw new Error('Speech usage event limit reached');
  if (update.mode === 'cumulative') next.totals = structuredClone(update.usage);
  else {
    for (const key of dimensions) {
      if (update.usage[key] === undefined && previous?.usage[key] === undefined) continue;
      next.totals[key] = (next.totals[key] ?? 0) - (previous?.usage[key] ?? 0) + (update.usage[key] ?? 0);
    }
  }
  validateSpeechUsage(next.totals);
  Object.defineProperty(next.events, update.eventId, { value: { revision: update.revision,
    usage: structuredClone(update.usage) }, enumerable: true, configurable: true, writable: true });
  next.revision = Math.max(next.revision, update.revision);
  return next;
};
