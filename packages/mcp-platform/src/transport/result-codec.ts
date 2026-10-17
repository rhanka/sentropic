/**
 * Lot 5 — shared result codec: the single `AppToolResult` <-> MCP wire
 * (`CallToolResult`) mapping used by both transports (Streamable HTTP and
 * stdio), so identical results always produce identical wire bytes.
 *
 * Success carries the canonical JSON of `output` as one text item;
 * failure carries `{code, message}` as one text item with `isError: true`.
 * Audit identity (`auditId`, `redactionClass`, `durableCallRef`, error
 * `code`/`retriable`) travels out-of-band in `_meta`, never inside the
 * content text, so `decode(encode(x))` is the identity. Decoding is strict:
 * empty content, non-text items, unparsable text and non-boolean `isError`
 * are refused. An absent `output` normalizes to `null` on decode.
 */
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { canonicalJsonText, parseStrictJson } from '../registry-canonical.js';
import type { AppToolResult } from '../runtime.js';

/** Encode an internal tool result to the MCP wire form. */
export function encodeToolResult(result: AppToolResult): CallToolResult {
  const text = result.ok
    ? canonicalJsonText(result.output ?? null)
    : canonicalJsonText({
        code: result.error?.code ?? 'unknown_error',
        message: result.error?.message ?? 'tool call failed',
      });
  const meta: Record<string, unknown> = {
    auditId: result.auditId,
    redactionClass: result.redactionClass,
  };
  if (result.durableCallRef !== undefined) meta['durableCallRef'] = result.durableCallRef;
  if (!result.ok) {
    meta['errorCode'] = result.error?.code ?? 'unknown_error';
    meta['retriable'] = result.error?.retriable ?? false;
  }
  return { content: [{ type: 'text', text }], isError: !result.ok, _meta: meta };
}

function fail(message: string): never {
  throw new Error(`Invalid tool-result wire payload: ${message}`);
}

/** Decode MCP wire back to an internal tool result (strict). */
export function decodeToolResult(wire: unknown): AppToolResult {
  if (typeof wire !== 'object' || wire === null) fail('payload must be an object');
  const record = wire as Record<string, unknown>;
  if (!Array.isArray(record['content']) || record['content'].length === 0) {
    fail('content must be a non-empty array');
  }
  const [first] = record['content'] as unknown[];
  if (typeof first !== 'object' || first === null) fail('first content item must be a text item');
  const item = first as Record<string, unknown>;
  if (item['type'] !== 'text' || typeof item['text'] !== 'string') {
    fail('first content item must be a text item');
  }
  if (record['isError'] !== undefined && typeof record['isError'] !== 'boolean') {
    fail('isError must be a boolean when present');
  }
  const meta =
    typeof record['_meta'] === 'object' && record['_meta'] !== null
      ? (record['_meta'] as Record<string, unknown>)
      : {};
  const auditId = typeof meta['auditId'] === 'string' ? meta['auditId'] : '';
  const redactionClass =
    meta['redactionClass'] === 'none' ||
    meta['redactionClass'] === 'low' ||
    meta['redactionClass'] === 'moderate' ||
    meta['redactionClass'] === 'high' ||
    meta['redactionClass'] === 'secret'
      ? meta['redactionClass']
      : ('low' as const);
  let parsed: unknown;
  try {
    parsed = parseStrictJson(item['text'] as string);
  } catch {
    fail('content text does not parse as strict JSON');
  }
  if (record['isError'] === true) {
    const body = (typeof parsed === 'object' && parsed !== null ? parsed : {}) as Record<
      string,
      unknown
    >;
    const code =
      typeof meta['errorCode'] === 'string'
        ? meta['errorCode']
        : typeof body['code'] === 'string'
          ? body['code']
          : 'unknown_error';
    const message = typeof body['message'] === 'string' ? body['message'] : 'tool call failed';
    return {
      ok: false,
      auditId,
      redactionClass,
      error: {
        code,
        message,
        retriable: meta['retriable'] === true,
      },
    };
  }
  const decoded: AppToolResult = { ok: true, output: parsed, auditId, redactionClass };
  if (typeof meta['durableCallRef'] === 'string') decoded.durableCallRef = meta['durableCallRef'];
  return decoded;
}
