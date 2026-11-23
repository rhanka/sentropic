// @sentropic/llm-mesh/node/cli/oauth-paste.ts
//
// Bounded reader and strict parser for the pasted OAuth callback used by
// `enroll --provider cloud-code --oauth-paste`. Accepts one line: a full
// callback URL, a bare query string, or `code#state`. The pasted line is
// a credential input: it is never echoed in errors or logs.

import { stdin as defaultStdin, type ProcessReadStream } from 'node:process';
import { AgyTokenReadError } from './credential-schema.js';

export const OAUTH_PASTE_TIMEOUT_MS = 5 * 60_000;
const MAX_PASTE_BYTES = 8192;
const MAX_CODE_CHARS = 2048;
const MAX_STATE_CHARS = 512;

export interface PastedOAuthCallback {
  code: string;
  state: string;
}

const cleanPart = (value: string | null, maxChars: number): string | null => {
  if (typeof value !== 'string' || /[\0-\x1f\x7f]/.test(value)) return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxChars || /\s/.test(trimmed)) return null;
  return trimmed;
};

export const parsePastedOAuthCallback = (line: string): PastedOAuthCallback => {
  const trimmed = line.trim();
  if (!trimmed) throw new AgyTokenReadError('pasted OAuth callback is empty');
  let code: string | null = null;
  let state: string | null = null;
  if (trimmed.includes('://')) {
    let url: URL;
    try { url = new URL(trimmed); } catch {
      throw new AgyTokenReadError('pasted OAuth callback is not a valid callback URL');
    }
    code = url.searchParams.get('code');
    state = url.searchParams.get('state');
  } else if (trimmed.includes('#')) {
    const parts = trimmed.split('#');
    if (parts.length !== 2) throw new AgyTokenReadError('pasted OAuth callback is not a valid code#state pair');
    code = parts[0] as string;
    state = parts[1] as string;
  } else if (trimmed.startsWith('?') || trimmed.includes('=')) {
    const params = new URLSearchParams(trimmed.startsWith('?') ? trimmed.slice(1) : trimmed);
    code = params.get('code');
    state = params.get('state');
  } else {
    throw new AgyTokenReadError('pasted OAuth callback must be a callback URL or code#state');
  }
  const cleanCode = cleanPart(code, MAX_CODE_CHARS);
  const cleanState = cleanPart(state, MAX_STATE_CHARS);
  if (!cleanCode || !cleanState) {
    throw new AgyTokenReadError('pasted OAuth callback is missing a valid code or state');
  }
  return { code: cleanCode, state: cleanState };
};

export const readPastedOAuthCallback = async (
  stream: ProcessReadStream = defaultStdin,
  timeoutMs: number = OAUTH_PASTE_TIMEOUT_MS,
): Promise<PastedOAuthCallback> => {
  if (stream.isTTY) {
    throw new AgyTokenReadError('refusing to read OAuth callback from interactive TTY; pipe it on stdin (e.g. kubectl exec -i without -t)');
  }
  const deadlineMs = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : OAUTH_PASTE_TIMEOUT_MS;
  const readLine = async (): Promise<string> => {
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of stream) {
      const buf = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk;
      total += buf.length;
      if (total > MAX_PASTE_BYTES) throw new AgyTokenReadError('pasted OAuth callback exceeds maximum allowed size');
      const newline = buf.indexOf(0x0a);
      if (newline !== -1) {
        chunks.push(buf.subarray(0, newline));
        break;
      }
      chunks.push(buf);
    }
    return Buffer.concat(chunks).toString('utf8');
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const line = await Promise.race([
      readLine(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          try { (stream as unknown as { destroy?: () => void }).destroy?.(); } catch { /* gone */ }
          reject(new AgyTokenReadError('timed out waiting for pasted OAuth callback'));
        }, deadlineMs);
      }),
    ]);
    return parsePastedOAuthCallback(line);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
};
