/**
 * Lot L-1b-core RC-M2(c) — dependency-free bounded 2020-12 parameter profile.
 *
 * Profile `sentropic.parameters/2020-12-bounded-v1`: closed keyword set, the
 * single admitted safe pattern literal, work budgets, const/enum/defaults and
 * a frozen validator-port seam. Pure and synchronous; no regex runtime beyond
 * one fixed precompiled linear-time expression, no JSON Schema library.
 */

import type { ToolConfigurationDiagnostic } from './tool-configuration.js';

export const BOUNDED_PROFILE_ID = 'sentropic.parameters/2020-12-bounded-v1';

/** The only admitted pattern literal (profile v1). Fixed and linear-time. */
export const SAFE_PATTERN_LITERAL = '^[a-z0-9][a-z0-9._-]*$';

// Single character class plus one star: no nesting, no alternation, linear.
const SAFE_PATTERN = /^[a-z0-9][a-z0-9._-]*$/u;

const MAX_JSON_BYTES = 65536;
const MAX_DEPTH = 16;
const MAX_NODES = 2048;
const MAX_PROPERTIES = 128;
const MAX_ENUM_MEMBERS = 128;
const MAX_ARRAY_ITEMS = 1024;
const MAX_STRING_LENGTH = 65536;

const ASSERTION_KEYWORDS = new Set([
  'type',
  'const',
  'enum',
  'properties',
  'required',
  'additionalProperties',
  'items',
  'minimum',
  'maximum',
  'minLength',
  'maxLength',
  'minItems',
  'maxItems',
  'pattern',
]);

const ANNOTATION_KEYWORDS = new Set(['$schema', '$id', 'title', 'description', 'default']);

const JSON_TYPES = new Set(['object', 'array', 'string', 'integer', 'number', 'boolean', 'null']);

export type BoundedDiagnostic = ToolConfigurationDiagnostic;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function diag(
  diagnostics: BoundedDiagnostic[],
  code: 'unsupported_schema_profile' | 'invalid_parameters',
  path: string,
  message: string,
): void {
  diagnostics.push({ code: code as BoundedDiagnostic['code'], path, message });
}

function jsonByteSize(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value) ?? '').length;
}

function isJsonValue(value: unknown, depth: number): boolean {
  if (depth > MAX_DEPTH) return false;
  if (value === null) return true;
  const kind = typeof value;
  if (kind === 'boolean' || kind === 'string') return true;
  if (kind === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) {
    return value.length <= MAX_ARRAY_ITEMS && value.every((entry) => isJsonValue(entry, depth + 1));
  }
  if (kind === 'object') {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record);
    return keys.length <= MAX_PROPERTIES && keys.every((key) => isJsonValue(record[key], depth + 1));
  }
  return false;
}

// ---------------------------------------------------------------------------
// Schema validation
// ---------------------------------------------------------------------------

type SchemaState = {
  diagnostics: BoundedDiagnostic[];
  nodes: number;
};

function checkSchemaNode(schema: unknown, path: string, depth: number, state: SchemaState): void {
  state.nodes += 1;
  if (state.nodes > MAX_NODES) {
    diag(state.diagnostics, 'unsupported_schema_profile', path, 'schema exceeds the node budget');
    return;
  }
  if (depth > MAX_DEPTH) {
    diag(state.diagnostics, 'unsupported_schema_profile', path, 'schema exceeds the depth budget');
    return;
  }
  if (!isRecord(schema)) {
    diag(state.diagnostics, 'unsupported_schema_profile', path, 'schema nodes must be objects');
    return;
  }
  for (const key of Object.keys(schema)) {
    if (!ASSERTION_KEYWORDS.has(key) && !ANNOTATION_KEYWORDS.has(key)) {
      diag(state.diagnostics, 'unsupported_schema_profile', `${path}.${key}`, 'unsupported keyword');
    }
  }
  const type = schema['type'];
  if (type !== undefined && (typeof type !== 'string' || !JSON_TYPES.has(type))) {
    diag(state.diagnostics, 'unsupported_schema_profile', `${path}.type`, 'unknown schema type');
    return;
  }
  if (schema['enum'] !== undefined) {
    if (!Array.isArray(schema['enum']) || schema['enum'].length === 0 || schema['enum'].length > MAX_ENUM_MEMBERS) {
      diag(state.diagnostics, 'unsupported_schema_profile', `${path}.enum`, 'enum must list 1-128 members');
    } else if (!isJsonValue(schema['enum'], depth)) {
      diag(state.diagnostics, 'unsupported_schema_profile', `${path}.enum`, 'enum members must be JSON values');
    }
  }
  if (schema['const'] !== undefined && !isJsonValue(schema['const'], depth)) {
    diag(state.diagnostics, 'unsupported_schema_profile', `${path}.const`, 'const must be a JSON value');
  }
  if (type === 'object' || (type === undefined && schema['properties'] !== undefined)) {
    checkObjectKeywords(schema, path, depth, state);
  }
  if (type === 'array' || (type === undefined && schema['items'] !== undefined)) {
    checkArrayKeywords(schema, path, depth, state);
  }
  if (type === 'string') checkStringKeywords(schema, path, state);
  if (type === 'number' || type === 'integer') checkNumberKeywords(schema, path, state);
  if (type === 'boolean' || type === 'null') {
    for (const key of ['properties', 'required', 'additionalProperties', 'items', 'minimum', 'maximum', 'minLength', 'maxLength', 'minItems', 'maxItems', 'pattern'] as const) {
      if (schema[key] !== undefined) {
        diag(state.diagnostics, 'unsupported_schema_profile', `${path}.${key}`, 'keyword does not apply to this type');
      }
    }
  }
}

function checkObjectKeywords(schema: Record<string, unknown>, path: string, depth: number, state: SchemaState): void {
  if (!isRecord(schema['properties'])) {
    diag(state.diagnostics, 'unsupported_schema_profile', `${path}.properties`, 'objects require a properties record');
    return;
  }
  const names = Object.keys(schema['properties']);
  if (names.length > MAX_PROPERTIES) {
    diag(state.diagnostics, 'unsupported_schema_profile', `${path}.properties`, 'object exceeds the property budget');
  }
  if (schema['additionalProperties'] !== false) {
    diag(state.diagnostics, 'unsupported_schema_profile', `${path}.additionalProperties`, 'objects must forbid additional properties');
  }
  if (schema['required'] !== undefined) {
    if (!Array.isArray(schema['required']) || !schema['required'].every((name) => typeof name === 'string')) {
      diag(state.diagnostics, 'unsupported_schema_profile', `${path}.required`, 'required must list property names');
    } else {
      for (const name of schema['required'] as string[]) {
        if ((schema['properties'] as Record<string, unknown>)[name] === undefined) {
          diag(state.diagnostics, 'unsupported_schema_profile', `${path}.required`, 'required names must exist in properties');
        }
      }
      if (new Set(schema['required'] as string[]).size !== (schema['required'] as string[]).length) {
        diag(state.diagnostics, 'unsupported_schema_profile', `${path}.required`, 'required names must be unique');
      }
    }
  }
  for (const name of names) {
    checkSchemaNode((schema['properties'] as Record<string, unknown>)[name], `${path}.properties.${name}`, depth + 1, state);
  }
}

function finiteBound(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function checkArrayKeywords(schema: Record<string, unknown>, path: string, depth: number, state: SchemaState): void {
  if (schema['items'] === undefined) {
    diag(state.diagnostics, 'unsupported_schema_profile', `${path}.items`, 'arrays require one item schema');
  } else {
    checkSchemaNode(schema['items'], `${path}.items`, depth + 1, state);
  }
  for (const key of ['minItems', 'maxItems'] as const) {
    const bound = schema[key];
    if (!Number.isInteger(bound) || (bound as number) < 0) {
      diag(state.diagnostics, 'unsupported_schema_profile', `${path}.${key}`, 'array bounds must be finite integers');
    }
  }
  const min = schema['minItems'] as number | undefined;
  const max = schema['maxItems'] as number | undefined;
  if (Number.isInteger(min) && Number.isInteger(max) && (min as number) > (max as number)) {
    diag(state.diagnostics, 'unsupported_schema_profile', path, 'minItems exceeds maxItems');
  }
}

function checkStringKeywords(schema: Record<string, unknown>, path: string, state: SchemaState): void {
  for (const key of ['minLength', 'maxLength'] as const) {
    const bound = schema[key];
    if (!Number.isInteger(bound) || (bound as number) < 0) {
      diag(state.diagnostics, 'unsupported_schema_profile', `${path}.${key}`, 'string bounds must be finite integers');
      return;
    }
  }
  const min = schema['minLength'] as number | undefined;
  const max = schema['maxLength'] as number | undefined;
  if (min === undefined || max === undefined || min > max) {
    diag(state.diagnostics, 'unsupported_schema_profile', path, 'strings require minLength/maxLength with min <= max');
  }
  if (schema['pattern'] !== undefined && schema['pattern'] !== SAFE_PATTERN_LITERAL) {
    diag(state.diagnostics, 'unsupported_schema_profile', `${path}.pattern`, 'only the fixed safe pattern literal is admitted');
  }
}

function checkNumberKeywords(schema: Record<string, unknown>, path: string, state: SchemaState): void {
  const min = schema['minimum'];
  const max = schema['maximum'];
  if (!finiteBound(min) || !finiteBound(max) || min > max) {
    diag(state.diagnostics, 'unsupported_schema_profile', path, 'numbers require finite minimum/maximum with min <= max');
  }
}

/** Validate a configuration schema against the bounded profile. */
export function validateBoundedSchema(schema: unknown): BoundedDiagnostic[] {
  const state: SchemaState = { diagnostics: [], nodes: 0 };
  if (!isRecord(schema)) {
    diag(state.diagnostics, 'unsupported_schema_profile', 'schema', 'schema must be an object');
    return state.diagnostics;
  }
  if (jsonByteSize(schema) > MAX_JSON_BYTES) {
    diag(state.diagnostics, 'unsupported_schema_profile', 'schema', 'schema exceeds the byte budget');
    return state.diagnostics;
  }
  checkSchemaNode(schema, 'schema', 0, state);
  return state.diagnostics;
}

// ---------------------------------------------------------------------------
// Value validation
// ---------------------------------------------------------------------------

function deepEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (typeof left === 'number' && typeof right === 'number') return left === right;
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((entry, index) => deepEqual(entry, right[index]));
  }
  if (isRecord(left) && isRecord(right)) {
    const leftKeys = Object.keys(left);
    return leftKeys.length === Object.keys(right).length && leftKeys.every((key) => deepEqual(left[key], right[key]));
  }
  return false;
}

function checkBoundedValue(schema: Record<string, unknown>, value: unknown, path: string, depth: number, diagnostics: BoundedDiagnostic[]): void {
  if (depth > MAX_DEPTH) {
    diag(diagnostics, 'invalid_parameters', path, 'value exceeds the depth budget');
    return;
  }
  const type = schema['type'] as string | undefined;
  if (type === 'object') {
    if (!isRecord(value)) {
      diag(diagnostics, 'invalid_parameters', path, 'expected an object value');
      return;
    }
    const properties = schema['properties'] as Record<string, unknown>;
    for (const key of Object.keys(value)) {
      if (properties[key] === undefined) {
        diag(diagnostics, 'invalid_parameters', `${path}.${key}`, 'unknown property');
      }
    }
    for (const name of (schema['required'] as string[] | undefined) ?? []) {
      if (value[name] === undefined) {
        diag(diagnostics, 'invalid_parameters', `${path}.${name}`, 'missing required property');
      }
    }
    for (const name of Object.keys(properties)) {
      if (value[name] !== undefined) {
        checkBoundedValue(properties[name] as Record<string, unknown>, value[name], `${path}.${name}`, depth + 1, diagnostics);
      }
    }
    return;
  }
  if (type === 'array') {
    if (!Array.isArray(value)) {
      diag(diagnostics, 'invalid_parameters', path, 'expected an array value');
      return;
    }
    if (value.length < (schema['minItems'] as number) || value.length > Math.min(schema['maxItems'] as number, MAX_ARRAY_ITEMS)) {
      diag(diagnostics, 'invalid_parameters', path, 'array length out of bounds');
      return;
    }
    value.forEach((entry, index) => {
      checkBoundedValue(schema['items'] as Record<string, unknown>, entry, `${path}[${index}]`, depth + 1, diagnostics);
    });
    return;
  }
  if (type === 'string') {
    if (typeof value !== 'string') {
      diag(diagnostics, 'invalid_parameters', path, 'expected a string value');
      return;
    }
    if (value.length < (schema['minLength'] as number) || value.length > Math.min(schema['maxLength'] as number, MAX_STRING_LENGTH)) {
      diag(diagnostics, 'invalid_parameters', path, 'string length out of bounds');
      return;
    }
    if (schema['pattern'] !== undefined && !SAFE_PATTERN.test(value)) {
      diag(diagnostics, 'invalid_parameters', path, 'string does not match the safe pattern');
    }
    return;
  }
  if (type === 'integer' || type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value) || (type === 'integer' && !Number.isInteger(value))) {
      diag(diagnostics, 'invalid_parameters', path, 'expected a finite numeric value');
      return;
    }
    if (value < (schema['minimum'] as number) || value > (schema['maximum'] as number)) {
      diag(diagnostics, 'invalid_parameters', path, 'number out of bounds');
    }
    return;
  }
  if (type === 'boolean') {
    if (typeof value !== 'boolean') {
      diag(diagnostics, 'invalid_parameters', path, 'expected a boolean value');
    }
    return;
  }
  if (type === 'null') {
    if (value !== null) {
      diag(diagnostics, 'invalid_parameters', path, 'expected null');
    }
    return;
  }
  if (schema['const'] !== undefined && !deepEqual(value, schema['const'])) {
    diag(diagnostics, 'invalid_parameters', path, 'value does not equal const');
    return;
  }
  if (schema['enum'] !== undefined && !(schema['enum'] as unknown[]).some((member) => deepEqual(value, member))) {
    diag(diagnostics, 'invalid_parameters', path, 'value is not an allowed enum member');
  }
}

/** Validate JSON values against a bounded-profile schema. */
export function validateBoundedValue(schema: unknown, values: unknown): BoundedDiagnostic[] {
  const diagnostics: BoundedDiagnostic[] = [];
  if (jsonByteSize(values) > MAX_JSON_BYTES) {
    diag(diagnostics, 'invalid_parameters', 'values', 'values exceed the byte budget');
    return diagnostics;
  }
  const schemaProblems = validateBoundedSchema(schema);
  if (schemaProblems.length > 0) return schemaProblems;
  checkBoundedValue(schema as Record<string, unknown>, values, 'values', 0, diagnostics);
  return diagnostics;
}

/** Fill missing declared properties from defaults without mutating inputs. */
export function withDefaults(
  schema: Record<string, unknown>,
  values: Record<string, unknown>,
  defaults: Record<string, unknown>,
): Record<string, unknown> {
  const properties = (schema['properties'] ?? {}) as Record<string, unknown>;
  const merged: Record<string, unknown> = { ...values };
  for (const key of Object.keys(defaults)) {
    if (merged[key] === undefined && properties[key] !== undefined) {
      merged[key] = defaults[key];
    }
  }
  return merged;
}

// ---------------------------------------------------------------------------
// Frozen validator-port seam
// ---------------------------------------------------------------------------

/** Host-supplied validator for a future qualified profile. */
export type ValidatorPort = {
  profileId: string;
  validate: (schema: unknown, values: unknown) => BoundedDiagnostic[];
};

export type ValidatorPorts = {
  get(profileId: string): ValidatorPort;
  register(port: ValidatorPort): void;
};

/** Create the frozen port registry with the builtin bounded profile. */
export function createValidatorPorts(): ValidatorPorts {
  const ports = new Map<string, ValidatorPort>();
  const builtin: ValidatorPort = {
    profileId: BOUNDED_PROFILE_ID,
    validate: (schema, values) => validateBoundedValue(schema, values),
  };
  ports.set(BOUNDED_PROFILE_ID, builtin);
  const registry: ValidatorPorts = {
    get(profileId: string): ValidatorPort {
      const port = ports.get(profileId);
      if (port === undefined) {
        throw new Error(`unsupported validator profile: ${profileId}`);
      }
      return port;
    },
    register(port: ValidatorPort): void {
      if (typeof port?.profileId !== 'string' || typeof port?.validate !== 'function') {
        throw new Error('validator ports require a profileId and validate function');
      }
      if (ports.has(port.profileId)) {
        throw new Error(`duplicate validator profile: ${port.profileId}`);
      }
      ports.set(port.profileId, port);
    },
  };
  return Object.freeze(registry);
}
