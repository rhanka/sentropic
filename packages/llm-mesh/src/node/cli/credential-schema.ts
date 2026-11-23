// @sentropic/llm-mesh/node/cli/credential-schema.ts
//
// Strict schema parser and bounded non-TTY stdin reader for Cloud Code OAuth
// credentials. Never echoes raw payload bytes, tokens, or emails on error.

import { stdin as defaultStdin, type ProcessReadStream } from 'node:process';

export const MAX_CREDENTIAL_BYTES = 64 * 1024;
export const CREDENTIAL_STDIN_TIMEOUT_MS = 30_000;
const MAX_TOKEN_CHARS = 8192;
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const ALLOWED_TOKEN_KEYS = new Set(['access_token', 'refresh_token', 'token_type', 'expiry', 'expires_in']);
// Flat payloads may be a raw Google token response or a
// CloudCodeEnrollmentProvider.complete() result: non-token metadata keys are
// admitted here and discarded after light type checks, never trusted.
const ALLOWED_FLAT_KEYS = new Set([
  ...ALLOWED_TOKEN_KEYS, 'accessToken', 'refreshToken', 'expiresAt',
  'scope', 'scopes', 'id_token', 'refresh_token_expires_in', 'accountId', 'authClientConfigVersion',
]);
const ALLOWED_WRAPPED_ROOT_KEYS = new Set([
  'token', 'auth_method', 'id_token_email', 'id_token', 'scope', 'scopes', 'client_id', 'project_id', 'created_at', 'updated_at',
]);

export interface CloudCodeOAuthCredential {
  accessToken: string;
  refreshToken: string;
  expiresAt?: string;
}

export class AgyTokenReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AgyTokenReadError';
  }
}

const textEncoder = new TextEncoder();
const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const assertAllowedKeys = (obj: Record<string, unknown>, allowed: ReadonlySet<string>): void => {
  for (const key of Object.keys(obj)) {
    if (FORBIDDEN_KEYS.has(key) || !allowed.has(key)) {
      throw new AgyTokenReadError('credential payload contains unsupported fields');
    }
  }
};

const cleanToken = (value: unknown): string | null => {
  if (typeof value !== 'string' || /[\0-\x1f\x7f]/.test(value)) return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_TOKEN_CHARS || /\s/.test(trimmed)) return null;
  return trimmed;
};

/** Parse and strictly validate Cloud Code OAuth JSON; discards email, never echoes secrets. */
export const parseCloudCodeCredentialPayload = (raw: string): CloudCodeOAuthCredential => {
  if (textEncoder.encode(raw).length > MAX_CREDENTIAL_BYTES) {
    throw new AgyTokenReadError('credential payload exceeds maximum allowed size');
  }
  let parsed: unknown;
  try { parsed = JSON.parse(raw) as unknown; } catch {
    throw new AgyTokenReadError('credential payload is not valid JSON');
  }
  if (!isPlainObject(parsed)) throw new AgyTokenReadError('credential payload must be a JSON object');
  let inner: Record<string, unknown>;
  if (Object.hasOwn(parsed, 'token')) {
    assertAllowedKeys(parsed, ALLOWED_WRAPPED_ROOT_KEYS);
    if (!isPlainObject(parsed.token)) throw new AgyTokenReadError('credential payload token must be an object');
    assertAllowedKeys(parsed.token, ALLOWED_TOKEN_KEYS);
    inner = parsed.token;
  } else {
    assertAllowedKeys(parsed, ALLOWED_FLAT_KEYS);
    if ((Object.hasOwn(parsed, 'access_token') && Object.hasOwn(parsed, 'accessToken'))
      || (Object.hasOwn(parsed, 'refresh_token') && Object.hasOwn(parsed, 'refreshToken'))
      || (Object.hasOwn(parsed, 'expiry') && Object.hasOwn(parsed, 'expiresAt'))) {
      throw new AgyTokenReadError('credential payload contains conflicting duplicate fields');
    }
    inner = parsed;
  }
  const accessToken = cleanToken(inner.access_token ?? inner.accessToken);
  if (!accessToken) throw new AgyTokenReadError('credential payload is missing a valid access token');
  const refreshToken = cleanToken(inner.refresh_token ?? inner.refreshToken);
  if (!refreshToken) throw new AgyTokenReadError('credential payload is missing a valid refresh token');
  if (inner.token_type !== undefined && (typeof inner.token_type !== 'string' || inner.token_type.toLowerCase() !== 'bearer')) {
    throw new AgyTokenReadError('credential payload has unsupported token_type');
  }
  if (inner.expires_in !== undefined && (typeof inner.expires_in !== 'number' || !Number.isFinite(inner.expires_in) || inner.expires_in <= 0)) {
    throw new AgyTokenReadError('credential payload has invalid expires_in');
  }
  // Discarded flat metadata must still be well-typed; it is never echoed.
  for (const key of ['scope', 'id_token', 'accountId', 'authClientConfigVersion'] as const) {
    if (inner[key] !== undefined && (typeof inner[key] !== 'string' || !(inner[key] as string).trim())) {
      throw new AgyTokenReadError('credential payload has invalid metadata fields');
    }
  }
  if (inner.scopes !== undefined && (!Array.isArray(inner.scopes) || inner.scopes.some((s) => typeof s !== 'string'))) {
    throw new AgyTokenReadError('credential payload has invalid metadata fields');
  }
  if (inner.refresh_token_expires_in !== undefined
    && (typeof inner.refresh_token_expires_in !== 'number' || !Number.isFinite(inner.refresh_token_expires_in) || inner.refresh_token_expires_in <= 0)) {
    throw new AgyTokenReadError('credential payload has invalid metadata fields');
  }
  const rawExpiry = inner.expiry ?? inner.expiresAt;
  let expiresAt: string | undefined;
  if (rawExpiry !== undefined) {
    const ms = typeof rawExpiry === 'string' && rawExpiry.trim() ? Date.parse(rawExpiry) : Number.NaN;
    if (!Number.isFinite(ms)) throw new AgyTokenReadError('credential payload has invalid expiry');
    expiresAt = new Date(ms).toISOString();
  }
  return { accessToken, refreshToken, ...(expiresAt ? { expiresAt } : {}) };
};

export const readCredentialFromStdin = async (
  stream: ProcessReadStream = defaultStdin,
  timeoutMs: number = CREDENTIAL_STDIN_TIMEOUT_MS,
): Promise<string> => {
  if (stream.isTTY) throw new AgyTokenReadError('refusing to read credential from interactive TTY; pipe JSON on stdin');
  const deadlineMs = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : CREDENTIAL_STDIN_TIMEOUT_MS;
  const readAll = async (): Promise<string> => {
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of stream) {
      const buf = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk;
      total += buf.length;
      if (total > MAX_CREDENTIAL_BYTES) throw new AgyTokenReadError('credential on stdin exceeds maximum allowed size');
      chunks.push(buf);
    }
    const raw = Buffer.concat(chunks).toString('utf8');
    if (!raw.trim()) throw new AgyTokenReadError('credential on stdin is empty');
    return raw;
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      readAll(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          try { (stream as unknown as { destroy?: () => void }).destroy?.(); } catch { /* gone */ }
          reject(new AgyTokenReadError('timed out waiting for credential on stdin'));
        }, deadlineMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
};
