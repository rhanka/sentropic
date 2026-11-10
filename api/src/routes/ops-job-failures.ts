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
 * Client allowlist: service-client id -> ingestible targets (`'*'` = every
 * target, for the transverse k8s watcher). `null` when unconfigured: any
 * scope-holder may ingest (legacy single-watcher shape, logged once).
 */
export function parseOpsIngestAllowlist(raw: string | undefined): Record<string, string[]> | null {
  if (!raw || raw.trim().length === 0) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new Error('ops ingest allowlist is not valid JSON');
  }
  if (!isRecord(parsed)) throw new Error('ops ingest allowlist must be an object');
  const allowlist: Record<string, string[]> = {};
  for (const [clientId, targets] of Object.entries(parsed)) {
    if (!Array.isArray(targets)) throw new Error(`ops ingest allowlist entry ${JSON.stringify(clientId)} must be an array`);
    const kept = targets.filter((t): t is string => typeof t === 'string' && t.length > 0);
    if (kept.length > 0) allowlist[clientId] = kept;
  }
  return allowlist;
}

/** Strict variant for boot validation: malformed = startup failure. */
export function parseOpsIngestAllowlistStrict(raw: string | undefined): Record<string, string[]> | null {
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
  readonly allowlist?: Record<string, string[]> | null;
  readonly clock?: () => string;
}

const readLimitedBody = async (c: Context): Promise<{ text: string } | { limited: true }> => {
  const declared = c.req.header('content-length');
  if (declared !== undefined && Number(declared) > OPS_JOB_FAILURE_MAX_BODY_BYTES) return { limited: true };
  const text = await c.req.text().catch(() => null);
  if (text === null) return { limited: true };
  if (Buffer.byteLength(text, 'utf8') > OPS_JOB_FAILURE_MAX_BODY_BYTES) return { limited: true };
  return { text };
};

export const createOpsJobFailuresRouter = (options: OpsJobFailuresRouterOptions = {}): Hono => {
  const ingest = options.ingest ?? ingestOpsJobFailureEventTx;
  const guard = options.guard ?? requireOpsJobFailureIngest;
  const clock = options.clock ?? (() => new Date().toISOString());
  let warnedUnconfigured = false;
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
    const allowlist = options.allowlist ?? parseOpsIngestAllowlist(env.OPS_JOB_FAILURE_INGEST_CLIENTS_JSON);
    const client = c.get('serviceClient') as { clientId?: string } | undefined;
    const clientId = typeof client?.clientId === 'string' ? client.clientId : undefined;
    if (allowlist) {
      const allowed = clientId ? allowlist[clientId] : undefined;
      if (!allowed || (!allowed.includes('*') && !allowed.includes(validated.event.targetKey))) {
        return c.json({ error: 'forbidden_target', message: 'service client may not ingest for this target' }, 403);
      }
    } else if (!warnedUnconfigured) {
      warnedUnconfigured = true;
      logger.warn('ops ingest client allowlist unconfigured; any scope-holder may ingest for any target');
    }
    const result = await ingest(validated.event, clientId ? { ingestedBy: clientId } : undefined);
    if (result.conflict) {
      return c.json({ error: 'event_id_conflict', message: 'eventId reused with a different payload' }, 409);
    }
    return c.json(result);
  });
};
