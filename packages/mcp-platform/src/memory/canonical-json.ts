/** RFC 8785 JSON serialization for validated M5 DTOs (UTF-16 object-key order). */
export function canonicalMemoryJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalMemoryJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonicalMemoryJson((value as Record<string, unknown>)[k])}`).join(',')}}`;
  }
  if (value === null || typeof value === 'boolean' || typeof value === 'string' ||
      (typeof value === 'number' && Number.isFinite(value))) return JSON.stringify(value);
  throw new Error('Mutation canonicalization requires JSON values');
}
