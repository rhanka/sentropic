/**
 * Gateway Hono router — the FROZEN v1 wire surface (spec §3, D7, §16.2):
 *   POST /v1/messages            (Anthropic Messages compat)
 *   POST /v1/chat/completions    (OpenAI Chat Completions compat)
 *   POST /responses              (OpenAI Responses compat, no redirect)
 *   POST /v1/responses           (OpenAI Responses compat, same handler)
 *   GET  /v1/models              (filtered by caller/pool policy)
 *   GET  /muse-code/models       (Muse CLI catalog; same filtered list)
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
import { resolveRequestedTargets, type RoutePlanner } from '@sentropic/llm-mesh';

import type { GatewayConfig } from '../config.js';
import type { GatewayFlowDeps, MeteringSink, ResolvedTarget, TargetResolver } from '../flow.js';
import { runJsonFlow, runStreamFlow } from '../flow.js';
import { runRouteJsonFlow } from '../route-json-flow.js';
import { runRouteStreamFlow } from '../route-stream-flow.js';
import {
  routingSubjectForCost,
  type RouteFlowDeps,
  type RouteMeteringSink,
} from '../route-flow-core.js';
import type { GatewayWire, ProviderResponseHeaders, RouteAttemptDispatchPort } from '../ports/dispatch.js';
import {
  mapGatewayError,
  notImplemented,
  toProviderShapedError,
  GatewayError,
  type ProviderShapedError,
} from './errors.js';
import { SSE_CONTENT_TYPE, readModel, readStream } from '../wire.js';
import { resolveResponsesLimits, type ResponsesLimits } from '../responses-egress.js';
import {
  ensureCheckedGatewayBody, gatewayRequestBodyLimit,
  type CheckedGatewayBody, type RequestBodyLimitOptions,
} from '../request-body-limit.js';
import { authenticateCaller, validateAuthContext } from '../internal/caller-auth.js';
import type { CallerAuthRequestContext, CallerAuthResult } from '../ports/caller-auth.js';
import type { GatewayBudgetOptions } from '../ports/budget.js';
import { assertBudgetRouteDeps } from '../admission.js';
import {
  NativeCountTokensRefusal, NativeCountUpstreamError, runNativeCountTokens,
  type NativeCountTokensPort,
} from '../native-count-tokens.js';
import type { NativeCountTokensRateLimiter } from '../native-count-rate.js';

export interface ReadinessProbe {
  /** True when DB + secret-store + pool are all ready (spec §8 fail-closed). */
  isReady(): Promise<boolean>;
}

export interface CreateGatewayRouterOptions {
  readonly routeDispatch?: RouteAttemptDispatchPort;
  /** Trusted ingress reconstruction, including external scheme and rewritten path. */
  readonly publicUrl?: (req: Request) => string;
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
  /** Mesh-owned opaque route planner. Enables the consumer-neutral data plane. */
  readonly routePlanner?: RoutePlanner;
  /** Single aggregate financial settlement for an opaque route plan. */
  readonly routeMetering?: RouteMeteringSink;
  /** Trusted host/workspace/request policy projection; never reads body ownership. */
  readonly routeInput?: RouteFlowDeps['routeInput'];
  /** `X-Sentropic-Request-Id` source (spec §3b). Defaults to a per-call id. */
  readonly requestId?: () => string;
  /**
   * Opt-in budget admission (BR-47). Requires `routePlanner` with `quote()`
   * and `routeMetering`; construction fails otherwise. Absent: no quote call.
   */
  readonly budget?: GatewayBudgetOptions;
  /**
   * Host-owned provider count transport (spec §15.2): when present,
   * `POST /v1/messages/count_tokens` relays the authenticated caller body and
   * returns the provider count verbatim (real counting, never an estimate).
   * Absent: explicit provider-shaped refusal — the client falls back to its
   * own local counting. Trusted injection, never caller-selected.
   */
  readonly nativeCountTokens?: NativeCountTokensPort;
  /** Per-principal count engineering limits; omitted routers share the process-wide limiter. */
  readonly nativeCountRate?: NativeCountTokensRateLimiter;
  /**
   * Responses engineering bounds (spec §16.7). Validated at construction;
   * each field takes the stricter of the spec default and the host value.
   * Only the Responses wire enforces them; other wires stay frozen.
   */
  readonly responsesLimits?: Partial<ResponsesLimits>;
  /**
   * Trusted host body policy (spec §17.4): shared pool, host byte caps and
   * mount prefix. Absent means the process-wide bounded default; the
   * resolved Responses maxBodyBytes always bounds the Responses paths.
   */
  readonly requestBody?: RequestBodyLimitOptions;
}

const REQUEST_ID_HEADER = 'X-Sentropic-Request-Id';
const SERVED_HEADER = 'X-Sentropic-Served';

const servedHeaderValue = (target: ResolvedTarget): string =>
  `provider=${target.providerId}; model=${target.model}; transport=${target.transportProviderId}`;

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
  servedTarget?: ResolvedTarget,
): Response => {
  if (error.headers) {
    for (const [key, value] of Object.entries(error.headers)) {
      c.header(key, value);
    }
  }
  c.header(REQUEST_ID_HEADER, requestId);
  if (servedTarget) c.header(SERVED_HEADER, servedHeaderValue(servedTarget));
  return c.json(error.body as object, error.status as 400);
};

const servedTargetForError = (error: unknown): ResolvedTarget | undefined =>
  error instanceof GatewayError ? error.servedTarget : undefined;

/**
 * Build the gateway Hono app. With flow deps the provider-compat routes run the
 * REAL personal-passthrough flow; without them they return a provider-shaped
 * 501 (scaffold). The wire stays FROZEN + mountable (spec §6) either way.
 */
export const createGatewayRouter = (
  options: CreateGatewayRouterOptions,
): Hono => {
  const { config, readiness, resolveTarget, metering } = options;
  if (options.routeDispatch && (!options.routePlanner || !options.routeMetering)) {
    throw new Error('routeDispatch requires routePlanner and routeMetering');
  }
  assertBudgetRouteDeps(options.routePlanner, Boolean(options.routeMetering), options.budget);
  const requestId = options.requestId ?? defaultRequestId;
  // Spec §16.7: invalid host bounds fail fast here, before any route serves.
  const responsesLimits = resolveResponsesLimits(options.responsesLimits);
  // Spec §17.4: one checked-body policy for middleware and router; the
  // resolved Responses cap always bounds the Responses paths.
  const requestBodyOptions: RequestBodyLimitOptions = {
    ...options.requestBody,
    ...(options.requestBody?.responsesLimitBytes === undefined
      ? { responsesLimitBytes: responsesLimits.maxBodyBytes } : {}),
  };
  const app = new Hono();
  app.use('*', gatewayRequestBodyLimit(requestBodyOptions, requestId));
  const authContextFor = (req: Request, id: string): CallerAuthRequestContext => {
    try {
      const context = {
        method: req.method, url: options.publicUrl ? options.publicUrl(req) : req.url,
        requestId: id, signal: req.signal,
      };
      validateAuthContext(context);
      return context;
    } catch {
      req.signal.throwIfAborted();
      throw new GatewayError('caller-auth-unavailable', 'public URL unavailable');
    }
  };

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
  const routeFlowDeps: RouteFlowDeps | undefined = options.routePlanner && options.routeMetering
    ? {
        config, routePlanner: options.routePlanner, metering: options.routeMetering,
        ...(options.routeDispatch ? { dispatch: options.routeDispatch } : {}),
        ...(options.routeInput ? { routeInput: options.routeInput } : {}),
        ...(options.budget ? { budget: options.budget } : {}),
      }
    : undefined;

  const handle = (wire: GatewayWire) => async (c: import('hono').Context) => {
    const id = requestId();

    // Scaffold mode (no flow deps): provider-shaped 501, surface stays frozen.
    if (!routeFlowDeps && !flowDeps) {
      return sendError(c, notImplemented(wire), id);
    }

    // Spec §17.4: the checked owner supplies the sole parsed object; no
    // second req.json(), clone or merged raw buffer. Malformed, over-cap and
    // capacity refusals map here (bad JSON keeps the frozen 400; over-cap is
    // now the numeric 413 on every wire, including both Responses aliases).
    let owner: CheckedGatewayBody;
    try {
      owner = await ensureCheckedGatewayBody(c.req.raw, requestBodyOptions);
    } catch (error) {
      return sendError(c, toProviderShapedError(wire, error, undefined), id);
    }
    const body = owner.body;

    const model = readModel(body);
    if (!model) {
      // Missing/invalid model -> provider-shaped 400 bad-request.
      return sendError(c, mapGatewayError(wire, 'bad-request'), id);
    }

    const headers = readHeaders(c.req.raw.headers);
    const stream = readStream(body);
    let authContext: CallerAuthRequestContext;
    try {
      authContext = authContextFor(c.req.raw, id);
    } catch (error) {
      return sendError(c, toProviderShapedError(wire, error, model), id);
    }
    const flowRequest = {
      wire, headers, body, model, stream, authContext,
      signal: c.req.raw.signal,
      ...(wire === 'openai-responses' ? { responsesLimits } : {}),
    };

    if (!stream) {
      try {
        const result = routeFlowDeps
          ? await runRouteJsonFlow(routeFlowDeps, flowRequest)
          : await runJsonFlow(flowDeps!, flowRequest);
        forwardProviderHeaders(c, result.headers); // #4 allowlisted provider headers
        c.header(REQUEST_ID_HEADER, id);
        c.header(SERVED_HEADER, servedHeaderValue(result.servedTarget));
        return c.json(result.body as object, result.status as 200);
      } catch (error) {
        return sendError(c, toProviderShapedError(wire, error, model), id, servedTargetForError(error));
      }
    }

    // Streaming: `runStreamFlow` resolves once the provider stream started
    // (first frame buffered). A failure BEFORE any byte (auth/select/dispatch/
    // first-frame) REJECTS here -> provider-shaped HTTP error, never an empty 200
    // (#6). A mid-stream failure is settled inside the stream (no retry, §2).
    const cancellation = new AbortController();
    const abort = () => cancellation.abort(c.req.raw.signal.reason);
    c.req.raw.signal.addEventListener('abort', abort, { once: true });
    if (c.req.raw.signal.aborted) abort();
    flowRequest.signal = cancellation.signal;
    let streamResult;
    try {
      streamResult = routeFlowDeps
        ? await runRouteStreamFlow(routeFlowDeps, flowRequest)
        : await runStreamFlow(flowDeps!, flowRequest);
    } catch (error) {
      c.req.raw.signal.removeEventListener('abort', abort);
      return sendError(c, toProviderShapedError(wire, error, model), id, servedTargetForError(error));
    }

    forwardProviderHeaders(c, streamResult.headers); // #4 allowlisted provider headers
    c.header('Content-Type', SSE_CONTENT_TYPE);
    c.header('Cache-Control', 'no-cache');
    c.header(REQUEST_ID_HEADER, id);
    c.header(SERVED_HEADER, servedHeaderValue(streamResult.servedTarget));
    // B3: relay provider frames VERBATIM. The gateway synthesizes NO terminator —
    // a real OpenAI transport emits its own `[DONE]`; Anthropic uses message_stop.
    // On a mid-stream error the stream simply ends (no synthetic [DONE]).
    let closed = false;
    const detach = () => c.req.raw.signal.removeEventListener('abort', abort);
    return c.body(
      new ReadableStream<Uint8Array>({
        async pull(controller) {
          try {
            const next = await streamResult.stream.next();
            if (closed) return;
            if (next.done) { closed = true; detach(); controller.close(); }
            else controller.enqueue(new TextEncoder().encode(next.value.raw));
          } catch (error) {
            if (!closed) { closed = true; detach(); controller.error(error); }
          }
        },
        async cancel(reason) {
          closed = true;
          cancellation.abort(reason);
          try { await streamResult.stream.return(undefined); }
          finally { detach(); }
        },
      }),
    );
  };

  // --- Provider-compat wire (FROZEN v1 surface) ---
  app.post('/v1/messages', handle('anthropic-messages'));
  app.post('/v1/chat/completions', handle('openai-chat-completions'));
  // Responses ingress (spec §16.2): one routed handler on both aliases, no
  // redirects. Caller admission, quota, budget and cancellation match the
  // Messages/Chat flow; the wire only selects the normalizer and encoders.
  app.post('/responses', handle('openai-responses'));
  app.post('/v1/responses', handle('openai-responses'));

  // Caller-filtered model catalog (spec §3), shared by GET /v1/models and
  // GET /muse-code/models. The Muse CLI joins `/muse-code/models` to its
  // configured base URL; pointed at the gateway origin it gets the same
  // OpenAI-list shape as /v1/models. Caller-auth gates the catalog: an
  // unauthenticated caller gets a provider-shaped 401, never the pool.
  const handleListModels = async (c: import('hono').Context) => {
    const id = requestId();
    let auth: CallerAuthResult;
    try {
      auth = await authenticateCaller(
        config.callerAuth, readHeaders(c.req.raw.headers), authContextFor(c.req.raw, id),
      );
    } catch (error) {
      return sendError(c, toProviderShapedError('openai-chat-completions', error), id);
    }
    if (!auth.ok || !auth.cost) {
      return sendError(
        c,
        mapGatewayError('openai-chat-completions', 'caller-auth-failed'),
        id,
      );
    }
    const snapshot = routeFlowDeps
      ? await routeFlowDeps.routePlanner.listModels?.(
        routingSubjectForCost(auth.cost),
      ).catch(() => []) ?? []
      : await config.pool.snapshotModels(auth.cost).catch(() => []);
    c.header(REQUEST_ID_HEADER, id);
    return c.json({
      object: 'list',
      data: snapshot.map((m) => ('modelId' in m
        ? { id: m.modelId, object: 'model', owned_by: m.providerId }
        : { id: m.id, object: 'model', owned_by: m.ownedBy })),
    });
  };

  app.get('/v1/models', handleListModels);
  app.get('/muse-code/models', handleListModels);

  // Token counting (spec §15.2, Claude Code). The gateway relays the
  // authenticated, recognized request to the host-owned NativeCountTokensPort
  // and returns the provider count verbatim — real provider counting, never
  // an estimate (an estimate would corrupt Anthropic cache accounting).
  // Malformed bodies and missing models get a provider-shaped 400 before
  // authentication; authenticated callers get the frozen unknown-model 404
  // only for unrecognized IDs. Without a port the route keeps an explicit
  // provider-shaped refusal (the client falls back to its own local
  // counting). Authentication always precedes account/pool access. The
  // gateway itself takes no lease and meters nothing on any count path; the
  // host port may acquire an advisory account lease whose outcome never
  // degrades the account (spec §15.2).
  app.post('/v1/messages/count_tokens', async (c) => {
    const id = requestId();
    if (!routeFlowDeps && !flowDeps) {
      return sendError(c, notImplemented('anthropic-messages'), id);
    }
    // Count reads through the same checked owner (no second parse) and
    // skips every financial hook below; malformed/refused bodies release.
    let countOwner: CheckedGatewayBody;
    try {
      countOwner = await ensureCheckedGatewayBody(c.req.raw, requestBodyOptions);
    } catch (error) {
      return sendError(c, toProviderShapedError('anthropic-messages', error, undefined), id);
    }
    const body = countOwner.body;
    const model = readModel(body);
    if (!model) {
      return sendError(c, mapGatewayError('anthropic-messages', 'bad-request'), id);
    }
    let auth: CallerAuthResult;
    try {
      auth = await authenticateCaller(
        config.callerAuth, readHeaders(c.req.raw.headers), authContextFor(c.req.raw, id),
      );
    } catch (error) {
      return sendError(c, toProviderShapedError('anthropic-messages', error), id);
    }
    if (!auth.ok || !auth.cost) {
      return sendError(
        c,
        mapGatewayError('anthropic-messages', 'caller-auth-failed'),
        id,
      );
    }
    if (flowDeps) {
      if (!flowDeps.resolveTarget(model)) {
        return sendError(
          c,
          toProviderShapedError(
            'anthropic-messages', new GatewayError('unknown-model', 'unknown model'), model,
          ),
          id,
        );
      }
    } else if (routeFlowDeps) {
      // Account-independent catalog/alias recognition: the executable
      // inventory only lists ready accounts, so an empty or unready pool
      // must not turn a known model into an unknown-model 404. This is the
      // same recognition the planner inference path starts from.
      const resolution = resolveRequestedTargets({ requestedModel: model });
      if (resolution.kind === 'unknown-model') {
        return sendError(
          c,
          toProviderShapedError(
            'anthropic-messages', new GatewayError('unknown-model', 'unknown model'), model,
          ),
          id,
        );
      }
    }
    try {
      const result = await runNativeCountTokens({
        port: options.nativeCountTokens,
        rate: options.nativeCountRate,
      }, {
        cost: auth.cost, body, headers: readHeaders(c.req.raw.headers),
        signal: c.req.raw.signal, requestId: id,
      });
      forwardProviderHeaders(c, result.headers);
      c.header(REQUEST_ID_HEADER, id);
      return c.json(result.body as object, 200);
    } catch (error) {
      if (error instanceof NativeCountTokensRefusal || error instanceof NativeCountUpstreamError) {
        return sendError(c, error.response, id);
      }
      return sendError(c, toProviderShapedError('anthropic-messages', error, model), id);
    }
  });

  return app;
};
