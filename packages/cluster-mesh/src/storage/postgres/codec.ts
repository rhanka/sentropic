import { PostgresStorageError } from './errors.js';

const corrupt = (): never => { throw new PostgresStorageError('corruption'); };
export const decodePgText = (value: unknown): string => typeof value === 'string' ? value : corrupt();
export const decodePgCounter = (value: unknown): string => {
  if (typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value)) return value;
  if (typeof value === 'bigint' && value >= 0n) return String(value);
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return String(value);
  return corrupt();
};
export const decodePgBytes = (value: unknown): Buffer => value instanceof Uint8Array ? Buffer.from(value) : corrupt();
export const decodePgUtf8 = (value: unknown): string => {
  const bytes = decodePgBytes(value);
  try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); } catch { return corrupt(); }
};
export const decodePgJson = <T>(value: unknown): T => {
  if (typeof value !== 'string') return corrupt();
  try { return JSON.parse(value) as T; } catch { return corrupt(); }
};
export const decodePgBoolean = (value: unknown): boolean => typeof value === 'boolean' ? value : corrupt();
