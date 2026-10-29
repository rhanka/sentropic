import { logger } from '../../logger';
import { closeRemoteSessionAuthority, getRemoteSessionAuthority } from './remote-private-session';
import { RemoteAuthorityError } from './remote-contract';
import { revocationMac, revocationPath, revocationServiceOrigin, signRevocation, validRevocationMac } from './remote-revocation-transport';
import { acknowledgeRemoteRevocation, pendingRemoteRevocations, queueRemoteRevocation } from './remote-revocation-outbox';

export interface RemoteSessionRevocation { sessionIds: string[]; userId?: string }

// Only the issuer invokes this port. Failure closes remote authority until operator recovery.
export function persistRemoteSessionRevocation(input: RemoteSessionRevocation): boolean {
  let failed = false;
  try {
    const authority = getRemoteSessionAuthority();
    if (!authority) throw new Error('issuer_required');
    for (const id of input.sessionIds) {
      try { authority.revoke(id); } catch { failed = true; }
    }
    if (input.userId) {
      try { authority.revokeUser(input.userId); } catch { failed = true; }
    }
  } catch { failed = true; }
  if (failed) {
    closeRemoteSessionAuthority();
    logger.error({ code: 'authority_unavailable' }, 'Remote session revocation requires issuer recovery');
  }
  return !failed;
}

// Called after the DB delete: private storage must never prevent ordinary logout.
export async function tombstoneRemoteSessions(input: RemoteSessionRevocation, pendingKey?: string): Promise<void> {
  if (process.env.REMOTE_ACTION_ROLE === 'auth-idp') {
    persistRemoteSessionRevocation(input);
    return;
  }
  try {
    const configured = process.env.REMOTE_ACTION_REVOCATION_ISSUER;
    if (!configured && process.env.REMOTE_ACTION_ROLE !== 'product') return;
    pendingKey ??= await queueRemoteRevocation(input);
    if (!configured) throw new Error();
    const issuer = new URL(configured);
    const clientId = process.env.REMOTE_ACTION_REVOCATION_CLIENT_ID;
    const secret = process.env.REMOTE_ACTION_REVOCATION_CLIENT_SECRET;
    const resource = process.env.REMOTE_ACTION_REVOCATION_RESOURCE;
    if (issuer.protocol !== 'https:' || issuer.username || issuer.password || issuer.search || issuer.hash
      || issuer.pathname !== '/' || !clientId || !secret || !resource) throw new Error();
    const post = (path: string, body: string, headers: Record<string, string>) => fetch(`${issuer.origin}${path}`, {
      method: 'POST', body, headers, redirect: 'error', signal: AbortSignal.timeout(5000),
    });
    const result = await post('/api/v1/auth/oauth/token', new URLSearchParams({ grant_type: 'client_credentials',
      scope: 'remote.sessions.revoke', resource }).toString(), {
      'content-type': 'application/x-www-form-urlencoded',
      authorization: `Basic ${Buffer.from(`${encodeURIComponent(clientId)}:${encodeURIComponent(secret)}`).toString('base64')}`,
    });
    if (!result.ok) throw new Error();
    const token = await result.json() as { access_token?: string; token_type?: string };
    if (!token.access_token || token.token_type?.toLowerCase() !== 'bearer') throw new Error();
    for (let index = 0; index < Math.max(1, input.sessionIds.length); index += 16) {
      const body = JSON.stringify({
        sessionIds: input.sessionIds.slice(index, index + 16), ...(input.userId ? { userId: input.userId } : {}),
      });
      const authorization = `Bearer ${token.access_token}`;
      const signed = signRevocation(body, authorization);
      const response = await fetch(`${revocationServiceOrigin}${revocationPath}`, { method: 'POST', body,
        headers: { 'content-type': 'application/json', authorization, ...signed },
        redirect: 'error', signal: AbortSignal.timeout(5000) });
      if (response.status !== 204 || !validRevocationMac(revocationMac('ack', signed['x-revocation-mac']),
        response.headers.get('x-revocation-ack'))) throw new Error();
    }
    if (pendingKey) await acknowledgeRemoteRevocation(pendingKey);
  } catch {
    // The DB deletion is already committed. Never claim issuer acknowledgement on delivery failure.
    logger.error({ code: 'authority_unavailable' }, 'Issuer revocation delivery requires recovery');
    throw new RemoteAuthorityError('authority_unavailable');
  }
}

// The existing periodic approval sweep also drains committed revocations after process restart.
export async function retryRemoteRevocations(): Promise<void> {
  if (process.env.REMOTE_ACTION_ROLE !== 'product') return;
  for (const row of await pendingRemoteRevocations()) {
    try { await tombstoneRemoteSessions(JSON.parse(row.value!), row.key); }
    catch { break; } // Keep the oldest intent and retry on the next sweep; no busy loop.
  }
}
