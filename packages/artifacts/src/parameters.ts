/**
 * L-5a — provider parameter schema and validation (spec-v8 §9).
 *
 * Generic, non-secret provider settings: each declaration names a key, its
 * type and whether it is required or defaulted. Validation applies defaults
 * and rejects unknown keys, wrong types, missing required values and
 * secret-looking keys fail-closed — provider parameters are never a secret
 * store. Schemas are independent values; no global bag is shared.
 */
import type { JsonValue } from './contracts.js';

export type ParameterType = 'string' | 'number' | 'boolean' | 'enum';

export interface ParameterDeclaration {
  key: string;
  type: ParameterType;
  required?: boolean;
  default?: JsonValue;
  values?: string[];
  description?: string;
}

export interface ParameterSchema {
  declarations: ParameterDeclaration[];
}

/** Keys that look like secrets are refused anywhere in validated values. */
const SECRET_KEY_PATTERN = /(secret|token|password|private[_-]?key|api[_-]?key)/i;

/** Declare a parameter schema; rejects duplicates and empty declarations. */
export function defineParameters(declarations: ParameterDeclaration[]): ParameterSchema {
  const seen = new Set<string>();
  for (const decl of declarations) {
    if (typeof decl.key !== 'string' || decl.key.length === 0) {
      throw new Error('invalid parameter declaration: empty key');
    }
    if (seen.has(decl.key)) {
      throw new Error(`invalid parameter declaration: duplicate key ${decl.key}`);
    }
    seen.add(decl.key);
    if (decl.type === 'enum' && (!Array.isArray(decl.values) || decl.values.length === 0)) {
      throw new Error(`invalid parameter declaration: enum ${decl.key} needs values`);
    }
  }
  return { declarations: [...declarations] };
}

function checkType(decl: ParameterDeclaration, value: JsonValue): boolean {
  switch (decl.type) {
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number';
    case 'boolean':
      return typeof value === 'boolean';
    case 'enum':
      return typeof value === 'string' && (decl.values ?? []).includes(value);
  }
}

/**
 * Validate values against a schema: apply defaults, reject unknown keys,
 * wrong types, missing required values and secret-looking keys.
 */
export function validateParameters(
  schema: ParameterSchema,
  values: Record<string, JsonValue | undefined>,
): Record<string, JsonValue> {
  for (const key of Object.keys(values)) {
    if (SECRET_KEY_PATTERN.test(key)) {
      throw new Error(`invalid parameters: secret-looking key refused: ${key}`);
    }
  }
  const known = new Map(schema.declarations.map((d) => [d.key, d]));
  for (const key of Object.keys(values)) {
    if (values[key] !== undefined && !known.has(key)) {
      throw new Error(`invalid parameters: unknown parameter ${key}`);
    }
  }
  const out: Record<string, JsonValue> = {};
  for (const decl of schema.declarations) {
    const value = values[decl.key];
    if (value === undefined) {
      if (decl.required) {
        throw new Error(`invalid parameters: missing required parameter ${decl.key}`);
      }
      if (decl.default !== undefined) out[decl.key] = decl.default;
      continue;
    }
    if (!checkType(decl, value)) {
      throw new Error(`invalid parameters: wrong type for ${decl.key}`);
    }
    out[decl.key] = value;
  }
  return out;
}
