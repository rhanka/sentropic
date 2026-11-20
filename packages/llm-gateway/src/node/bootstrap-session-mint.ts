import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { AcquireSessionInput, GatewaySessionService } from '../session-service.js';
import { GatewayStateError } from '../ports/gateway-state.js';

export const BOOTSTRAP_MAX_SKEW_MS = 60_000;
export const BOOTSTRAP_NONCE_TTL_MS = 300_000;
export const BOOTSTRAP_MAX_NONCES = 4_096;
export const BOOTSTRAP_RATE_BURST = 10;
export const BOOTSTRAP_RATE_REFILL_PER_SEC = 1;
export const BOOTSTRAP_MAX_TTL_DAYS = 1;
const MAX_BODY_BYTES = 65_536;

export interface BootstrapProofInput {
  readonly secret: string;
  readonly method: string;
  readonly path: string;
  readonly timestampMs: number;
  readonly nonce: string;
  readonly body: string;
}

export const computeBootstrapProof = (input: BootstrapProofInput): string => {
  const bodySha256 = createHash('sha256').update(input.body, 'utf8').digest('hex');
  const canonical = `${input.method.toUpperCase()}\n${input.path}\n${input.timestampMs}\n${input.nonce}\n${bodySha256}`;
  return createHmac('sha256', input.secret).update(canonical, 'utf8').digest('hex');
};

const jsonError = (status: number, type: string, message: string): Response =>
  new Response(JSON.stringify({ type: 'error', error: { type, message } }), {
    status, headers: { 'content-type': 'application/json' },
  });

export interface LoopbackSessionMintOptions {
  readonly service: GatewaySessionService;
  readonly ownerScopeRef: string;
  readonly bootstrapSecret: string;
  readonly beforeAcquire?: (input: Record<string, unknown>) => Promise<void>;
  readonly now?: () => number;
  readonly maxNonces?: number;
}

export const createLoopbackSessionMintHandler = (options: LoopbackSessionMintOptions) => {
  if (!options.bootstrapSecret || options.bootstrapSecret.length < 32) {
    throw new GatewayStateError('loopback bootstrap secret must be at least 32 characters', 'STORE-FAILED');
  }
  const now = options.now ?? (() => Date.now());
  const maxNonces = options.maxNonces ?? BOOTSTRAP_MAX_NONCES;
  const nonces = new Map<string, number>();
  let tokens = BOOTSTRAP_RATE_BURST;
  let lastRefillMs = now();

  const takeToken = (ts: number): boolean => {
    if (ts > lastRefillMs) {
      tokens = Math.min(BOOTSTRAP_RATE_BURST, tokens + ((ts - lastRefillMs) / 1000) * BOOTSTRAP_RATE_REFILL_PER_SEC);
      lastRefillMs = ts;
    }
    if (tokens < 1) return false;
    tokens -= 1;
    return true;
  };

  return async (request: Request): Promise<Response | undefined> => {
    const url = new URL(request.url);
    if (request.method !== 'POST' || url.pathname !== '/v1/session') return undefined;
    const tsNow = now();
    if (!takeToken(tsNow)) return jsonError(429, 'rate_limit_error', 'bootstrap session mint rate limit exceeded');

    const proof = request.headers.get('x-sentropic-bootstrap-proof') ?? '';
    const rawTs = request.headers.get('x-sentropic-bootstrap-timestamp') ?? '';
    const nonce = request.headers.get('x-sentropic-bootstrap-nonce') ?? '';
    const timestampMs = Number(rawTs);
    if (!proof || !nonce || nonce.length > 128 || !Number.isSafeInteger(timestampMs)
      || Math.abs(tsNow - timestampMs) > BOOTSTRAP_MAX_SKEW_MS) {
      return jsonError(401, 'authentication_error', 'authentication failed');
    }
    const rawBody = await request.text();
    if (Buffer.byteLength(rawBody, 'utf8') > MAX_BODY_BYTES) return jsonError(413, 'request_too_large', 'request body too large');
    const expected = Buffer.from(computeBootstrapProof({
      secret: options.bootstrapSecret, method: request.method, path: url.pathname, timestampMs, nonce, body: rawBody,
    }), 'utf8');
    const actual = Buffer.from(proof, 'utf8');
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      return jsonError(401, 'authentication_error', 'authentication failed');
    }
    for (const [key, expiresAt] of nonces) {
      if (expiresAt <= tsNow) nonces.delete(key);
    }
    if (nonces.has(nonce)) return jsonError(401, 'authentication_error', 'authentication failed');
    if (nonces.size >= maxNonces) return jsonError(503, 'api_error', 'bootstrap anti-replay store exhausted');
    nonces.set(nonce, tsNow + BOOTSTRAP_NONCE_TTL_MS);

    let parsed: Record<string, unknown>;
    try {
      const value = JSON.parse(rawBody);
      if (!value || typeof value !== 'object' || Array.isArray(value)) return jsonError(400, 'invalid_request_error', 'invalid request');
      parsed = value as Record<string, unknown>;
    } catch { return jsonError(400, 'invalid_request_error', 'invalid request'); }
    if (parsed.ownerScopeRef !== undefined && parsed.ownerScopeRef !== options.ownerScopeRef) {
      return jsonError(401, 'authentication_error', 'authentication failed');
    }
    const reqTtl = typeof parsed.ttlDays === 'number' && Number.isFinite(parsed.ttlDays) && parsed.ttlDays > 0
      ? parsed.ttlDays : BOOTSTRAP_MAX_TTL_DAYS;
    const input: AcquireSessionInput = {
      ...(parsed as unknown as AcquireSessionInput),
      ownerScopeRef: options.ownerScopeRef,
      ttlDays: Math.min(reqTtl, BOOTSTRAP_MAX_TTL_DAYS),
    };
    try {
      await options.beforeAcquire?.(input as unknown as Record<string, unknown>);
      const issued = await options.service.acquireSession(input);
      return new Response(JSON.stringify(issued), { status: 200, headers: { 'content-type': 'application/json' } });
    } catch {
      return jsonError(400, 'invalid_request_error', 'session acquisition refused');
    }
  };
};
