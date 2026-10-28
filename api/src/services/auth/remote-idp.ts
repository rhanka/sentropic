import { readFileSync } from 'node:fs';
import { and, eq } from 'drizzle-orm';
import { fromJwksPort, verifyAccessToken } from '@sentropic/oauth-verify';
import { z } from 'zod';
import type { RemoteEvidenceRoutePorts } from '../../routes/auth/remote-evidence';
import { getSentropicOAuthPorts } from '../../routes/auth/oauth';
import { db } from '../../db/client';
import { tenantMemberships, workspaceMemberships, workspaces } from '../../db/schema';
import { RemoteAuthorityError, parseRemoteJson, remoteId } from './remote-contract';
import { createRemoteEvidenceIssuer, type RemoteEvidenceIssuerPorts } from './remote-evidence';
import { loadRemoteSigner } from './remote-keys';
import { reserveRemoteEvidence, resolveRemoteLogin } from './remote-session';

const pin = z.object({ issuer: remoteId, kid: remoteId, workload: remoteId, secretRef: z.string().min(1).max(512),
  publicKeyPem: z.string().min(1).max(2048), revoked: z.boolean().optional() }).strict();
const trustSchema = z.object({ idp: pin, attestation: pin, mesh: pin }).strict();

export function createRemoteIdpEvidencePorts(
  nativeTarget?: RemoteEvidenceIssuerPorts['approvedTarget'],
): RemoteEvidenceRoutePorts {
  const clientId = process.env.REMOTE_ACTION_EVIDENCE_CLIENT_ID ?? '';
  let lastNow = -1;
  const now = () => {
    const value = Date.now();
    if (!Number.isSafeInteger(value) || value < lastNow) throw new RemoteAuthorityError('authority_unavailable');
    lastNow = value;
    return value;
  };
  return {
    expectedWorkload: clientId,
    async authenticateWorkload(request) {
      try {
        const issuer = process.env.OAUTH_ISSUER_URL;
        const resource = process.env.REMOTE_ACTION_EVIDENCE_RESOURCE;
        const authorization = request.headers.get('authorization');
        if (!issuer || !resource || !clientId || !authorization?.startsWith('Bearer ')) return null;
        const claims = await verifyAccessToken({ token: authorization.slice(7), issuer, audience: resource,
          keySource: fromJwksPort(getSentropicOAuthPorts().jwks), requiredScopes: ['remote.evidence.issue'], now: new Date() });
        if (claims.client_id !== clientId || claims.sub !== clientId || claims.cnf
          || typeof claims.exp !== 'number') return null;
        return { workload: clientId };
      } catch { return null; }
    },
    async issue(request) {
      const trustFile = process.env.REMOTE_ACTION_TRUST_FILE;
      const workload = process.env.REMOTE_ACTION_WORKLOAD_ID;
      if (!trustFile || !workload || !nativeTarget) throw new RemoteAuthorityError('authority_unavailable');
      const trust = trustSchema.parse(parseRemoteJson(readFileSync(trustFile)));
      if (trust.attestation.workload !== clientId) throw new RemoteAuthorityError('authority_unavailable');
      const signer = loadRemoteSigner(trust, 'idp', workload, (ref) => readFileSync(ref, 'utf8'));
      return createRemoteEvidenceIssuer({ ...signer, now, session: resolveRemoteLogin,
        reserve: reserveRemoteEvidence,
        async approvedTarget(digest, actor) {
          const approved = await nativeTarget(digest, actor);
          if (!approved) return null;
          // The issuer independently resolves current tenancy; A supplies no identity fields.
          const [workspace] = await db.select({ id: workspaces.id }).from(workspaces).where(and(
            eq(workspaces.id, approved.workspaceId), eq(workspaces.tenantId, approved.tenantId))).limit(1);
          const [tenant] = await db.select({ status: tenantMemberships.status }).from(tenantMemberships).where(and(
            eq(tenantMemberships.tenantId, approved.tenantId), eq(tenantMemberships.userId, actor.sub))).limit(1);
          const [member] = await db.select({ role: workspaceMemberships.role }).from(workspaceMemberships).where(and(
            eq(workspaceMemberships.workspaceId, approved.workspaceId), eq(workspaceMemberships.userId, actor.sub))).limit(1);
          return workspace && tenant?.status === 'approved' && member ? approved : null;
        },
      })(request);
    },
  };
}
