import type { AuthHonoPorts, AuthHonoUserPort, AuthHonoAccountPolicyPort } from '@sentropic/auth-hono';
import type { IdentityAuthBindingInput } from '../identity-contracts/custody-auth.js';
import type { VerifiedLoginClaimsV1 } from '../identity-contracts/custody.js';
import type { IdentityAuditEvent } from '../identity-contracts/types.js';
import { IdentityCustodyErrorV1 } from '../identity-contracts/custody-errors.js';

export const authBoundaryPorts = <H>(input: IdentityAuthBindingInput<H>, users: AuthHonoUserPort, policy: AuthHonoAccountPolicyPort, check: () => void) => {
  const tokenEvidence = new Map<string, VerifiedLoginClaimsV1>();
  const unsupported = async (): Promise<never> => { check(); throw new IdentityCustodyErrorV1('identity_contract_unavailable'); };
  const tokens: AuthHonoPorts['tokens'] = {
    hashSecret: async (secret) => {
      check(); const bytes = Buffer.from(secret, 'utf8');
      try { return await input.digest.sha256(bytes); } finally { bytes.fill(0); }
    },
    signSessionToken: unsupported, signVerificationToken: unsupported,
    verifySessionToken: async (token) => {
      check(); const bytes = Buffer.from(token, 'utf8'), now = input.hostPorts.clock.now();
      try {
        let claims;
        try { claims = await input.loginTokens.verify(bytes, 'session', now.toISOString()); }
        catch (error) { if (error instanceof IdentityCustodyErrorV1 && error.code === 'login_binding_mismatch') return null; throw error; }
        if (claims.tokenUse !== 'session' || claims.expiresAt <= now.toISOString() || !claims.userId || !claims.sessionId) return null;
        const user = await users.findById(claims.userId);
        const role = user && ['active', 'pending_admin_approval', 'approval_expired_readonly'].includes(user.accountStatus)
          ? await policy.resolveSessionRole(user, now) : 'guest';
        tokenEvidence.set(await input.digest.sha256(bytes), claims);
        return { userId: claims.userId, sessionId: claims.sessionId, role };
      } finally { bytes.fill(0); }
    },
  };
  const events: Omit<IdentityAuditEvent, 'id'>[] = [];
  let sealed = false, drain: Promise<void> | undefined;
  const safeId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,128}$/.test(value);
  const allowedEvents = new Set(['authentication.completed', 'authentication.failed', 'auth.logout', 'auth.session.revoked',
    'federation.signin', 'federation.link', 'federation.unlink', 'oauth.end_session', 'oauth.refresh.reuse', 'oauth.token.revoked']);
  const auditLog: AuthHonoPorts['auditLog'] = { record: (level, event, fields) => {
    check(); if (sealed) throw new IdentityCustodyErrorV1('identity_transaction_unbound');
    const detail: Record<string, string | boolean> = { level };
    for (const key of ['sessionId', 'clientId', 'tenantId', 'operationId']) if (safeId(fields?.[key])) detail[key] = fields![key] as string;
    for (const key of ['success', 'allowed', 'revoked']) if (typeof fields?.[key] === 'boolean') detail[key] = fields[key] as boolean;
    events.push({ at: input.hostPorts.clock.now().toISOString(), kind: allowedEvents.has(event) ? event : 'authentication.event',
      ...(safeId(fields?.actorId) ? { actorId: fields.actorId } : {}), ...(safeId(fields?.subjectId) ? { subjectId: fields.subjectId } : {}), detail });
  } };
  return { tokens, tokenEvidence, auditLog, flushAudit: async (): Promise<void> => {
    check();
    if (!drain) { sealed = true; drain = (async () => { for (const event of events) await input.tx.ledger.append(event); })(); }
    return drain;
  } };
};
