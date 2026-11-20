import { createHash, type Hash } from 'node:crypto';
import type { GatewayWire } from '../ports/dispatch.js';

/** Separate read-only exclusion list — never shares or mutates nativeHeaderExclusions. */
const EXCLUDED_IDENTITY_HEADERS: ReadonlySet<string> = new Set([
  'connection', 'keep-alive', 'proxy-connection', 'te', 'trailer', 'transfer-encoding',
  'upgrade', 'proxy-authenticate', 'proxy-authorization', 'authorization', 'x-api-key',
  'api-key', 'anthropic-api-key', 'anthropic-admin-api-key', 'anthropic-oauth-token',
  'anthropic-key', 'cookie', 'cookie2', 'set-cookie', 'set-cookie2', 'user-agent',
]);

const HASH_CHUNK_CHARS = 65_536;

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

export const normalizedRole = (value: unknown): string | undefined =>
  typeof value === 'string' ? value.trim().toLowerCase() : undefined;

export const isProtectedRole = (role: string | undefined): boolean =>
  role === 'system' || role === 'developer';

const isProviderIdentityHeader = (name: string): boolean =>
  !EXCLUDED_IDENTITY_HEADERS.has(name) && !name.startsWith('x-sentropic-')
  && (name.startsWith('anthropic-') || name === 'x-app' || name.startsWith('x-stainless-'));

const isHopIdentityHeader = (name: string): boolean =>
  isProviderIdentityHeader(name)
  || (!EXCLUDED_IDENTITY_HEADERS.has(name) && !name.startsWith('x-sentropic-') && name.startsWith('x-claude-code-'));

const needsJsonEscape = (value: string): boolean => {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x22 || code === 0x5c || (code >= 0xd800 && code <= 0xdfff)) return true;
  }
  return false;
};

const updateJcsString = (hash: Hash, value: string): void => {
  if (value.length <= HASH_CHUNK_CHARS) {
    hash.update(JSON.stringify(value));
    return;
  }
  hash.update('"');
  let offset = 0;
  while (offset < value.length) {
    let end = Math.min(offset + HASH_CHUNK_CHARS, value.length);
    if (end < value.length) {
      const prev = value.charCodeAt(end - 1);
      const next = value.charCodeAt(end);
      if (prev >= 0xd800 && prev <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) end += 1;
    }
    const chunk = value.slice(offset, end);
    hash.update(needsJsonEscape(chunk) ? JSON.stringify(chunk).slice(1, -1) : chunk);
    offset = end;
  }
  hash.update('"');
};

const updateJcs = (hash: Hash, value: unknown): void => {
  if (value === null || typeof value === 'boolean') {
    hash.update(String(value));
    return;
  }
  if (typeof value === 'number') {
    hash.update(Number.isFinite(value) ? JSON.stringify(Object.is(value, -0) ? 0 : value) : 'null');
    return;
  }
  if (typeof value === 'string') {
    updateJcsString(hash, value);
    return;
  }
  if (Array.isArray(value)) {
    hash.update('[');
    for (let i = 0; i < value.length; i += 1) {
      if (i > 0) hash.update(',');
      updateJcs(hash, value[i] === undefined ? null : value[i]);
    }
    hash.update(']');
    return;
  }
  if (typeof value === 'object') {
    const rec = value as Record<string, unknown>;
    const keys = Object.keys(rec).filter((k) => rec[k] !== undefined).sort();
    hash.update('{');
    for (let i = 0; i < keys.length; i += 1) {
      if (i > 0) hash.update(',');
      const k = keys[i]!;
      updateJcsString(hash, k);
      hash.update(':');
      updateJcs(hash, rec[k]);
    }
    hash.update('}');
    return;
  }
  hash.update('null');
};

export const canonicalBytes = (value: unknown): Uint8Array => {
  const hash = createHash('sha256');
  updateJcs(hash, value);
  return new Uint8Array(hash.digest());
};

export const digestHex = (bytes: Uint8Array): string =>
  Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('hex');

export const bytesEqual = (a: Uint8Array, b: Uint8Array): boolean => {
  if (a.byteLength !== b.byteLength) return false;
  for (let i = 0; i < a.byteLength; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
};

export const fieldEntry = (obj: Record<string, unknown>, key: string): { present: boolean; value?: unknown } =>
  Object.hasOwn(obj, key) && obj[key] !== undefined ? { present: true, value: obj[key] } : { present: false };

export const extractSequence = (items: readonly unknown[], responsesMode: boolean) => {
  const protectedItems: { index: number; item: unknown }[] = [];
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    if (!isRecord(item)) continue;
    const role = normalizedRole(item.role);
    const isProtected = responsesMode
      ? item.type === 'additional_tools' || ((item.type === undefined || item.type === 'message') && isProtectedRole(role))
      : isProtectedRole(role);
    if (isProtected) protectedItems.push({ index: i, item });
  }
  const lastProtectedIndex = protectedItems.length > 0 ? protectedItems[protectedItems.length - 1]!.index : -1;
  const prefixSlots = lastProtectedIndex >= 0
    ? items.slice(0, lastProtectedIndex + 1).map((item, index) => {
      const rec = isRecord(item) ? item : undefined;
      return {
        index,
        role: rec ? normalizedRole(rec.role) ?? null : null,
        ...(responsesMode ? { type: rec && typeof rec.type === 'string' ? rec.type : null } : {}),
      };
    })
    : [];
  return { protectedItems, lastProtectedIndex, prefixSlots };
};

export const extractBodyProtectedBytes = (wire: GatewayWire, body: unknown): Uint8Array => {
  const raw = isRecord(body) ? body : {};
  if (wire === 'anthropic-messages') {
    return canonicalBytes({
      wire, system: fieldEntry(raw, 'system'),
      sequence: Array.isArray(raw.messages) ? extractSequence(raw.messages, false) : null,
      metadata: fieldEntry(raw, 'metadata'), tools: fieldEntry(raw, 'tools'),
      additional_tools: fieldEntry(raw, 'additional_tools'), safeguards: fieldEntry(raw, 'safeguards'),
      cache_control: fieldEntry(raw, 'cache_control'),
    });
  }
  if (wire === 'openai-chat-completions') {
    return canonicalBytes({
      wire, sequence: Array.isArray(raw.messages) ? extractSequence(raw.messages, false) : null,
      metadata: fieldEntry(raw, 'metadata'), user: fieldEntry(raw, 'user'),
      safety_identifier: fieldEntry(raw, 'safety_identifier'),
      prompt_cache_key: fieldEntry(raw, 'prompt_cache_key'), tools: fieldEntry(raw, 'tools'),
    });
  }
  return canonicalBytes({
    wire, instructions: fieldEntry(raw, 'instructions'),
    sequence: Array.isArray(raw.input) ? extractSequence(raw.input, true) : null,
    metadata: fieldEntry(raw, 'metadata'), client_metadata: fieldEntry(raw, 'client_metadata'),
    safety_identifier: fieldEntry(raw, 'safety_identifier'), user: fieldEntry(raw, 'user'),
    prompt_cache_key: fieldEntry(raw, 'prompt_cache_key'), tools: fieldEntry(raw, 'tools'),
  });
};

export interface ProtectedIdentityHeadersSnapshot {
  readonly providerIdentityHeaders: Readonly<Record<string, string>>;
  readonly hopIdentityHeaders: Readonly<Record<string, string>>;
  readonly connectionNominatedIdentityHeader: boolean;
  readonly providerIdentityHeadersBytes: Uint8Array;
  readonly hopIdentityHeadersBytes: Uint8Array;
}

export const captureProtectedIdentityHeaders = (
  headers: Readonly<Record<string, string>>,
): ProtectedIdentityHeadersSnapshot => {
  const providerIdentityHeaders: Record<string, string> = {};
  const hopIdentityHeaders: Record<string, string> = {};
  let connectionNominatedIdentityHeader = false;
  for (const [originalName, value] of Object.entries(headers)) {
    const name = originalName.toLowerCase();
    if (name === 'connection') {
      for (const token of value.split(',')) {
        const nominated = token.trim().toLowerCase();
        if (nominated && isHopIdentityHeader(nominated)) connectionNominatedIdentityHeader = true;
      }
      continue;
    }
    if (isProviderIdentityHeader(name)) {
      providerIdentityHeaders[name] = value;
      hopIdentityHeaders[name] = value;
    } else if (isHopIdentityHeader(name)) {
      hopIdentityHeaders[name] = value;
    }
  }
  return {
    providerIdentityHeaders, hopIdentityHeaders, connectionNominatedIdentityHeader,
    providerIdentityHeadersBytes: canonicalBytes(providerIdentityHeaders),
    hopIdentityHeadersBytes: canonicalBytes(hopIdentityHeaders),
  };
};
