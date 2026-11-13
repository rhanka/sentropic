/** Portable JSON Schema subset, also consumable by DS and h2a schema validators. */
import { COMPILE_DIAGNOSTIC_CODES, COMPILE_DIAGNOSTIC_STAGES } from './types.js';

export interface CompileJsonSchema {
  type?: 'object' | 'array' | 'string' | 'integer' | 'boolean';
  const?: unknown;
  enum?: readonly unknown[];
  properties?: Record<string, CompileJsonSchema>;
  required?: readonly string[];
  additionalProperties?: boolean | CompileJsonSchema;
  items?: CompileJsonSchema;
  oneOf?: readonly CompileJsonSchema[];
  pattern?: string;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  minimum?: number;
  maximum?: number;
}
const text: CompileJsonSchema = { type: 'string', minLength: 1 };
const hash: CompileJsonSchema = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const path: CompileJsonSchema = { ...text, maxLength: 1024 };
const exactVersion: CompileJsonSchema = { ...text, pattern: '^\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z.-]+)?(?:\\+[0-9A-Za-z.-]+)?$' };
const profile: CompileJsonSchema = { enum: ['browser-vapor', 'browser-vue', 'ssr-module'] };
export const closed = (properties: Record<string, CompileJsonSchema>, optional: string[] = []): CompileJsonSchema =>
  ({ type: 'object', properties, required: Object.keys(properties).filter(k => !optional.includes(k)), additionalProperties: false });
const list = (items: CompileJsonSchema, maxItems = 128, minItems = 0): CompileJsonSchema =>
  ({ type: 'array', items, maxItems, minItems });
const table = (values: CompileJsonSchema): CompileJsonSchema => ({ type: 'object', additionalProperties: values });
const pkg = { name: text, version: exactVersion, sha256: hash };
export const COMPILE_OPTIONS_SCHEMA = closed({
  workspaceMap: table({ oneOf: [
    closed({ mode: { const: 'source' }, exports: table(path) }),
    closed({ mode: { const: 'mirror' }, version: exactVersion, manifestEntryDigest: hash }),
  ] }),
  aliases: list({ oneOf: [
    closed({ kind: { const: 'prefix' }, from: text, to: path }),
    closed({ kind: { const: 'replacement' }, from: text, to: path, profile }),
  ] }),
  extensions: list({ enum: ['.ts', '.js', '.mts', '.mjs', '.vue', '.json', '.css'] }, 7, 1),
  urlRewriteMode: { enum: ['import-map-external', 'resolved-url'] },
  sourcemap: { type: 'boolean' },
});
export const EXECUTION_NODE_V1_COMPILE_RECIPE_SCHEMA = closed({
  recipeVersion: { const: 1 },
  sources: list(closed({ path, bytesBase64: { type: 'string', maxLength: 1398104 } }), 128, 1),
  entry: path, kind: { enum: ['vue-sfc', 'vue-template'] }, profile,
  compilers: list(closed({ ...pkg, role: text }), 32, 1), dsTuple: list(closed(pkg)),
  dependencyLockDigest: hash, importMapManifestDigest: hash, catalogDigest: hash,
  options: COMPILE_OPTIONS_SCHEMA,
  policyVersion: { const: 'compile-policy.v1' }, trustLane: { const: 'isolate-untrusted' },
  accessPartition: { type: 'string', pattern: '^(?:public-v1|private-v1:[^:]+:[^:]+:[a-f0-9]{64})$' },
});
export const COMPILE_OUTPUT_DESCRIPTOR_SCHEMA = closed({
  path, sha256: hash, bytes: { type: 'integer', minimum: 0, maximum: 4194304 },
  mimeType: text, sri: { type: 'string', pattern: '^sha256-[A-Za-z0-9+/]{43}=$' },
  visibility: { enum: ['public', 'private'] },
});
export const COMPILE_OUTPUT_MANIFEST_SCHEMA = closed({
  apiVersion: { const: 1 }, recipeKey: hash, entry: path, css: list(path, 64),
  outputs: list(COMPILE_OUTPUT_DESCRIPTOR_SCHEMA, 64, 1), modules: list(path, 64),
  dependencies: list(closed(pkg)), notices: list(text, 256),
});
export const COMPILE_DIAGNOSTIC_SCHEMA = closed({
  code: { enum: COMPILE_DIAGNOSTIC_CODES }, severity: { enum: ['warning', 'error'] },
  stage: { enum: COMPILE_DIAGNOSTIC_STAGES }, message: { ...text, maxLength: 256 }, path,
  range: closed({ start: { type: 'integer', minimum: 0 }, end: { type: 'integer', minimum: 0 } }),
}, ['path', 'range']);

/** Schema checks shape only. validateCompileRecipe/Manifest also check semantic invariants. */
export function matchesCompileSchema(value: unknown, schema: CompileJsonSchema): boolean {
  if ('const' in schema && value !== schema.const) return false;
  if (schema.enum && !schema.enum.includes(value)) return false;
  if (schema.oneOf && schema.oneOf.filter(s => matchesCompileSchema(value, s)).length !== 1) return false;
  if (schema.type === 'string') {
    if (typeof value !== 'string') return false;
    const length = [...value].length;
    if (length < (schema.minLength ?? 0) || length > (schema.maxLength ?? Infinity)) return false;
    if (schema.pattern && !new RegExp(schema.pattern, 'u').test(value)) return false;
  }
  if (schema.type === 'integer' && (typeof value !== 'number' || !Number.isSafeInteger(value)
    || value < (schema.minimum ?? -Infinity) || value > (schema.maximum ?? Infinity))) return false;
  if (schema.type === 'boolean' && typeof value !== 'boolean') return false;
  if (schema.type === 'array') {
    if (!Array.isArray(value) || value.length < (schema.minItems ?? 0) || value.length > (schema.maxItems ?? Infinity)) return false;
    if (schema.items && !value.every(v => matchesCompileSchema(v, schema.items!))) return false;
  }
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const record = value as Record<string, unknown>;
    if (schema.required?.some(k => !Object.hasOwn(record, k))) return false;
    for (const key of Object.keys(record)) {
      const child = Object.hasOwn(schema.properties ?? {}, key) ? schema.properties![key] : schema.additionalProperties;
      if (child === false || (typeof child === 'object' && !matchesCompileSchema(record[key], child))) return false;
    }
  }
  return true;
}
