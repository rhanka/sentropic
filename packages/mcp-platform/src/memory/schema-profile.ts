import { assertMcpJson } from '../transport/tool-json.js';
import { validateSchema } from './schema-validation.js';

const keywords = new Set(['$schema', '$id', 'title', 'description', 'default', 'type', 'const', 'enum',
  'properties', 'required', 'additionalProperties', 'items', 'minimum', 'maximum', 'minLength',
  'maxLength', 'minItems', 'maxItems', 'uniqueItems', 'pattern', 'oneOf']);
// M2's reviewed publisher patterns, never arbitrary caller-supplied regular expressions.
const patterns = new Set(['^sha256:[0-9a-f]{64}$', '^mem_[a-z2-7]+$', '^(0|[1-9][0-9]*)$',
  '^(/([^/~]|~[01])*)*$', '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$']);
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
function invalid(): never { throw new TypeError('Unsupported memory schema profile'); }

/** Admit the closed, self-contained memory dialect before a provider can acquire resources. */
export function admitMemorySchema(schema: unknown): void {
  assertMcpJson(schema, 1048576, 64);
  function visit(s: unknown): void {
    if (!record(s) || Object.keys(s).some(key => !keywords.has(key))) invalid();
    if (s.$schema !== undefined && s.$schema !== 'https://json-schema.org/draft/2020-12/schema') invalid();
    if (s.type !== undefined && !['object', 'array', 'string', 'integer', 'number', 'boolean', 'null'].includes(s.type as string)) invalid();
    if (s.type === undefined && s.const === undefined && s.enum === undefined && s.oneOf === undefined) invalid();
    if (s.pattern !== undefined && !patterns.has(s.pattern as string)) invalid();
    for (const key of ['minimum', 'maximum', 'minLength', 'maxLength', 'minItems', 'maxItems']) {
      const value = s[key];
      if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value) ||
        (/Length|Items/.test(key) && (!Number.isSafeInteger(value) || value < 0)))) invalid();
    }
    if (s.enum !== undefined && (!Array.isArray(s.enum) || s.enum.length === 0)) invalid();
    if (s.uniqueItems !== undefined && typeof s.uniqueItems !== 'boolean') invalid();
    if (s.additionalProperties !== undefined && s.additionalProperties !== false) invalid();
    if (s.type === 'object' && (s.additionalProperties !== false || !record(s.properties))) invalid();
    if (s.properties !== undefined) {
      if (!record(s.properties)) invalid();
      Object.values(s.properties).forEach(visit);
    }
    if (s.required !== undefined && (!Array.isArray(s.required) || s.required.some(key =>
      typeof key !== 'string' || !record(s.properties) || !Object.hasOwn(s.properties, key)))) invalid();
    if (s.type === 'array' && s.items === undefined) invalid();
    if (s.items !== undefined) visit(s.items);
    if (s.oneOf !== undefined) {
      if (!Array.isArray(s.oneOf) || s.oneOf.length < 1) invalid();
      s.oneOf.forEach(visit);
    }
  }
  visit(schema);
}

/** Apply the admitted assertions and Engram's NFC/UTF-8/u64/instant checks before effect. */
export function validateMemoryArguments(schema: unknown, value: unknown): string[] {
  try {
    assertMcpJson(value, 1048576, 64);
    return validateSchema(value, schema);
  } catch { return ['$: invalid memory JSON']; }
}
