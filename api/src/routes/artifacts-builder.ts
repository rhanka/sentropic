import { createRequireServiceAuth, type ServiceAuthPorts } from '@sentropic/mcp-auth/hono';
import type { Context, Hono } from 'hono';

import { env } from '../config/env';
import {
  ARTIFACT_BUILDER_SCOPE,
  createBuilderMount,
  hostAuthenticator,
  parseBuilderHostBindings,
} from '../services/artifacts/live/builder-mount';
import type { HostBuildEnv } from '../services/artifacts/live/host-build-api';
import { getSentropicOAuthPorts, resolveOAuthIssuer, resolveOAuthServiceResource } from './auth/oauth';

/**
 * A-LIVE W7 (plan lot M3-B) — product mount of the builder host build API:
 * `POST /api/v1/artifacts/builder/v1/builds` and
 * `GET /api/v1/artifacts/builder/v1/builds/:artifactId/:jobId`.
 *
 * Same mechanism as the W1 broker: the mcp-auth S2S guard with the
 * `artifacts:builder` scope, then the verified client id maps to its host
 * identity through `ARTIFACT_BUILDER_HOST_BINDINGS_JSON` (default deny).
 *
 * Code only until the GB4-P go (A-LIVE §10): the composition passes
 * `createBuilderService(...)` with `authenticate: authenticateBuilderHost`;
 * until then a bound host gets 503 `builder_unavailable`.
 */
const buildServiceAuthPorts = (): ServiceAuthPorts => {
  const ports = getSentropicOAuthPorts();
  return {
    clock: ports.clock,
    dpopReplay: { recordDpopJti: ports.oauthStateStore.recordDpopJti },
    jwks: ports.jwks,
  };
};

const requireArtifactBuilder = (c: Context, next: () => Promise<void>) =>
  createRequireServiceAuth({
    issuer: resolveOAuthIssuer(c.req.raw),
    ports: buildServiceAuthPorts(),
    requiredScopes: [ARTIFACT_BUILDER_SCOPE],
    resource: resolveOAuthServiceResource(c.req.raw),
  })(c, next);

export const authenticateBuilderHost = hostAuthenticator(
  parseBuilderHostBindings(env.ARTIFACT_BUILDER_HOST_BINDINGS_JSON),
);

export const createProductArtifactBuilderRouter = (service: { api: Hono<HostBuildEnv> } | null): Hono =>
  createBuilderMount({
    requireService: requireArtifactBuilder,
    authenticate: authenticateBuilderHost,
    api: service?.api ?? null,
  });
