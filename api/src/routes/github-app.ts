import { createGitHubAppApi } from '@sentropic/cluster-mesh';
import { createRequireServiceAuth, type ServiceAuthPorts } from '@sentropic/mcp-auth/hono';
import type { Context, Hono } from 'hono';

import { env } from '../config/env';
import { pool } from '../db/client';
import { logger } from '../logger';
import { authenticateCmHttpRequest } from '../services/identity/cm-http-principal';
import {
  GIT_APP_BROKER_SCOPE,
  createGitHubAppHostRouter,
  createGitInvalidationBus,
  resolveGitHubAppHostConfig,
  type GitHubAppPrincipal,
} from '../services/cluster-mesh/github-app-host';
import { createPostgresGitHubAppEnvelopeStore } from '../services/cluster-mesh/github-app-envelope-store';
import { getSentropicOAuthPorts, resolveOAuthIssuer, resolveOAuthServiceResource } from './auth/oauth';

/**
 * A-LIVE W1 (plan lot M2-S) — product wiring for the SG0-app host composition.
 *
 * Everything composition-specific (registry validation, owner role, tuple
 * brokerage, custody) lives in the host module and its contract tests. This
 * file binds that composition to the product: the CM owner session, the
 * mcp-auth S2S broker guard, the real GitHub API egress
 * (`https://api.github.com`, service-scope trusted adapter), the control-stream
 * Postgres envelope store and the invalidation bus.
 *
 * Code only — the mount is inert until the three env vars are provisioned and
 * deployment happens after the GB4-P go (A-LIVE §10). A disabled or broken
 * composition mounts NOTHING and logs a single sanitized reason code: no
 * half-open enrollment surface is ever exposed.
 */
const buildServiceAuthPorts = (): ServiceAuthPorts => {
  const ports = getSentropicOAuthPorts();
  return {
    clock: ports.clock,
    dpopReplay: { recordDpopJti: ports.oauthStateStore.recordDpopJti },
    jwks: ports.jwks,
  };
};

const requireGithubAppBroker = (c: Context, next: () => Promise<void>) =>
  createRequireServiceAuth({
    issuer: resolveOAuthIssuer(c.req.raw),
    ports: buildServiceAuthPorts(),
    requiredScopes: [GIT_APP_BROKER_SCOPE],
    resource: resolveOAuthServiceResource(c.req.raw),
  })(c, next);

/** Owner sessions come from the CM authenticator, role-checked by the host. */
const resolveCmOwnerPrincipal = async (request: Request): Promise<GitHubAppPrincipal | null> => {
  const result = await authenticateCmHttpRequest(request, true);
  if (!result.accepted || !result.principal?.session) return null;
  return { ownerId: result.principal.session.userId, role: result.principal.role };
};

export const createProductGitHubAppRouter = (): Hono | null => {
  try {
    const settled = resolveGitHubAppHostConfig({
      GITHUB_APP_PUBLIC_BASE_URL: env.GITHUB_APP_PUBLIC_BASE_URL,
      GITHUB_APP_TARGETS_JSON: env.GITHUB_APP_TARGETS_JSON,
      GITHUB_APP_BROKER_BINDINGS_JSON: env.GITHUB_APP_BROKER_BINDINGS_JSON,
    });
    if (!settled.enabled) {
      logger.warn({ code: settled.disabledReason }, 'github_app_composition_disabled');
      return null;
    }
    return createGitHubAppHostRouter({
      config: settled.config,
      store: createPostgresGitHubAppEnvelopeStore({ pool }),
      github: createGitHubAppApi(),
      resolvePrincipal: resolveCmOwnerPrincipal,
      brokerMiddleware: requireGithubAppBroker,
      onCredentialsChanged: createGitInvalidationBus(),
    });
  } catch {
    // Sanitized refusal only: no env text, stack or custody detail is logged.
    logger.warn({ code: 'composition_error' }, 'github_app_composition_disabled');
    return null;
  }
};
