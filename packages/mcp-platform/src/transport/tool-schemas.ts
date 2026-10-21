import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv-provider.js';
import type { JsonSchemaType } from '@modelcontextprotocol/sdk/validation/types.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { applyMcpDefaults, assertMcpJson, freezeMcpJson, validateMcpLimits } from './tool-json.js';
import type { McpToolValidationLimits } from './tool-json.js';

export type { McpToolValidationLimits } from './tool-json.js';
export interface McpToolDiagnostic { readonly path: string; readonly message: string }
export type McpToolValidation =
  | { readonly valid: true; readonly data: Record<string, unknown> }
  | { readonly valid: false; readonly diagnostics: readonly McpToolDiagnostic[] };
export interface CompiledMcpToolSchemas {
  validate(name: string, args: unknown): McpToolValidation;
}

const keywords = new Set(['$schema', '$id', '$comment', 'title', 'description', 'default',
  'type', 'properties', 'required', 'additionalProperties', 'items', 'additionalItems',
  'minItems', 'maxItems', 'uniqueItems', 'minLength', 'maxLength', 'pattern', 'format',
  'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf',
  'enum', 'const', 'allOf', 'anyOf', 'oneOf', 'not', 'if', 'then', 'else',
  'minProperties', 'maxProperties', 'definitions', 'examples', 'readOnly', 'writeOnly']);
const formats = new Set(['date', 'time', 'date-time', 'duration', 'uri', 'uri-reference',
  'uri-template', 'url', 'email', 'hostname', 'ipv4', 'ipv6', 'regex', 'uuid', 'json-pointer',
  'relative-json-pointer', 'byte', 'int32', 'int64', 'float', 'double', 'password', 'binary']);

function checkSchema(schema: unknown, path: string): void {
  if (typeof schema === 'boolean') return;
  if (typeof schema !== 'object' || schema === null || Array.isArray(schema)) {
    throw new TypeError(`${path}: schema must be an object or boolean`);
  }
  for (const [key, value] of Object.entries(schema)) {
    const at = `${path}/${key}`;
    if (!keywords.has(key)) throw new TypeError(`${at}: unsupported schema keyword`);
    if (key === 'format' && (typeof value !== 'string' || !formats.has(value))) {
      throw new TypeError(`${at}: unsupported schema format`);
    }
    if (key === '$schema' && value !== 'http://json-schema.org/draft-07/schema#'
      && value !== 'https://json-schema.org/draft-07/schema#') {
      throw new TypeError(`${at}: unsupported schema dialect`);
    }
    if (key === 'properties' || key === 'definitions') {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new TypeError(`${at}: expected schema map`);
      }
      for (const [name, child] of Object.entries(value)) checkSchema(child, `${at}/${name}`);
    } else if (['allOf', 'anyOf', 'oneOf'].includes(key) || (key === 'items' && Array.isArray(value))) {
      if (!Array.isArray(value)) throw new TypeError(`${at}: expected schemas`);
      value.forEach((child, i) => checkSchema(child, `${at}/${i}`));
    } else if (['items', 'additionalItems', 'additionalProperties', 'not', 'if', 'then', 'else'].includes(key)) {
      checkSchema(value, at);
    }
  }
}

/** Compile original draft-07 schemas once; never mutate discovery or caller values. */
export function compileMcpToolSchemas(
  tools: readonly Tool[], limits: McpToolValidationLimits,
): CompiledMcpToolSchemas {
  validateMcpLimits(limits);
  const budget = Object.freeze({ ...limits });
  const sdk = new AjvJsonSchemaValidator();
  const entries = new Map<string, {
    schema: Tool['inputSchema'];
    validate: ReturnType<typeof sdk.getValidator<Record<string, unknown>>>;
  }>();
  for (const tool of tools) {
    if (entries.has(tool.name)) throw new TypeError(`${tool.name}: duplicate tool`);
    assertMcpJson(tool.inputSchema, budget.maxSchemaBytes, budget.maxSchemaDepth);
    checkSchema(tool.inputSchema, tool.name);
    const schema = freezeMcpJson(structuredClone(tool.inputSchema));
    try {
      const validate = sdk.getValidator<Record<string, unknown>>(schema as JsonSchemaType);
      entries.set(tool.name, { schema, validate });
    } catch {
      throw new TypeError(`${tool.name}/inputSchema: invalid draft-07 schema`);
    }
  }
  return Object.freeze({
    validate(name: string, args: unknown): McpToolValidation {
      const entry = entries.get(name);
      if (!entry) return { valid: false, diagnostics: [{ path: name, message: 'Unknown tool' }] };
      try {
        assertMcpJson(args, budget.maxArgumentBytes, budget.maxArgumentDepth);
        if (typeof args !== 'object' || args === null || Array.isArray(args)) throw new TypeError();
        const data = applyMcpDefaults(entry.schema, structuredClone(args));
        assertMcpJson(data, budget.maxArgumentBytes, budget.maxArgumentDepth);
        const checked = entry.validate(data);
        if (checked.valid) return { valid: true, data: checked.data };
      } catch { /* Public diagnostics never include caller values or executable schema text. */ }
      return { valid: false, diagnostics: [{ path: name, message: 'Invalid tool arguments or JSON budget' }] };
    },
  });
}
