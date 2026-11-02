import { IdentityCustodyErrorV1 } from '@sentropic/cluster-mesh';

export type A4SourceRow = Readonly<Record<string, unknown>>;
export const invalidA4Import = (): never => { throw new IdentityCustodyErrorV1('identity_import_invalid'); };
export const sourceText = (value: unknown): string => typeof value === 'string' ? value : invalidA4Import();
export const sourceNullableText = (value: unknown): string | null => value === null ? null : sourceText(value);
export const sourceBoolean = (value: unknown): boolean => typeof value === 'boolean' ? value : invalidA4Import();
export const sourceCounter = (value: unknown, max = Number.MAX_SAFE_INTEGER): number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= max ? value : invalidA4Import();
export function sourceChoice<T extends string>(value: unknown, choices: readonly T[]): T {
  for (const choice of choices) if (choice === value) return choice;
  return invalidA4Import();
}
export const sourceDigest = (value: unknown): string => {
  const text = sourceText(value);
  return /^[a-f0-9]{64}$/.test(text) ? text : invalidA4Import();
};
/** Legacy timestamp-without-timezone is interpreted as UTC, as pinned by A4. */
export const sourceTime = (value: unknown): string => {
  const text = sourceText(value);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})?$/.test(text)) return invalidA4Import();
  const date = new Date(/(?:Z|[+-]\d{2}:\d{2})$/.test(text) ? text : `${text}Z`);
  return Number.isFinite(date.getTime()) ? date.toISOString() : invalidA4Import();
};
export const sourceNullableTime = (value: unknown): string | null => value === null ? null : sourceTime(value);
export function sourceStringArray(value: unknown): readonly string[] | null {
  if (value === null) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(sourceText(value)); } catch { return invalidA4Import(); }
  return Array.isArray(parsed) && parsed.every(item => typeof item === 'string') ? parsed : invalidA4Import();
}
