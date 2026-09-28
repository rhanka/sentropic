/** Lot 1 unknown-model router matrix (plan path): REAL router + REAL mesh, both wires, JSON and `stream:true`. */
import { describe, expect, it } from 'vitest';
import {
  KNOWN_MODEL, UNKNOWN_MODEL, authHeaders, meshDirectoryFor,
  realMeshPlanner, sendUnknown, unknownModelRouter, type UnknownRouterCalls,
} from './fixtures/unknown-model.js';

const freshCalls = (): UnknownRouterCalls => ({ settlements: [], dispatch: { generate: 0, stream: 0 } });

const expectedBody = (path: string): unknown => path === '/v1/messages'
  ? { type: 'error', error: { type: 'not_found_error', message: `Unknown model: "${UNKNOWN_MODEL}"` } }
  : { error: { message: `Unknown model: "${UNKNOWN_MODEL}"`,
    type: 'invalid_request_error', code: 'model_not_found' } };

describe('unknown-model router matrix (real mesh, plan path)', () => {
  it.each([
    { path: '/v1/messages', stream: false },
    { path: '/v1/messages', stream: true },
    { path: '/v1/chat/completions', stream: false },
    { path: '/v1/chat/completions', stream: true },
  ])('returns the frozen 404 with zero dispatch ($path stream=$stream)', async ({ path, stream }) => {
    const calls = freshCalls();
    const app = unknownModelRouter({ planner: realMeshPlanner(meshDirectoryFor([KNOWN_MODEL])), calls });
    const res = await sendUnknown(app, path, UNKNOWN_MODEL, stream);
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toMatch(/^application\/json/);
    expect(res.headers.get('x-sentropic-request-id')).toBe('req_unknown');
    expect(res.headers.get('x-sentropic-served')).toBeNull();
    expect(res.headers.get('retry-after')).toBeNull();
    expect(res.headers.get('x-should-retry')).toBeNull();
    // A pre-commit refusal is JSON, never an SSE prefix — even for stream:true.
    const text = await res.text();
    expect(text.startsWith('event:')).toBe(false);
    expect(text.startsWith('data:')).toBe(false);
    expect(JSON.parse(text)).toEqual(expectedBody(path));
    // Zero provider dispatch, one failed zero-attempt notification.
    expect(calls.dispatch).toEqual({ generate: 0, stream: 0 });
    expect(calls.settlements).toHaveLength(1);
    expect(calls.settlements[0]).toMatchObject({ outcome: 'failed',
      requestedModel: UNKNOWN_MODEL, attempts: [],
      usage: { inputTokens: 0, outputTokens: 0, estimated: true } });
  });

  it('separates caller auth from model routing (401 before any 404)', async () => {
    const calls = freshCalls();
    const app = unknownModelRouter({ planner: realMeshPlanner(meshDirectoryFor([KNOWN_MODEL])), calls });
    const res = await sendUnknown(app, '/v1/messages', UNKNOWN_MODEL, false,
      { authorization: 'Bearer wrong', 'content-type': 'application/json' });
    expect(res.status).toBe(401);
    expect(calls.settlements).toHaveLength(0);
    expect(calls.dispatch).toEqual({ generate: 0, stream: 0 });
  });

  it('keeps malformed and missing models at 400, never 404', async () => {
    const calls = freshCalls();
    const app = unknownModelRouter({ planner: realMeshPlanner(meshDirectoryFor([KNOWN_MODEL])), calls });
    for (const path of ['/v1/messages', '/v1/chat/completions']) {
      const malformed = await app.request(path, { method: 'POST', headers: authHeaders, body: '{ not json' });
      expect(malformed.status).toBe(400);
      const missing = await app.request(path, { method: 'POST', headers: authHeaders,
        body: JSON.stringify({ messages: [] }) });
      expect(missing.status).toBe(400);
    }
    expect(calls.settlements).toHaveLength(0);
  });
});
