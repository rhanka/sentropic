// Per-link wire framing + JCS canonicalization (RC2.contract r3): every relay
// record on a link is 4-byte big-endian length + JCS bytes, 1..8192 per record;
// Data frames additionally cap at 24576 encoded / 16384 decoded bytes.

export const RELAY_RECORD_MAX_BYTES = 8192;
export function encodeRelayRecord(record: unknown): Uint8Array {
  const jcs = jcsCanonicalize(record);
  const bytes = new TextEncoder().encode(jcs);
  if (bytes.length < 1 || bytes.length > RELAY_RECORD_MAX_BYTES) {
    throw new RangeError(`relay record length ${bytes.length} outside 1..${RELAY_RECORD_MAX_BYTES}`);
  }
  const out = new Uint8Array(4 + bytes.length);
  new DataView(out.buffer).setUint32(0, bytes.length);
  out.set(bytes, 4);
  return out;
}

export function decodeRelayRecord(buffer: Uint8Array): { record: unknown; rest: Uint8Array } {
  if (buffer.length < 4) throw new RangeError('relay frame shorter than length prefix');
  const length = new DataView(buffer.buffer, buffer.byteOffset, 4).getUint32(0);
  if (length < 1 || length > RELAY_RECORD_MAX_BYTES) throw new RangeError(`relay record length ${length} outside 1..${RELAY_RECORD_MAX_BYTES}`);
  if (buffer.length < 4 + length) throw new RangeError('relay frame truncated');
  const record = JSON.parse(new TextDecoder().decode(buffer.subarray(4, 4 + length)));
  return { record, rest: buffer.subarray(4 + length) };
}

// RFC 8785-style JCS: recursively sort object keys by UTF-16 code unit order.
export function jcsCanonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) as string;
  if (Array.isArray(value)) return '[' + value.map((v) => jcsCanonicalize(v)).join(',') + ']';
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + jcsCanonicalize(obj[k])).join(',') + '}';
}
