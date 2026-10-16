/**
 * Responses ingress content mapping (spec §16.3, D16-B). Maps validated
 * input items — messages and parts, function calls and their outputs,
 * additional tool declarations and completed reasoning artifacts — to
 * canonical messages with call_id correlation. Rejects orphan results,
 * ambiguous duplicates and unsupported content before acquisition.
 */

import type {
  LlmMeshMessage,
  ResponsesReasoningArtifact,
  ToolCall,
  ToolResultContent,
} from '@sentropic/llm-mesh';

import {
  asArray,
  asRecord,
  collectTools,
  fail,
  IMAGE_DETAILS,
  type CollectedTools,
  type JsonRecord,
  resolveToolName,
} from './responses-ingress-tools.js';

type TextImagePart = { type: 'text'; text: string } | { type: 'image'; url?: string; data?: string; mediaType?: string };

const messagePart = (
  part: unknown, fieldPath: string, assistant: boolean,
  onImageDetail?: (detail: string | undefined) => void,
): TextImagePart => {
  const record = asRecord(part);
  if (!record || typeof record.type !== 'string') fail(fieldPath, 'bad_request', 'content part needs a type');
  const typed = record as JsonRecord;
  if ((typed.type === 'input_text' || typed.type === 'text') && typeof typed.text === 'string') {
    onImageDetail?.(undefined);
    return { type: 'text', text: typed.text };
  }
  if (typed.type === 'output_text' && typeof typed.text === 'string') {
    if (!assistant) fail(fieldPath, 'bad_request', 'output_text needs an assistant message');
    onImageDetail?.(undefined);
    return { type: 'text', text: typed.text };
  }
  if (typed.type === 'refusal' && typeof typed.refusal === 'string') {
    onImageDetail?.(undefined);
    return { type: 'text', text: typed.refusal };
  }
  if (typed.type === 'input_image') {
    const url = typeof typed.image_url === 'string'
      ? typed.image_url
      : asRecord(typed.image_url)?.url;
    if (typeof url !== 'string' || typed.file_id !== undefined) {
      fail(fieldPath, 'unsupported_parameter', 'image needs a URL (no provider file ids)');
    }
    const detail = typed.detail;
    if (detail !== undefined && (typeof detail !== 'string' || !IMAGE_DETAILS.has(detail))) {
      fail(`${fieldPath}.detail`, 'bad_request', 'detail must be auto, low or high');
    }
    // Detail is a provider rendering hint with no canonical slot: preserved
    // in message metadata (index-aligned) for adapters that forward it.
    onImageDetail?.(typeof detail === 'string' ? detail : undefined);
    return { type: 'image', url: url as string };
  }
  if (typed.type === 'image_url') {
    const image = asRecord(typed.image_url);
    const url = typeof typed.image_url === 'string' ? typed.image_url : image?.url;
    if (typeof url !== 'string') fail(fieldPath, 'bad_request', 'image_url needs a URL');
    onImageDetail?.(undefined);
    return { type: 'image', url: url as string };
  }
  return fail(fieldPath, 'unsupported_parameter', `unsupported content type ${JSON.stringify(typed.type)}`);
};

const resultContent = (
  output: unknown, fieldPath: string,
): { output: Record<string, unknown>; content: ToolResultContent[]; imageDetails?: (string | undefined)[] } => {
  if (typeof output === 'string') {
    return { output: { content: output }, content: [{ type: 'text', text: output }] };
  }
  const parts = asArray(output);
  if (!parts) fail(fieldPath, 'bad_request', 'tool output must be a string or parts');
  const content: ToolResultContent[] = [];
  const texts: string[] = [];
  const details: (string | undefined)[] = [];
  const detailAt = (detail: string | undefined): void => { details.push(detail); };
  (parts as unknown[]).forEach((part, index) => {
    const path = `${fieldPath}[${index}]`;
    const record = asRecord(part);
    if (!record || typeof record.type !== 'string') fail(path, 'bad_request', 'result part needs a type');
    const typed = record as JsonRecord;
    if ((typed.type === 'input_text' || typed.type === 'output_text' || typed.type === 'text')
      && typeof typed.text === 'string') {
      texts.push(typed.text);
      content.push({ type: 'text', text: typed.text });
      details.push(undefined);
      return;
    }
    if (typed.type === 'input_image' || typed.type === 'image_url') {
      const mapped = messagePart(
        typed.type === 'input_image'
          ? { type: 'input_image', image_url: typed.image_url, detail: typed.detail }
          : { type: 'image_url', image_url: typed.image_url },
        path, true, detailAt,
      );
      if (mapped.type === 'image') {
        content.push({
          type: 'media',
          mediaType: mapped.mediaType ?? 'application/octet-stream',
          ...(mapped.url ? { url: mapped.url } : {}),
          ...(mapped.data ? { data: mapped.data } : {}),
        });
        return;
      }
    }
    // Never stringify an unsupported part into prompt text.
    fail(path, 'unsupported_parameter', `unsupported result part ${JSON.stringify(typed.type)}`);
  });
  const imageDetails = details.some((detail) => detail !== undefined) ? details : undefined;
  return { output: { content: texts.join('\n') }, content, ...(imageDetails ? { imageDetails } : {}) };
};

const messageContent = (
  content: unknown, fieldPath: string, role: string,
): { content: LlmMeshMessage['content']; imageDetails?: (string | undefined)[] } => {
  if (typeof content === 'string') return { content };
  const parts = asArray(content);
  if (!parts) fail(fieldPath, 'bad_request', 'message content must be a string or parts');
  const details: (string | undefined)[] = [];
  const mapped = (parts as unknown[]).map((part, index) =>
    messagePart(part, `${fieldPath}[${index}]`, role === 'assistant', (detail) => { details.push(detail); }));
  const imageDetails = details.some((detail) => detail !== undefined) ? details : undefined;
  return { content: mapped, ...(imageDetails ? { imageDetails } : {}) };
};

export interface MappedInput {
  readonly messages: LlmMeshMessage[];
  readonly calls: Map<string, { name: string; itemId?: string }>;
  readonly artifacts: ResponsesReasoningArtifact[];
  readonly itemIds: string[];
  hasImage: boolean;
  hasTools: boolean;
}

export const mapInputItem = (
  item: unknown, index: number, collected: CollectedTools, mapped: MappedInput,
): void => {
  const path = `input[${index}]`;
  const record = asRecord(item);
  if (!record) fail(path, 'bad_request', 'input item must be an object');
  const typed = record as JsonRecord;
  const itemId = typeof typed.id === 'string' ? typed.id : undefined;
  if (itemId) mapped.itemIds.push(itemId);

  const kind = typed.type;
  if (kind === undefined || kind === 'message') {
    const role = typed.role;
    if (typed.content === undefined) fail(`${path}.content`, 'bad_request', 'message needs content');
    if (role !== 'system' && role !== 'developer' && role !== 'user' && role !== 'assistant') {
      fail(`${path}.role`, 'bad_request', 'role must be system, developer, user or assistant');
    }
    const contentRole = role as 'system' | 'developer' | 'user' | 'assistant';
    const { content, imageDetails } = messageContent(typed.content, `${path}.content`, contentRole);
    if (Array.isArray(content) && content.some((part) => part.type === 'image')) {
      mapped.hasImage = true;
    }
    const metadata = {
      ingress: item,
      ...(imageDetails ? { imageDetails } : {}),
    };
    if (contentRole === 'assistant') {
      mapped.messages.push({ role: 'assistant', content, metadata });
    } else {
      mapped.messages.push({ role: contentRole, content, metadata });
    }
    return;
  }
  if (kind === 'function_call') {
    if (typeof typed.call_id !== 'string' || typed.call_id.length === 0) {
      fail(`${path}.call_id`, 'bad_request', 'function_call needs a call_id');
    }
    const callId = typed.call_id as string;
    if (typeof typed.name !== 'string' || typeof typed.arguments !== 'string') {
      fail(path, 'bad_request', 'function_call needs a string name and arguments');
    }
    const callName = typed.name as string;
    const callArguments = typed.arguments as string;
    if (mapped.calls.has(callId)) {
      fail(`${path}.call_id`, 'bad_request', `duplicate call_id ${JSON.stringify(callId)}`);
    }
    const name = resolveToolName(callName, `${path}.name`, collected);
    mapped.calls.set(callId, { name, ...(itemId ? { itemId } : {}) });
    const call: ToolCall = {
      toolCallId: callId,
      providerCallId: callId,
      name,
      argumentsText: callArguments,
    };
    mapped.messages.push({
      role: 'assistant', content: '', toolCalls: [call], metadata: { ingress: item },
    });
    mapped.hasTools = true;
    return;
  }
  if (kind === 'function_call_output') {
    if (typeof typed.call_id !== 'string' || typed.call_id.length === 0) {
      fail(`${path}.call_id`, 'bad_request', 'function_call_output needs a call_id');
    }
    const resultCallId = typed.call_id as string;
    const call = mapped.calls.get(resultCallId);
    if (!call) {
      fail(`${path}.call_id`, 'bad_request', `orphan tool result for ${JSON.stringify(resultCallId)}`);
    }
    const matched = call as { name: string; itemId?: string };
    if (typed.output === undefined) fail(`${path}.output`, 'bad_request', 'tool result needs output');
    const { output, content, imageDetails } = resultContent(typed.output, `${path}.output`);
    if (content.some((part) => part.type === 'media')) mapped.hasImage = true;
    mapped.messages.push({
      role: 'tool',
      content: typeof typed.output === 'string'
        ? typed.output
        : content.filter((part) => part.type === 'text').map((part) => (part as { text: string }).text).join('\n'),
      toolResult: {
        toolCallId: resultCallId, providerCallId: resultCallId, name: matched.name, output, content,
        metadata: {
          ingress: item,
          ...(imageDetails ? { imageDetails } : {}),
        },
      },
      metadata: { ingress: item },
    });
    mapped.hasTools = true;
    return;
  }
  if (kind === 'additional_tools') {
    collectTools(typed.tools, `${path}.tools`, undefined, collected);
    return;
  }
  if (kind === 'reasoning') {
    const summary = typed.summary;
    const encrypted = typed.encrypted_content ?? typed.content;
    let summaryText: string | undefined;
    if (typeof summary === 'string') summaryText = summary;
    else if (Array.isArray(summary)) {
      summaryText = (summary as unknown[])
        .map((entry) => {
          const entryRecord = asRecord(entry);
          return entryRecord && typeof entryRecord.text === 'string' ? entryRecord.text : null;
        })
        .filter((text): text is string => text !== null)
        .join('\n');
    } else if (summary !== undefined) {
      fail(`${path}.summary`, 'bad_request', 'reasoning summary must be text');
    }
    if (typeof encrypted !== 'string' && encrypted !== undefined) {
      fail(`${path}.encrypted_content`, 'bad_request', 'encrypted content must be a string');
    }
    if (!summaryText && !encrypted) fail(path, 'bad_request', 'reasoning item is empty');
    mapped.artifacts.push({
      ...(itemId ? { itemId } : {}),
      ...(summaryText ? { summary: summaryText } : {}),
      ...(typeof encrypted === 'string' ? { encryptedContent: encrypted } : {}),
    });
    return;
  }
  fail(`${path}.type`, 'unsupported_parameter', `unsupported input type ${JSON.stringify(kind)}`);
};
