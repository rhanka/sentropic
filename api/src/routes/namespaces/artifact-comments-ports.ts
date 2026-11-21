import type { TenantContext } from '@sentropic/contracts';
import type {
  ArtifactCommentsHttpPrincipal,
  CreateArtifactCommentsRouterOptions,
} from '@sentropic/comments/artifact-hono';
import { HTTPException } from 'hono/http-exception';
import type { Pool } from 'pg';

import { env } from '../../config/env';
import { pool as defaultPool } from '../../db/client';
import type { AuthUser } from '../../middleware/auth';
import { resolveOAuthIssuer } from '../auth/oauth';
import {
  artifactCredential,
  ARTIFACT_SESSION_CLIENT,
  createCurrentArtifactIdentity,
} from '../../services/artifacts/credentials';
import {
  createPostgresArtifactCommentAuthz,
  type ArtifactCommentAuthzPorts,
} from '../../services/comments/artifact-comment-authz';
import { commentEventSink, commentStore } from '../../services/comments/instance';
import { PgNotifyCommentEventSink } from '../../services/comments/pg-notify-comment-event-sink';
import {
  CmTenantResolutionError,
  findCmWorkspaceMember,
  reconcileCmTenantId,
  resolveCmTenant,
} from '../../services/identity/cm-tenancy';
import { H2A_CLI_CLIENT_ID } from '../../services/mcp/client-policy';
import { hasWorkspaceRole } from '../../services/workspace-access';

export interface ProductArtifactCommentsPortDeps {
  readonly pool?: Pool;
  readonly sharingPolicy?: ArtifactCommentAuthzPorts['sharingPolicy'];
}

export const createProductArtifactCommentsRouterOptions = (
  deps: ProductArtifactCommentsPortDeps = {},
): CreateArtifactCommentsRouterOptions => {
  const pool = deps.pool ?? defaultPool;
  const resource = env.MCP_RESOURCE_URI ?? `${resolveOAuthIssuer()}/api/v1/mcp`;
  const authorizeArtifactComment = createPostgresArtifactCommentAuthz({
    pool,
    currentIdentity: createCurrentArtifactIdentity(resource),
    sharingPolicy: deps.sharingPolicy,
  });
  const sessionByPrincipal = new WeakMap<ArtifactCommentsHttpPrincipal, string>();

  return {
    store: commentStore,
    events: deps.pool ? new PgNotifyCommentEventSink({ pool: deps.pool }) : commentEventSink,
    nonHumanClientIds: [H2A_CLI_CLIENT_ID],
    authz: {
      resolvePrincipal(context) {
        const user = context.get('user') as AuthUser | undefined;
        if (!user?.userId || !user.workspaceId || !user.sessionId) return undefined;
        const principal: ArtifactCommentsHttpPrincipal = {
          userId: user.userId,
          workspaceId: user.workspaceId,
          clientId: ARTIFACT_SESSION_CLIENT,
        };
        sessionByPrincipal.set(principal, user.sessionId);
        return principal;
      },
      async authorizeArtifact({ principal, artifactId, action }) {
        const sessionId = sessionByPrincipal.get(principal);
        if (!sessionId) return { ok: false, status: 404, code: 'artifact_not_found' };
        const tenant = await resolveCmTenant({
          userId: principal.userId,
          workspaceId: principal.workspaceId,
        });
        if ('error' in tenant) return { ok: false, status: 404, code: 'artifact_not_found' };
        const decision = await authorizeArtifactComment({
          identity: {
            subject: principal.userId,
            tenantId: tenant.tenantId,
            clientId: ARTIFACT_SESSION_CLIENT,
            credentialId: artifactCredential('session', sessionId),
          },
          workspaceId: principal.workspaceId,
          artifactId,
          action,
        });
        return decision.ok
          ? { ok: true }
          : { ok: false, status: decision.status, code: decision.code };
      },
      isAdmin: (principal) => hasWorkspaceRole(principal.userId, principal.workspaceId, 'admin'),
    },
    tenant: {
      async resolve(principal): Promise<TenantContext> {
        const tenantId = await reconcileCmTenantId({
          workspaceId: principal.workspaceId,
          userId: principal.userId,
          path: 'artifact-comments',
        }).catch((error) => {
          if (error instanceof CmTenantResolutionError) {
            throw new HTTPException(403, {
              res: Response.json({ error: 'Tenant access required' }, { status: 403 }),
            });
          }
          throw error;
        });
        return {
          tenantId,
          workspaceId: principal.workspaceId,
          userId: principal.userId,
        };
      },
      async memberExists({ userId, workspaceId }) {
        const row = await findCmWorkspaceMember(workspaceId, userId);
        return Boolean(row);
      },
    },
  };
};
