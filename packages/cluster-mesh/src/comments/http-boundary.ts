import { CanonicalCommandError } from '@sentropic/comments';
import type { Context } from 'hono';
import { CommentsTransportError } from './transport-contracts.js';
export const commentsHttpError = (error: unknown) => {
  const source = error as { code?: string; name?: string };
  const code = error instanceof CommentsTransportError ? error.condition : source?.code;
  if (code === 'denied') return { code: 'denied', status: 403 as const };
  if (code === 'not-found') return { code: 'not-found', status: 404 as const };
  if (code === 'cas-conflict' || code === 'idempotency-conflict' || code === 'conflict') return { code: 'conflict', status: 409 as const };
  if (code === 'capacity-exceeded') return { code: 'capacity-exceeded', status: 413 as const };
  if (code === 'invalid-request' || code === 'invalid-command' || error instanceof SyntaxError || source?.name?.endsWith('ValidationError')) return { code: 'invalid-request', status: 400 as const };
  return { code: 'incomplete', status: 503 as const };
};
export const readCommentsHttpBody = async (context: Context): Promise<Record<string, unknown>> => {
  const reader = context.req.raw.body?.getReader(); const chunks: Uint8Array[] = []; let bytes = 0;
  if (!reader) throw new SyntaxError('JSON request body is required');
  try {
    for (;;) {
      const chunk = await reader.read(); if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > 1048576) { await reader.cancel(); throw new CommentsTransportError('capacity-exceeded', 'Complete HTTP request exceeds its byte limit'); }
      chunks.push(chunk.value);
    }
  } finally { reader.releaseLock(); }
  const result: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new SyntaxError('JSON object body is required');
  return result as Record<string, unknown>;
};
export const assertCommentsHttpKeys = (value: Record<string, unknown>, keys: readonly string[]): void => {
  if (Object.keys(value).some((key) => !keys.includes(key))) throw new SyntaxError('Unknown canonical request field');
};
export const commentsHttpId = (id: string | undefined): string => {
  const reserved = ['annotations', 'threads', 'revisions', 'reviews', 'submissions', 'lifecycle', 'import', 'export', 'receipts'];
  if (!id || reserved.includes(id)) throw new CanonicalCommandError('not-found', 'Comments object is unavailable');
  return id;
};
export const commentsHttpResponse = (context: Context, value: unknown): Response => {
  if (value === null) return context.json({ code: 'not-found', message: 'Comments object is unavailable' }, 404);
  const bytes = JSON.stringify(value);
  if (Buffer.byteLength(bytes) > 1048576) throw new CommentsTransportError('capacity-exceeded', 'Complete HTTP response exceeds its byte limit');
  return context.newResponse(bytes, 200, { 'content-type': 'application/json; charset=utf-8' });
};
