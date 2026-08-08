import { zValidator } from '@hono/zod-validator';
import type {
  AuthenticatedOwnPrincipal,
  OwnerSignatureRequest,
  RelayerProvenance,
} from '@sentropic/focus';
import { Hono } from 'hono';
import { z } from 'zod';

import type { AuthUser } from '../../middleware/auth';
import { createApiFocusLiveSession } from '../../services/focus/live-session';
import { resolveTenant } from '../../services/tenancy/resolve-tenant';
import { requireWorkspaceAccess } from '../../services/workspace-access';

export const focusRouter = new Hono();

const ownerSignatureSchema = z.object({
  decision_id: z.string().trim().min(1).max(512),
  idempotency_key: z.string().trim().min(1).max(512),
}).strict();

const HTTP_RELAYER: RelayerProvenance = Object.freeze({
  transport: 'http',
  relayerId: 'sentropic-api',
  canonicalIdentity: Object.freeze({
    issuer: 'sentropic-api',
    subject: 'focus-owner-signature-route',
  }),
});

const hasMatchingSessionProof = (proof: unknown, sessionId: string): boolean =>
  typeof proof === 'object' &&
  proof !== null &&
  !Array.isArray(proof) &&
  (proof as Record<string, unknown>).sessionId === sessionId;

const isCurrentOwner = (candidate: AuthenticatedOwnPrincipal, owner: AuthenticatedOwnPrincipal): boolean =>
  candidate.principalId === owner.principalId &&
  candidate.canonicalIdentity.issuer === owner.canonicalIdentity.issuer &&
  candidate.canonicalIdentity.subject === owner.canonicalIdentity.subject &&
  candidate.authenticatedAt === owner.authenticatedAt;

focusRouter.post('/owner-signatures', zValidator('json', ownerSignatureSchema), async (c) => {
  const user = c.get('user') as AuthUser | undefined;
  if (!user?.workspaceId) return c.json({ error: 'Authentication required' }, 401);

  const body = c.req.valid('json');
  const owner: AuthenticatedOwnPrincipal = Object.freeze({
    principalId: user.userId,
    canonicalIdentity: Object.freeze({
      issuer: 'sentropic-api-session',
      subject: user.userId,
    }),
    authenticatedAt: new Date().toISOString(),
  });

  const session = createApiFocusLiveSession({
    ownPrincipal: {
      authenticate: async (request: OwnerSignatureRequest) =>
        hasMatchingSessionProof(request.authentication.proof, user.sessionId) ? owner : undefined,
    },
    relayerProvenance: {
      getRelayerProvenance: async () => HTTP_RELAYER,
    },
    authorizer: {
      authorize: async ({ owner: candidate, target }) => {
        if (!isCurrentOwner(candidate, owner) || target.workspace !== user.workspaceId) return false;

        try {
          await requireWorkspaceAccess(user.userId, target.workspace);
          const tenant = await resolveTenant({ workspaceId: target.workspace, userId: user.userId });
          return 'tenantId' in tenant;
        } catch {
          return false;
        }
      },
    },
  });

  const result = await session.sign({
    target: { workspace: user.workspaceId, decisionId: body.decision_id },
    authentication: {
      kind: 'own-principal',
      proof: Object.freeze({ sessionId: user.sessionId }),
    },
    idempotencyKey: body.idempotency_key,
  });

  return c.json(result);
});
