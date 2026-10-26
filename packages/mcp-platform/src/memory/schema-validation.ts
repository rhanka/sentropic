import { isNfc, isWellFormed, isValidCursor, isValidInstant, utf8ByteLength } from './contracts.js';
import { isRecord } from './context-validation.js';

/** Evaluates the finite, closed schema assets; refuses non-JSON data before recursion. */
export function validateSchema(value: unknown, schema: any, path = '$', seen = new Set<object>()): string[] {
  const failures: string[] = [];
  if (value && typeof value === 'object') {
    if (seen.has(value)) return [`${path}: cyclic value`];
    seen = new Set(seen).add(value);
  }
  if (schema.oneOf) {
    const matches = schema.oneOf.filter((s: any) => validateSchema(value, s, path, new Set()).length === 0);
    if (matches.length !== 1) failures.push(`${path}: oneOf mismatch`);
  }
  if ('const' in schema && JSON.stringify(value) !== JSON.stringify(schema.const)) failures.push(`${path}: const mismatch`);
  if (schema.enum && !schema.enum.includes(value)) failures.push(`${path}: enum mismatch`);
  if (schema.type === 'object') {
    if (!isRecord(value)) return [`${path}: plain object required`];
    const props = schema.properties ?? {};
    for (const key of schema.required ?? []) if (!Object.hasOwn(value, key)) failures.push(`${path}.${key}: required`);
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string' || !Object.hasOwn(props, key)) {
        if (schema.additionalProperties === false) failures.push(`${path}: unknown property`);
      } else failures.push(...validateSchema(value[key], props[key], `${path}.${key}`, seen));
    }
  } else if (schema.type === 'array') {
    if (!Array.isArray(value)) return [`${path}: array required`];
    if (value.length < (schema.minItems ?? 0) || value.length > (schema.maxItems ?? Infinity)) failures.push(`${path}: array bounds`);
    if (schema.uniqueItems && new Set(value.map(v => JSON.stringify(v))).size !== value.length) failures.push(`${path}: duplicate items`);
    for (let i = 0; i < value.length; i++) {
      if (!Object.hasOwn(value, i)) failures.push(`${path}: sparse array`);
      else if (schema.items) failures.push(...validateSchema(value[i], schema.items, `${path}[${i}]`, seen));
    }
  } else if (schema.type === 'string') {
    if (typeof value !== 'string') return [`${path}: string required`];
    const body = /\.components\[\d+\]\.text$|\.citations\[\d+\]\.locator\.(scheme|value)$/.test(path);
    if (!isWellFormed(value) || (!body && !isNfc(value))) failures.push(`${path}: well-formed${body ? '' : ' NFC'} required`);
    const maxBytes = schema.maxLength ?? (/\.locator\.(scheme|value)$/.test(path) ? 512 : Infinity);
    if (utf8ByteLength(value) < (schema.minLength ?? 0) || utf8ByteLength(value) > maxBytes) failures.push(`${path}: UTF-8 bounds`);
    if (schema.pattern && !new RegExp(schema.pattern, 'u').test(value)) failures.push(`${path}: pattern mismatch`);
    if (/(_at|occurred_at|observed_at)$/.test(path) && !isValidInstant(value)) failures.push(`${path}: canonical instant required`);
    if (/cursor|sequence/.test(path) && schema.pattern === '^(0|[1-9][0-9]*)$' && !isValidCursor(value)) failures.push(`${path}: unsigned u64 required`);
  } else if (schema.type === 'integer' || schema.type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value) || (schema.type === 'integer' && (!Number.isSafeInteger(value) || Object.is(value, -0)))) return [`${path}: finite safe ${schema.type} required`];
    if (value < (schema.minimum ?? -Infinity) || value > (schema.maximum ?? Infinity)) failures.push(`${path}: numeric bounds`);
  } else if (schema.type === 'boolean' && typeof value !== 'boolean') failures.push(`${path}: boolean required`);
  return failures;
}
