// Service-authenticated ingestion route for OpsJobFailureV1 (notify L1).
//
// `POST /ingest` accepts the frozen v1 event from the k8s watcher (source
// `k8s`) and in-app jobs (source `app`). Authentication is an OAuth
// service-client bearer (scope below); the TEM secret never leaves the api.
// The authenticated client id is bound to the target: when
// `OPS_JOB_FAILURE_INGEST_CLIENTS_JSON` is set, only listed clients may
// ingest for their targets. The body is capped (`OPS_JOB_FAILURE_MAX_BODY_BYTES`).

import { createRequireServiceAuth, type ServiceAuthPorts } from '@sentropic/mcp-auth/hono';
import {
  OPS_JOB_FAILURE_MAX_BODY_BYTES,
  validateOpsJobFailureV1,
  type OpsJobFailureV1,
} from '@sentropic/cluster-mesh/notifications';
import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { env } from '../config/env';
import { logger } from '../logger';
import { ingestOpsJobFailureEventTx, type OpsIngestResult } from '../services/notifications/ops-ingest';
import { getSentropicOAuthPorts, resolveOAuthIssuer, resolveOAuthServiceResource } from './auth/oauth';

/** OAuth scope the k8s watcher and app jobs present to ingest events. */
export const OPS_JOB_FAILURE_INGEST_SCOPE = 'service:ops-job-failure-ingest';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/**
 * Client allowlist: service-client id -> ingestible targets and sources.
 * Accepted shapes per client: `["target", "*"]` (any source, legacy) or
 * `{ "targets": [...], "sources": ["k8s", "app"] }` (source-bound).
 * `'*'` as a target means every target (transverse k8s watcher).
 * `null` when unconfigured: the route denies every ingestion (fail-closed).
 */
export interface OpsIngestClientBinding {
  readonly targets: string[];
  readonly sources: string[];
}

export type OpsIngestAllowlist = Record<string, OpsIngestClientBinding>;

const OPS_INGEST_SOURCES = new Set(['k8s', 'app']);

const normalizeBinding = (clientId: string, value: unknown): OpsIngestClientBinding | null => {
  if (Array.isArray(value)) {
    const targets = value.filter((t): t is string => typeof t === 'string' && t.length > 0);
    if (targets.length === 0) return null;
    return { targets, sources: ['k8s', 'app'] };
  }
  if (isRecord(value)) {
    const targetsRaw = value['targets'];
    if (!Array.isArray(targetsRaw)) throw new Error(`ops ingest allowlist entry ${JSON.stringify(clientId)} must be an array or { targets, sources }`);
    const targets = targetsRaw.filter((t): t is string => typeof t === 'string' && t.length > 0);
    if (targets.length === 0) return null;
    const sourcesRaw = value['sources'];
    const sources = sourcesRaw === undefined
      ? ['k8s', 'app']
      : (Array.isArray(sourcesRaw) ? sourcesRaw.filter((s): s is string => typeof s === 'string' && OPS_INGEST_SOURCES.has(s)) : null);
    if (sources === null || sources.length === 0) {
      throw new Error(`ops ingest allowlist entry ${JSON.stringify(clientId)} has no valid source (k8s|app)`);
    }
    return { targets, sources };
  }
  throw new Error(`ops ingest allowlist entry ${JSON.stringify(clientId)} must be an array or { targets, sources }`);
};

export function parseOpsIngestAllowlist(raw: string | undefined): OpsIngestAllowlist | null {
  if (!raw || raw.trim().length === 0) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new Error('ops ingest allowlist is not valid JSON');
  }
  if (!isRecord(parsed)) throw new Error('ops ingest allowlist must be an object');
  const allowlist: OpsIngestAllowlist = {};
  for (const [clientId, value] of Object.entries(parsed)) {
    const binding = normalizeBinding(clientId, value);
    if (binding) allowlist[clientId] = binding;
  }
  return allowlist;
}

/** Strict variant for boot validation: malformed = startup failure. */
export function parseOpsIngestAllowlistStrict(raw: string | undefined): OpsIngestAllowlist | null {
  return parseOpsIngestAllowlist(raw);
}

const buildServiceAuthPorts = (): ServiceAuthPorts => {
  const ports = getSentropicOAuthPorts();
  return {
    clock: ports.clock,
    dpopReplay: { recordDpopJti: ports.oauthStateStore.recordDpopJti },
    jwks: ports.jwks,
  };
};

export const requireOpsJobFailureIngest: MiddlewareHandler = (c: Context, next: () => Promise<void>) =>
  createRequireServiceAuth({
    issuer: resolveOAuthIssuer(c.req.raw),
    ports: buildServiceAuthPorts(),
    requiredScopes: [OPS_JOB_FAILURE_INGEST_SCOPE],
    resource: resolveOAuthServiceResource(c.req.raw),
  })(c, next);

export interface OpsJobFailuresRouterOptions {
  readonly ingest?: (event: OpsJobFailureV1, options?: { ingestedBy?: string }) => Promise<OpsIngestResult>;
  readonly guard?: MiddlewareHandler;
  readonly allowlist?: OpsIngestAllowlist | Record<string, string[]> | null;
  readonly clock?: () => string;
}

const bindingFor = (allowlist: OpsIngestAllowlist | Record<string, string[]>, clientId: string): OpsIngestClientBinding | undefined => {
  const raw = (allowlist as Record<string, unknown>)[clientId] as OpsIngestClientBinding | string[] | undefined;
  if (!raw) return undefined;
  if (Array.isArray(raw)) return { targets: raw, sources: ['k8s', 'app'] };
  return raw as OpsIngestClientBinding;
};

const readLimitedBody = async (c: Context): Promise<{ text: string } | { limited: true }> => {
  const declared = c.req.header('content-length');
  if (declared !== undefined && Number(declared) > OPS_JOB_FAILURE_MAX_BODY_BYTES) return { limited: true };
  // Streaming bound: never buffer an unbounded body when the emitter omits
  // Content-Length. Chunks are counted as they arrive; the first byte past
  // the limit aborts the read instead of materializing the whole payload.
  const body = c.req.raw.body;
  if (body) {
    const reader = body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > OPS_JOB_FAILURE_MAX_BODY_BYTES) {
          await reader.cancel().catch(() => {});
          return { limited: true };
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return { text: new TextDecoder('utf-8').decode(merged) };
  }
  const text = await c.req.text().catch(() => null);
  if (text === null) return { limited: true };
  if (Buffer.byteLength(text, 'utf8') > OPS_JOB_FAILURE_MAX_BODY_BYTES) return { limited: true };
  return { text };
};

export const createOpsJobFailuresRouter = (options: OpsJobFailuresRouterOptions = {}): Hono => {
  const ingest = options.ingest ?? ingestOpsJobFailureEventTx;
  const guard = options.guard ?? requireOpsJobFailureIngest;
  const clock = options.clock ?? (() => new Date().toISOString());
  return new Hono().post('/ingest', guard, async (c) => {
    const raw = await readLimitedBody(c);
    if ('limited' in raw) return c.json({ error: 'body_too_large', message: 'ingestion body exceeds the limit' }, 413);
    let body: unknown;
    try {
      body = JSON.parse(raw.text) as unknown;
    } catch {
      return c.json({ error: 'not_an_object', message: 'event must be an object' }, 400);
    }
    const validated = validateOpsJobFailureV1(body, { nowIso: clock() });
    if (!validated.ok) {
      return c.json({ error: validated.code, message: validated.message }, 400);
    }
    const allowlist = options.allowlist !== undefined
      ? (options.allowlist as OpsIngestAllowlist | Record<string, string[]> | null)
      : parseOpsIngestAllowlist(env.OPS_JOB_FAILURE_INGEST_CLIENTS_JSON);
    const client = c.get('serviceClient') as { clientId?: string } | undefined;
    const clientId = typeof client?.clientId === 'string' ? client.clientId : undefined;
    // Fail-closed: no allowlist (production default) denies every ingestion;
    // a configured client is bound to both its targets and its sources.
    if (!allowlist) {
      logger.error('ops ingest client allowlist unconfigured; denying ingestion');
      return c.json({ error: 'forbidden_target', message: 'ingestion is not configured for any service client' }, 403);
    }
    const binding = clientId ? bindingFor(allowlist, clientId) : undefined;
    if (!binding
      || (!binding.targets.includes('*') && !binding.targets.includes(validated.event.targetKey))
      || !binding.sources.includes(validated.event.source)) {
      return c.json({ error: 'forbidden_target', message: 'service client may not ingest for this target' }, 403);
    }
    const result = await ingest(validated.event, clientId ? { ingestedBy: clientId } : undefined);
    if (result.conflict) {
      return c.json({ error: 'event_id_conflict', message: 'eventId reused with a different payload' }, 409);
    }
    if (result.quotaExceeded) {
      return c.json({ error: 'queue_full', message: 'target queue is full, retry later' }, 429);
    }
    return c.json(result);
  });
};
