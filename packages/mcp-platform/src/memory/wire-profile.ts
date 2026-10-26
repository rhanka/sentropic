import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { AppToolResult } from '../runtime.js';
import { assertMcpJson } from '../transport/tool-json.js';
import { encodeMemoryEnvelope } from '../transport/result-codec.js';
import { isPublicMemoryErrorCode, isValidOpaqueRef, type MemoryToolEnvelopeV1 } from './contracts.js';
import { MemoryTrustedContextError } from './invocation-context.js';
import { projectMemoryContext, requireTrustedInvocationContext } from './invocation-context.js';
import { isMutatingMemoryToolName } from './contracts.js';
import { validateMemoryArguments } from './schema-profile.js';
import type { BridgeTool, BridgeRunner, BridgeOptions } from '../transport/bridge.js';
import { McpError } from '@modelcontextprotocol/sdk/types.js';
import { safeMcpProtocolError } from '../transport/bridge-kernel.js';

export class MemoryWireBudgetError extends Error {
  constructor() { super('Memory result exceeds the negotiated byte budget'); }
}

/** Both budgets cover the full JSON value, independently; never truncate a committed result. */
export function encodeBoundedMemoryEnvelope(envelope: AppToolResult, maxPacketBytes = 65536): CallToolResult {
  if (!Number.isSafeInteger(maxPacketBytes) || maxPacketBytes < 4096 || maxPacketBytes > 1048576) {
    throw new TypeError('Invalid memory packet budget');
  }
  if (!isValidOpaqueRef(envelope.auditId) || envelope.auditId === 'broker-unscoped') {
    throw new MemoryTrustedContextError();
  }
  assertMcpJson(envelope, Number.MAX_SAFE_INTEGER, 64);
  if (typeof envelope.ok !== 'boolean' || envelope.redactionClass !== 'high' ||
    Object.keys(envelope).some(key => !['ok', 'output', 'error', 'auditId', 'redactionClass'].includes(key))) {
    throw new TypeError('Invalid memory envelope');
  }
  if (envelope.ok) {
    const output = envelope.output as { schema_version?: unknown; value?: unknown } | undefined;
    if (!output || output.schema_version !== 1 || !Object.hasOwn(output, 'value') ||
      Object.keys(output).some(key => !['schema_version', 'value'].includes(key)) || 'error' in envelope) {
      throw new TypeError('Invalid memory success');
    }
  } else if ('output' in envelope || !envelope.error || !isPublicMemoryErrorCode(envelope.error.code) ||
    typeof envelope.error.message !== 'string' || typeof envelope.error.retriable !== 'boolean' ||
    Object.keys(envelope.error).some(key => !['code', 'message', 'retriable'].includes(key))) {
    throw new TypeError('Invalid memory failure');
  }
  const result = encodeMemoryEnvelope(envelope as MemoryToolEnvelopeV1<unknown>);
  if (Buffer.byteLength(JSON.stringify(envelope)) > maxPacketBytes ||
    Buffer.byteLength(JSON.stringify(result)) > 2097152) throw new MemoryWireBudgetError();
  return result;
}

/** Selected memory path through the same SDK kernel; all authority is host-owned. */
export async function callMemoryBridge(tool: BridgeTool, args: Record<string, unknown>, runner: BridgeRunner,
  options: BridgeOptions | undefined, signal: AbortSignal): Promise<CallToolResult> {
  let context;
  try {
    context = requireTrustedInvocationContext(await options?.memoryContext?.(tool.name, signal));
    if (typeof context.audit?.emit !== 'function') throw new MemoryTrustedContextError();
    projectMemoryContext(context, typeof args.purpose_ref === 'string' ? args.purpose_ref : context.memory!.binding.purpose_ref);
  } catch { throw safeMcpProtocolError(new McpError(-32603, '')); }
  signal = AbortSignal.any([signal, AbortSignal.timeout(
    Date.parse(context.memory!.binding.deadline_at) - Date.parse(context.memory!.now))]);
  const budget = typeof args.max_packet_bytes === 'number' ? args.max_packet_bytes : tool.maxPacketBytes ?? 65536;
  const failure = (code: 'INVALID_SCHEMA' | 'RESULT_TOO_LARGE' | 'MUTATION_OUTCOME_UNKNOWN' | 'CAPABILITY_UNAVAILABLE', message: string) =>
    encodeBoundedMemoryEnvelope({ ok: false, auditId: context.auditId, redactionClass: 'high',
      error: { code, message, retriable: false } }, tool.maxPacketBytes ?? 65536);
  if (validateMemoryArguments(tool.schema, args).length) return failure('INVALID_SCHEMA', 'Invalid memory arguments');
  try {
    signal.throwIfAborted();
    const result = await runner.run(tool.name, args as never, options?.identity, { context, signal });
    signal.throwIfAborted();
    if (result.auditId !== context.auditId) throw new MemoryTrustedContextError();
    if (validateMemoryArguments(tool.outputSchema, result).length) throw new TypeError('Invalid memory output');
    return encodeBoundedMemoryEnvelope(result, budget);
  } catch (error) {
    if (error instanceof MemoryTrustedContextError) throw safeMcpProtocolError(new McpError(-32603, ''));
    if (error instanceof McpError) throw safeMcpProtocolError(error);
    if (error instanceof MemoryWireBudgetError) return failure('RESULT_TOO_LARGE',
      'Result exceeds the byte budget; recover committed mutations with the same idempotency key');
    return isMutatingMemoryToolName(tool.name)
      ? failure('MUTATION_OUTCOME_UNKNOWN', 'Memory outcome is unknown; recover with the same idempotency key')
      : failure('CAPABILITY_UNAVAILABLE', 'Memory call failed');
  }
}
