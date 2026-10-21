import { has, hasOnlyKeys, isMicroUsd, isRecord, JUDGE_MAX_RAW_BYTES } from './validation.js';

export function isRequestPolicy(value: unknown): boolean {
  if (!isRecord(value) || !hasOnlyKeys(value, ['budget', 'timeoutMs', 'explanation'])) return false;
  if (has(value, 'budget') && (!isRecord(value.budget)
    || !hasOnlyKeys(value.budget, ['maxCostMicroUsd']) || !isMicroUsd(value.budget.maxCostMicroUsd))) return false;
  if (has(value, 'timeoutMs') && (typeof value.timeoutMs !== 'number'
    || !Number.isSafeInteger(value.timeoutMs) || value.timeoutMs < 1 || value.timeoutMs > 60_000)) return false;
  return !has(value, 'explanation') || ['none', 'if-available', 'required'].some((v) => v === value.explanation);
}

export function isRawPolicy(value: unknown): boolean {
  return isRecord(value) && hasOnlyKeys(value, ['mode', 'maxBytes'])
    && (value.mode === 'none' || value.mode === 'allowlisted')
    && (!has(value, 'maxBytes') || (typeof value.maxBytes === 'number'
      && Number.isSafeInteger(value.maxBytes) && value.maxBytes >= 0 && value.maxBytes <= JUDGE_MAX_RAW_BYTES));
}
