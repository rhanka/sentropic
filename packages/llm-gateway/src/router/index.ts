/**
 * Gateway Hono router — the FROZEN v1 wire surface (spec §3, D7):
 *   POST /v1/messages            (Anthropic Messages compat)
 *   POST /v1/chat/completions    (OpenAI Chat Completions compat)
 *   GET  /v1/models              (filtered by caller/pool policy)
 *   GET  /healthz                (liveness — real)
 *   GET  /readyz                 (readiness — real; DB + secret-store + pool)
 *
 * v0 PERSONAL-PASSTHROUGH: the provider-compat routes run the REAL flow
 * (spec §2) via `runJsonFlow` / `runStreamFlow` over `GatewayFlowDeps`. The
 * dispatch is a faithful provider-compat passthrough (native JSON + SSE frames,
 * spec §3b). Failures map to provider-SHAPED errors (spec §3b) — the gateway
 * NEVER exposes pooled account ids/tokens/pool errors. When no flow deps are
 * supplied the routes fall back to a provider-shaped 501 (used by the scaffold
 * unit test; the contract surface stays mounted + frozen either way).
 */

import { Hono } from 'hono';

import type { GatewayConfig } from '../config.js';
import type { GatewayFlowDeps, MeteringSink, TargetResolver } from '../flow.js';
import { runJsonFlow, runStreamFlow } from '../flow.js';
import type { GatewayWire, ProviderResponseHeaders } from '../ports/dispatch.js';
import {
  mapGatewayError,
  notImplemented,
  toProviderShapedError,
  type ProviderShapedError,
} from './errors.js';
import { SSE_CONTENT_TYPE, readModel, readStream } from '../wire.js';

export interface ReadinessProbe {
  /** True when DB + secret-store + pool are all ready (spec §8 fail-closed). */
  isReady(): Promise<boolean>;
}

export interface CreateGatewayRouterOptions {
  readonly config: GatewayConfig;
  /** Optional readiness probe; defaults to always-ready in the v0 scaffold. */
  readonly readiness?: ReadinessProbe;
  /**
   * Provider/model resolver (spec §2). When omitted the provider-compat routes
   * return a provider-shaped 501 (scaffold mode). When present the real flow runs.
   */
  readonly resolveTarget?: TargetResolver;
  /** Metering settle hook (spec §5). Required to run the real flow. */
  readonly metering?: MeteringSink;
  /** Usage estimator for never-zero settlement (spec §5). */
  readonly estimateUsage?: GatewayFlowDeps['estimateUsage'];
  /** `X-Sentropic-Request-Id` source (spec §3b). Defaults to a per-call id. */
  readonly requestId?: () => string;
}

const REQUEST_ID_HEADER = 'X-Sentropic-Request-Id';

/**
 * Allowlist of provider response headers the gateway FORWARDS (#4) for faithful
 * passthrough — request-ids, rate-limit signals, provider/version/beta markers,
 * retry hints. Lowercased. We forward ONLY these: anything off-list (including
 * any gateway/pool-internal header, hop-by-hop/transport headers, or cookies) is
 * dropped, so no pool internal can ever ride out on a provider header.
 */
const FORWARDABLE_PROVIDER_HEADERS: ReadonlySet<string> = new Set([
  // Correlation / request ids.
  'request-id',
  'x-request-id',
  'anthropic-request-id',
  'openai-organization',
  'openai-version',
  'openai-processing-ms',
  // Provider/API version + beta markers.
  'anthropic-version',
  'anthropic-beta',
  'x-api-version',
  // Rate-limit / retry signals.
  'retry-after',
  'anthropic-ratelimit-requests-limit',
  'anthropic-ratelimit-requests-remaining',
  'anthropic-ratelimit-requests-reset',
  'anthropic-ratelimit-tokens-limit',
  'anthropic-ratelimit-tokens-remaining',
  'anthropic-ratelimit-tokens-reset',
  'x-ratelimit-limit-requests',
  'x-ratelimit-remaining-requests',
  'x-ratelimit-reset-requests',
  'x-ratelimit-limit-tokens',
  'x-ratelimit-remaining-tokens',
  'x-ratelimit-reset-tokens',
]);

/** Forward the allowlisted provider headers onto the response (#4). */
const forwardProviderHeaders = (
  c: import('hono').Context,
  headers: ProviderResponseHeaders | undefined,
): void => {
  if (!headers) {
    return;
  }
  for (const [key, value] of Object.entries(headers)) {
    if (FORWARDABLE_PROVIDER_HEADERS.has(key.toLowerCase())) {
      c.header(key, value);
    }
  }
};

const defaultRequestId = (): string =>
  `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;

/** Read the request headers into a plain, lowercase-keyed record. */
const readHeaders = (raw: Headers): Record<string, string> => {
  const headers: Record<string, string> = {};
  raw.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });
  return headers;
};

/** Send a provider-shaped error with any mapped headers (spec §3b). */
const sendError = (
  c: import('hono').Context,
  error: ProviderShapedError,
  requestId: string,
): Response => {
  if (error.headers) {
    for (const [key, value] of Object.entries(error.headers)) {
      c.header(key, value);
    }
  }
  c.header(REQUEST_ID_HEADER, requestId);
  return c.json(error.body as object, error.status as 400);
};

/**
 * Build the gateway Hono app. With flow deps the provider-compat routes run the
 * REAL personal-passthrough flow; without them they return a provider-shaped
 * 501 (scaffold). The wire stays FROZEN + mountable (spec §6) either way.
 */
export const createGatewayRouter = (
  options: CreateGatewayRouterOptions,
): Hono => {
  const { config, readiness, resolveTarget, metering } = options;
  const requestId = options.requestId ?? defaultRequestId;
  const app = new Hono();

  // --- Health (real) ---
  app.get('/healthz', (c) => c.json({ status: 'ok', mode: config.mode }));

  app.get('/readyz', async (c) => {
    const ready = readiness ? await readiness.isReady() : true;
    return c.json({ status: ready ? 'ready' : 'not-ready' }, ready ? 200 : 503);
  });

  const flowDeps: GatewayFlowDeps | undefined =
    resolveTarget && metering
      ? {
          config,
          resolveTarget,
          metering,
          ...(options.estimateUsage ? { estimateUsage: options.estimateUsage } : {}),
        }
      : undefined;

  const handle = (wire: GatewayWire) => async (c: import('hono').Context) => {
    const id = requestId();

    // Scaffold mode (no flow deps): provider-shaped 501, surface stays frozen.
    if (!flowDeps) {
      return sendError(c, notImplemented(wire), id);
    }

    // Parse the provider-native body (bad JSON -> provider-shaped 400, §3b).
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return sendError(c, mapGatewayError(wire, 'bad-request'), id);
    }

    const model = readModel(body);
    if (!model) {
      // Missing/invalid model -> provider-shaped 400 bad-request.
      return sendError(c, mapGatewayError(wire, 'bad-request'), id);
    }

    const headers = readHeaders(c.req.raw.headers);
    const stream = readStream(body);
    const flowRequest = { wire, headers, body, model, stream };

    if (!stream) {
      try {
        const result = await runJsonFlow(flowDeps, flowRequest);
        forwardProviderHeaders(c, result.headers); // #4 allowlisted provider headers
        c.header(REQUEST_ID_HEADER, id);
        return c.json(result.body as object, result.status as 200);
      } catch (error) {
        return sendError(c, toProviderShapedError(wire, error), id);
      }
    }

    // Streaming: `runStreamFlow` resolves once the provider stream started
    // (first frame buffered). A failure BEFORE any byte (auth/select/dispatch/
    // first-frame) REJECTS here -> provider-shaped HTTP error, never an empty 200
    // (#6). A mid-stream failure is settled inside the stream (no retry, §2).
    let streamResult;
    try {
      streamResult = await runStreamFlow(flowDeps, flowRequest);
    } catch (error) {
      return sendError(c, toProviderShapedError(wire, error), id);
    }

    forwardProviderHeaders(c, streamResult.headers); // #4 allowlisted provider headers
    c.header('Content-Type', SSE_CONTENT_TYPE);
    c.header('Cache-Control', 'no-cache');
    c.header(REQUEST_ID_HEADER, id);
    // B3: relay provider frames VERBATIM. The gateway synthesizes NO terminator —
    // a real OpenAI transport emits its own `[DONE]`; Anthropic uses message_stop.
    // On a mid-stream error the stream simply ends (no synthetic [DONE]).
    return c.body(
      new ReadableStream<Uint8Array>({
        async start(controller) {
          const encoder = new TextEncoder();
          try {
            for await (const event of streamResult.stream) {
              controller.enqueue(encoder.encode(event.raw));
            }
          } finally {
            controller.close();
          }
        },
      }),
    );
  };

  // --- Provider-compat wire (FROZEN v1 surface) ---
  app.post('/v1/messages', handle('anthropic-messages'));
  app.post('/v1/chat/completions', handle('openai-chat-completions'));

  app.get('/v1/models', async (c) => {
    const id = requestId();
    // Filtered by caller/pool policy (spec §3). Caller-auth gates the catalog:
    // an unauthenticated caller gets a provider-shaped 401, never the pool.
    const auth = await config.callerAuth.verify(readHeaders(c.req.raw.headers));
    if (!auth.ok || !auth.cost) {
      return sendError(
        c,
        mapGatewayError('openai-chat-completions', 'caller-auth-failed'),
        id,
      );
    }
    const snapshot = await config.pool.snapshotModels(auth.cost).catch(() => []);
    c.header(REQUEST_ID_HEADER, id);
    return c.json({
      object: 'list',
      data: snapshot.map((m) => ({ id: m.id, object: 'model', owned_by: m.ownedBy })),
    });
  });

  return app;
};
