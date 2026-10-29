import { decodeJwt } from 'jose';

let cached: { configuration: string; expiresAt: number; token: Promise<string> } | undefined;

// Bind reuse to all S2S configuration, including credential rotation. Share in-flight issuance.
export async function remoteRevocationToken(issuer: string, clientId: string, secret: string, resource: string): Promise<string> {
  const configuration = JSON.stringify([issuer, clientId, secret, resource]);
  if (cached?.configuration === configuration && cached.expiresAt > Date.now() + 30_000) return cached.token;
  const entry = { configuration, expiresAt: Infinity, token: Promise.resolve('') };
  entry.token = (async () => {
    const response = await fetch(`${issuer}/api/v1/auth/oauth/token`, { method: 'POST',
      body: new URLSearchParams({ grant_type: 'client_credentials', scope: 'remote.sessions.revoke', resource }).toString(),
      headers: { 'content-type': 'application/x-www-form-urlencoded',
        authorization: `Basic ${Buffer.from(`${encodeURIComponent(clientId)}:${encodeURIComponent(secret)}`).toString('base64')}` },
      redirect: 'error', signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error('token_unavailable');
    const token = await response.json() as { access_token?: string; token_type?: string };
    if (!token.access_token || token.token_type?.toLowerCase() !== 'bearer') throw new Error('token_refused');
    const exp = decodeJwt(token.access_token).exp;
    if (typeof exp !== 'number' || !Number.isFinite(exp) || exp * 1000 <= Date.now()) throw new Error('token_expired');
    entry.expiresAt = exp * 1000;
    return token.access_token;
  })();
  cached = entry;
  try { return await entry.token; }
  catch (error) {
    if (cached === entry) cached = undefined;
    throw error;
  }
}
