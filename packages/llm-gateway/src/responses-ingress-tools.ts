/**
 * Responses ingress tool collection (spec §16.3, D16-B). Validates
 * top-level and `additional_tools` tool declarations — flat function
 * tools, namespace-wrapped function tools and custom/freeform tools —
 * into canonical definitions plus a native carrier, with globally unique
 * bare names. Shared with the content and assembly modules.
 */

import type {
  ExecutionFeature,
  ResponsesCustomTool,
  ResponsesFunctionToolRef,
  ToolDefinition,
} from '@sentropic/llm-mesh';

export type ResponsesIngressErrorCode = 'bad_request' | 'unsupported_parameter';

/** Typed validation failure with a safe, gateway-built field path. */
export class ResponsesIngressError extends Error {
  readonly fieldPath: string;
  readonly errorCode: ResponsesIngressErrorCode;
  constructor(fieldPath: string, errorCode: ResponsesIngressErrorCode, detail: string) {
    super(`responses ingress: ${fieldPath}: ${detail}`);
    this.name = 'ResponsesIngressError';
    this.fieldPath = fieldPath;
    this.errorCode = errorCode;
  }
}

export type JsonRecord = Record<string, unknown>;
export const asRecord = (value: unknown): JsonRecord | undefined =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : undefined;
export const asArray = (value: unknown): unknown[] | undefined =>
  Array.isArray(value) ? value : undefined;

export const fail = (fieldPath: string, code: ResponsesIngressErrorCode, detail: string): never => {
  throw new ResponsesIngressError(fieldPath, code, detail);
};

export const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);
export const isPositiveInt = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value > 0;

export const EFFORTS = new Set(['none', 'low', 'medium', 'high', 'xhigh', 'max']);
export const SUMMARIES = new Set(['auto', 'concise', 'detailed']);
export const IMAGE_DETAILS = new Set(['auto', 'low', 'high']);
export const INCLUDED = new Set(['reasoning.encrypted_content']);

const METADATA_LIMITS = { keys: 64, valueChars: 4096, idChars: 512 } as const;

export const boundedRecord = (
  value: unknown, fieldPath: string,
): JsonRecord => {
  const record = asRecord(value);
  if (!record) fail(fieldPath, 'bad_request', 'must be an object');
  const entries = Object.entries(record as JsonRecord);
  if (entries.length > METADATA_LIMITS.keys) {
    fail(fieldPath, 'bad_request', `at most ${METADATA_LIMITS.keys} entries`);
  }
  for (const [key, entry] of entries) {
    if (typeof key !== 'string' || key.length === 0 || key.length > 128) {
      fail(fieldPath, 'bad_request', 'keys must be short non-empty strings');
    }
    if (JSON.stringify(entry ?? null).length > METADATA_LIMITS.valueChars) {
      fail(fieldPath, 'bad_request', `value for ${key} is too large`);
    }
  }
  return record as JsonRecord;
};

export const boundedId = (value: unknown, fieldPath: string): string | undefined => {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string' || value.length === 0 || value.length > METADATA_LIMITS.idChars) {
    fail(fieldPath, 'bad_request', 'must be a short string');
  }
  return value as string;
};

export interface CollectedTools {
  readonly definitions: ToolDefinition[];
  readonly refs: ResponsesFunctionToolRef[];
  readonly customTools: ResponsesCustomTool[];
  readonly features: Set<ExecutionFeature>;
  /** Bare name -> namespace (undefined for top-level). */
  readonly namespaces: Map<string, string | undefined>;
}

const collectFunctionTool = (
  tool: JsonRecord, fieldPath: string, namespace: string | undefined,
  collected: CollectedTools,
): void => {
  const name = tool.name;
  if (typeof name !== 'string' || name.length === 0) {
    fail(`${fieldPath}.name`, 'bad_request', 'function tool needs a name');
  }
  const toolName = name as string;
  if (collected.namespaces.has(toolName)) {
    fail(`${fieldPath}.name`, 'bad_request', `duplicate tool name ${JSON.stringify(toolName)}`);
  }
  const parameters = tool.parameters;
  if (parameters !== undefined && !asRecord(parameters)) {
    fail(`${fieldPath}.parameters`, 'bad_request', 'parameters must be an object schema');
  }
  const strict = tool.strict;
  if (strict !== undefined && typeof strict !== 'boolean') {
    fail(`${fieldPath}.strict`, 'bad_request', 'strict must be a boolean');
  }
  if (strict === true) collected.features.add('strict-schema');
  collected.namespaces.set(toolName, namespace);
  collected.definitions.push({
    type: 'function',
    name: toolName,
    ...(typeof tool.description === 'string' ? { description: tool.description } : {}),
    inputSchema: (asRecord(parameters) ?? {}) as ToolDefinition['inputSchema'],
    ...(typeof strict === 'boolean' ? { strict } : {}),
    providerMetadata: { ingress: tool },
  });
  collected.refs.push({
    qualifiedName: namespace ? `${namespace}.${toolName}` : toolName,
    bareName: toolName,
    ...(namespace ? { namespace } : {}),
  });
};

const collectCustomTool = (
  tool: JsonRecord, fieldPath: string, namespace: string | undefined,
  collected: CollectedTools,
): void => {
  const name = tool.name;
  if (typeof name !== 'string' || name.length === 0) {
    fail(`${fieldPath}.name`, 'bad_request', 'custom tool needs a name');
  }
  const toolName = name as string;
  for (const key of Object.keys(tool)) {
    if (!['type', 'name', 'description', 'format'].includes(key)) {
      fail(`${fieldPath}.${key}`, 'unsupported_parameter', 'unsupported custom tool field');
    }
  }
  if (tool.description !== undefined && typeof tool.description !== 'string') {
    fail(`${fieldPath}.description`, 'bad_request', 'description must be a string');
  }
  if (tool.format !== undefined && typeof tool.format !== 'string' && !asRecord(tool.format)) {
    fail(`${fieldPath}.format`, 'bad_request', 'format must be a string or object');
  }
  collected.customTools.push({
    type: 'custom',
    name: toolName,
    ...(typeof tool.description === 'string' ? { description: tool.description } : {}),
    ...(typeof tool.format === 'string' || asRecord(tool.format)
      ? { format: tool.format as ResponsesCustomTool['format'] } : {}),
    ...(namespace ? { namespace } : {}),
    providerMetadata: { ingress: tool },
  });
  collected.features.add('custom-tools');
};

export const collectTools = (
  tools: unknown, fieldPath: string, namespace: string | undefined,
  collected: CollectedTools,
): void => {
  const items = asArray(tools);
  if (!items) fail(fieldPath, 'bad_request', 'tools must be an array');
  (items as unknown[]).forEach((item, index) => {
    const path = `${fieldPath}[${index}]`;
    const tool = asRecord(item);
    if (!tool || typeof tool.type !== 'string') fail(path, 'bad_request', 'tool needs a type');
    const typed = tool as JsonRecord;
    if (typed.type === 'function') {
      collectFunctionTool(typed, path, namespace, collected);
      return;
    }
    if (typed.type === 'namespace') {
      if (typeof typed.name !== 'string' || typed.name.length === 0) {
        fail(`${path}.name`, 'bad_request', 'namespace needs a name');
      }
      collectTools(typed.tools, `${path}.tools`, typed.name as string, collected);
      return;
    }
    if (typed.type === 'custom') {
      collectCustomTool(typed, path, namespace, collected);
      return;
    }
    fail(`${path}.type`, 'unsupported_parameter', `unsupported tool type ${JSON.stringify(typed.type)}`);
  });
};

/** Resolve a call/choice name to its unique bare definition name. */
export const resolveToolName = (
  name: string, fieldPath: string, collected: CollectedTools,
): string => {
  // Bare names are globally unique at declaration; a dotted name resolves
  // through its declaring namespace (`muse.work_list`).
  if (collected.namespaces.has(name)) return name;
  if (name.includes('.')) {
    const matches = [...collected.namespaces.entries()]
      .filter(([bare, namespace]) => namespace !== undefined && `${namespace}.${bare}` === name)
      .map(([bare]) => bare);
    if (matches.length === 1) return matches[0] as string;
  }
  return fail(fieldPath, 'unsupported_parameter', `unknown tool ${JSON.stringify(name)}`);
};
