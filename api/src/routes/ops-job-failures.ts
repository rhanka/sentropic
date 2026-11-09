// Service-authenticated ingestion route for OpsJobFailureV1 (notify L1).
//
// `POST /ingest` accepts the frozen v1 event from the k8s watcher (source
// `k8s`) and in-app jobs (source `app`). Authentication is an OAuth
// service-client bearer (scope below); the TEM secret never leaves the api.

import { createRequireServiceAuth, type ServiceAuthPorts } from '@sentropic/mcp-auth/hono';
import { validateOpsJobFailureV1, type OpsJobFailureV1 } from '@sentropic/cluster-mesh/notifications';
import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { ingestOpsJobFailureEventTx, type OpsIngestResult } from '../services/notifications/ops-ingest';
import { getSentropicOAuthPorts, resolveOAuthIssuer, resolveOAuthServiceResource } from './auth/oauth';

/** OAuth scope the k8s watcher and app jobs present to ingest events. */
export const OPS_JOB_FAILURE_INGEST_SCOPE = 'service:ops-job-failure-ingest';

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
  readonly ingest?: (event: OpsJobFailureV1) => Promise<OpsIngestResult>;
  readonly guard?: MiddlewareHandler;
}

export const createOpsJobFailuresRouter = (options: OpsJobFailuresRouterOptions = {}): Hono => {
  const ingest = options.ingest ?? ingestOpsJobFailureEventTx;
  const guard = options.guard ?? requireOpsJobFailureIngest;
  return new Hono().post('/ingest', guard, async (c) => {
    const body = await c.req.json().catch(() => null);
    const validated = validateOpsJobFailureV1(body);
    if (!validated.ok) {
      return c.json({ error: validated.code, message: validated.message }, 400);
    }
    const result = await ingest(validated.event);
    return c.json(result);
  });
};
