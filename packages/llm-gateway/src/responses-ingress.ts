/**
 * Strict Responses ingress codec (spec §16.3, D16-B). Validates a stateless
 * Responses request body and normalizes it losslessly to a canonical mesh
 * request plus capability and execution-feature requirements.
 *
 * Selected by `normalizeGatewayIngress` for the `openai-responses` wire —
 * never feed `input` through the permissive Chat `raw.messages` parser.
 * Pinned CLI captures (muse-1.4.6, codex-0.162.1) define the supported
 * shapes; unsupported stateful/hosted fields fail explicitly with a safe
 * field path before acquisition. Feature requirements are derived from
 * validated input, never from a caller-supplied feature list.
 *
 * Tool collection lives in `responses-ingress-tools.js`, content mapping
 * in `responses-ingress-content.js`; this module holds request controls
 * and assembly.
 */

import type {
  CapabilityRequirement,
  ExecutionFeature,
  GenerateRequest,
  JsonObjectSchema,
  LlmMeshMessage,
  ResponsesNativeRequestCarrier,
  ResponseFormat,
  ToolChoice,
} from '@sentropic/llm-mesh';

import {
  asArray,
  asRecord,
  boundedId,
  boundedRecord,
  collectTools,
  EFFORTS,
  fail,
  INCLUDED,
  isFiniteNumber,
  isPositiveInt,
  SUMMARIES,
  type CollectedTools,
  type JsonRecord,
  resolveToolName,
} from './responses-ingress-tools.js';
import { mapInputItem, type MappedInput } from './responses-ingress-content.js';
import {
  DEFAULT_RESPONSES_LIMITS,
  type ResponsesLimits,
} from './responses-egress.js';

export type { ResponsesIngressErrorCode } from './responses-ingress-tools.js';
export { ResponsesIngressError } from './responses-ingress-tools.js';

export interface ResponsesIngressResult {
  readonly request: GenerateRequest;
  readonly requiredCapabilities: readonly CapabilityRequirement[];
  readonly requiredExecutionFeatures: readonly ExecutionFeature[];
}

const mapToolChoice = (
  value: unknown, collected: CollectedTools, features: Set<ExecutionFeature>,
): ToolChoice | undefined => {
  if (value === undefined) return undefined;
  if (value === 'auto' || value === 'none' || value === 'required') return value;
  const record = asRecord(value);
  if (record?.type === 'function' && typeof record.name === 'string') {
    const name = resolveToolName(record.name, 'tool_choice.name', collected);
    features.add('named-tool-choice');
    return { type: 'tool', name };
  }
  return fail('tool_choice', 'bad_request', 'tool_choice must be auto, none, required or a function name');
};

const mapReasoning = (
  value: unknown, features: Set<ExecutionFeature>,
): { reasoning?: GenerateRequest['reasoning']; context?: string } => {
  if (value === undefined) return {};
  const record = asRecord(value);
  if (!record) fail('reasoning', 'bad_request', 'reasoning must be an object');
  const typed = record as JsonRecord;
  const out: NonNullable<GenerateRequest['reasoning']> = {};
  let present = false;
  if (typed.effort !== undefined) {
    if (typeof typed.effort !== 'string' || !EFFORTS.has(typed.effort)) {
      fail('reasoning.effort', 'bad_request', 'effort must be none, low, medium, high, xhigh or max');
    }
    out.effort = typed.effort as NonNullable<GenerateRequest['reasoning']>['effort'];
    present = true;
  }
  if (typed.summary !== undefined) {
    if (typeof typed.summary !== 'string' || !SUMMARIES.has(typed.summary)) {
      fail('reasoning.summary', 'bad_request', 'summary must be auto, concise or detailed');
    }
    out.summary = typed.summary as NonNullable<GenerateRequest['reasoning']>['summary'];
    present = true;
  }
  if (present) features.add('reasoning-controls');
  let context: string | undefined;
  if (typed.context !== undefined) {
    if (typeof typed.context !== 'string') fail('reasoning.context', 'bad_request', 'context must be a string');
    context = typed.context as string;
    features.add('reasoning-context');
  }
  for (const key of Object.keys(typed)) {
    if (!['effort', 'summary', 'context'].includes(key)) {
      fail(`reasoning.${key}`, 'unsupported_parameter', 'unsupported reasoning field');
    }
  }
  return { ...(present ? { reasoning: out } : {}), ...(context ? { context } : {}) };
};

const mapTextFormat = (
  value: unknown, features: Set<ExecutionFeature>,
): { format?: ResponseFormat; verbosity?: string } => {
  if (value === undefined) return {};
  const record = asRecord(value);
  if (!record) fail('text', 'bad_request', 'text must be an object');
  const typed = record as JsonRecord;
  let format: ResponseFormat | undefined;
  if (typed.format !== undefined) {
    const formatRecord = asRecord(typed.format);
    if (!formatRecord || typeof formatRecord.type !== 'string') {
      fail('text.format', 'bad_request', 'format needs a type');
    }
    const formatBody = formatRecord as JsonRecord;
    const kind = formatBody.type as string;
    if (kind === 'text') {
      format = { type: 'text' };
    } else if (kind === 'json_object') {
      format = { type: 'json-object' };
      features.add('structured-output');
    } else if (kind === 'json_schema') {
      if (typeof formatBody.name !== 'string' || !asRecord(formatBody.schema)) {
        fail('text.format', 'bad_request', 'json_schema needs a name and schema object');
      }
      const strict = formatBody.strict;
      if (strict !== undefined && typeof strict !== 'boolean') {
        fail('text.format.strict', 'bad_request', 'strict must be a boolean');
      }
      if (strict === true) features.add('strict-schema');
      format = {
        type: 'json-schema',
        name: formatBody.name as string,
        schema: formatBody.schema as JsonObjectSchema,
        ...(typeof formatBody.description === 'string' ? { description: formatBody.description } : {}),
        ...(typeof strict === 'boolean' ? { strict } : {}),
      };
      features.add('structured-output');
    } else {
      fail('text.format', 'unsupported_parameter', `unsupported format ${JSON.stringify(kind)}`);
    }
  }
  let verbosity: string | undefined;
  if (typed.verbosity !== undefined) {
    if (typeof typed.verbosity !== 'string') fail('text.verbosity', 'bad_request', 'verbosity must be a string');
    verbosity = typed.verbosity as string;
    features.add('verbosity');
  }
  for (const key of Object.keys(typed)) {
    if (!['format', 'verbosity'].includes(key)) {
      fail(`text.${key}`, 'unsupported_parameter', 'unsupported text field');
    }
  }
  return { ...(format ? { format } : {}), ...(verbosity ? { verbosity } : {}) };
};

const TOP_LEVEL_KEYS = new Set([
  'model', 'stream', 'input', 'instructions', 'tools', 'tool_choice', 'parallel_tool_calls',
  'max_output_tokens', 'temperature', 'top_p', 'reasoning', 'text', 'include', 'metadata',
  'prompt_cache_key', 'safety_identifier', 'client_metadata', 'store', 'background',
  'truncation', 'previous_response_id', 'conversation',
]);

export const normalizeResponsesIngress = (
  body: unknown,
  limits: ResponsesLimits = DEFAULT_RESPONSES_LIMITS,
): ResponsesIngressResult => {
  const raw = asRecord(body);
  if (!raw) fail('body', 'bad_request', 'request must be a JSON object');
  const root = raw as JsonRecord;
  const model = root.model;
  if (typeof model !== 'string' || model.length === 0) fail('model', 'bad_request', 'model must be set');
  for (const key of Object.keys(root)) {
    if (!TOP_LEVEL_KEYS.has(key)) fail(key, 'unsupported_parameter', 'unsupported request field');
  }

  const stream = root.stream;
  if (stream !== undefined && typeof stream !== 'boolean') {
    fail('stream', 'bad_request', 'stream must be a boolean');
  }

  const collected: CollectedTools = {
    definitions: [], refs: [], customTools: [],
    features: new Set(), namespaces: new Map(),
  };
  if (root.tools !== undefined) collectTools(root.tools, 'tools', undefined, collected);
  if (collected.definitions.length + collected.customTools.length > limits.maxTools) {
    fail('tools', 'bad_request', `at most ${limits.maxTools} tools are served`);
  }

  if (root.input === undefined) fail('input', 'bad_request', 'input must be set');
  const messages: LlmMeshMessage[] = [];
  if (typeof root.instructions === 'string') {
    messages.push({ role: 'system', content: root.instructions, metadata: { ingress: 'instructions' } });
  } else if (root.instructions !== undefined) {
    fail('instructions', 'bad_request', 'instructions must be a string');
  }
  const mapped: MappedInput = {
    messages, calls: new Map(), artifacts: [], itemIds: [], hasImage: false, hasTools: false,
  };
  if (typeof root.input === 'string') {
    mapped.messages.push({ role: 'user', content: root.input, metadata: { ingress: root.input } });
  } else if (Array.isArray(root.input)) {
    (root.input as unknown[]).forEach((item, index) => mapInputItem(item, index, collected, mapped));
    if (root.input.length > limits.maxInputItems) {
      fail('input', 'bad_request', `at most ${limits.maxInputItems} input items are served`);
    }
  } else {
    fail('input', 'bad_request', 'input must be a string or an item array');
  }

  const choice = mapToolChoice(root.tool_choice, collected, collected.features);
  if (root.parallel_tool_calls !== undefined) {
    if (typeof root.parallel_tool_calls !== 'boolean') {
      fail('parallel_tool_calls', 'bad_request', 'parallel_tool_calls must be a boolean');
    }
    collected.features.add('parallel-tool-control');
  }
  if (root.max_output_tokens !== undefined && !isPositiveInt(root.max_output_tokens)) {
    fail('max_output_tokens', 'bad_request', 'max_output_tokens must be a positive integer');
  }
  if (root.max_output_tokens !== undefined) collected.features.add('explicit-output-ceiling');
  for (const key of ['temperature', 'top_p'] as const) {
    if (root[key] !== undefined && !isFiniteNumber(root[key])) {
      fail(key, 'bad_request', `${key} must be a finite number`);
    }
  }
  const { reasoning, context } = mapReasoning(root.reasoning, collected.features);
  const { format, verbosity } = mapTextFormat(root.text, collected.features);

  if (root.include !== undefined) {
    const include = asArray(root.include);
    if (!include || !include.every((entry) => typeof entry === 'string')) {
      fail('include', 'bad_request', 'include must be a string array');
    }
    (include as string[]).forEach((entry, index) => {
      if (!INCLUDED.has(entry)) {
        fail(`include[${index}]`, 'unsupported_parameter', `unsupported include ${JSON.stringify(entry)}`);
      }
    });
  }

  let requestMetadata: Record<string, unknown> | undefined;
  if (root.metadata !== undefined) requestMetadata = boundedRecord(root.metadata, 'metadata');
  const promptCacheKey = boundedId(root.prompt_cache_key, 'prompt_cache_key');
  const safetyIdentifier = boundedId(root.safety_identifier, 'safety_identifier');
  let clientMetadata: Record<string, unknown> | undefined;
  if (root.client_metadata !== undefined) {
    const record = boundedRecord(root.client_metadata, 'client_metadata');
    for (const [key, entry] of Object.entries(record)) {
      if (entry !== null && ['string', 'number', 'boolean'].includes(typeof entry)) continue;
      fail(`client_metadata.${key}`, 'bad_request', 'telemetry values must be scalars');
    }
    clientMetadata = record;
  }

  if (root.store !== undefined && root.store !== false) {
    fail('store', 'unsupported_parameter', 'only stateless (store false) requests are served');
  }
  if (root.background !== undefined && root.background !== false) {
    fail('background', 'unsupported_parameter', 'background execution is not served');
  }
  if (root.truncation !== undefined && root.truncation !== 'disabled') {
    fail('truncation', 'unsupported_parameter', 'only truncation disabled is served');
  }
  if (root.previous_response_id !== undefined && root.previous_response_id !== null) {
    fail('previous_response_id', 'unsupported_parameter', 'chained responses are not served');
  }
  if (root.conversation !== undefined && root.conversation !== null) {
    fail('conversation', 'unsupported_parameter', 'conversations are not served');
  }

  const required = new Set<CapabilityRequirement>();
  if (collected.definitions.length > 0 || mapped.hasTools) required.add('tools');
  if (mapped.hasImage) required.add('input:image');
  if (root.reasoning !== undefined) required.add('reasoning');
  if (stream === true) required.add('streaming');

  const encryptedReplay = mapped.artifacts.some((artifact) => artifact.encryptedContent !== undefined);
  if (encryptedReplay) collected.features.add('native-reasoning-replay');

  const carrier: ResponsesNativeRequestCarrier = {
    customTools: collected.customTools,
    functionToolRefs: collected.refs,
    reasoningArtifacts: mapped.artifacts,
    ...(context ? { reasoningContext: context } : {}),
    ...(verbosity ? { verbosity } : {}),
    ...(promptCacheKey ? { promptCacheKey } : {}),
    ...(safetyIdentifier ? { safetyIdentifier } : {}),
    ...(clientMetadata ? { clientMetadata } : {}),
    ...(requestMetadata ? { requestMetadata } : {}),
    itemIds: mapped.itemIds,
  };

  const request: GenerateRequest = {
    model: model as GenerateRequest['model'],
    messages: mapped.messages,
    ...(collected.definitions.length > 0 ? { tools: collected.definitions } : {}),
    ...(choice ? { toolChoice: choice } : {}),
    ...(typeof root.parallel_tool_calls === 'boolean' ? { parallelToolCalls: root.parallel_tool_calls } : {}),
    ...(reasoning ? { reasoning } : {}),
    ...(isPositiveInt(root.max_output_tokens) ? { maxOutputTokens: root.max_output_tokens } : {}),
    ...(isFiniteNumber(root.temperature) ? { temperature: root.temperature } : {}),
    ...(isFiniteNumber(root.top_p) ? { topP: root.top_p } : {}),
    ...(format ? { responseFormat: format } : {}),
    providerOptions: { ingressWire: 'openai-responses', ingressBody: body, responses: carrier },
  };
  return {
    request,
    requiredCapabilities: [...required],
    requiredExecutionFeatures: [...collected.features],
  };
};
