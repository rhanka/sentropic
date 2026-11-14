// Synthetic HTTP endpoints for the process fault matrix; never cluster URLs.
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { existsSync, writeFileSync } from 'node:fs';

export const emailProbe = { email: 'cutover@example.test' };
export const expectedSigningKid = 'qualified-kid';
// Synthetic verification credential and the Secret Traefik would read (SHA-1 verifier only).
export const verificationLine = 't3-verify:synthetic-verification-credential-0123456789';
export const verificationHeader = `Basic ${Buffer.from(verificationLine).toString('base64')}`;
export const verificationSpec = { basicAuth: { secret: 'a4-verification-auth', removeHeader: true } };
export const verificationSecret = { type: 'Opaque', data: { users: Buffer.from(
  `t3-verify:{SHA}${createHash('sha1').update(verificationLine.split(':')[1]).digest('base64')}\n`).toString('base64') } };
export function verificationFile(dir) {
  const path = `${dir}/verification-credential`;
  writeFileSync(path, `${verificationLine}\n`, { mode: 0o600 });
  return path;
}
export const observerProbes = (base = 'https://idp.test') => ({
  restrictedProbes: ['S-1','S-2'].map((id,i) => ({ id,url: `${base}/restricted${i}`,expect: 401 })),
  externalProbes: ['external-app','external-idp'].map(id => ({ id,url: `${base}/${id}`,expect: 200 })),
});
// Qualified paths on one synthetic origin; the trailing probe name keeps app and IdP replies apart.
export function probeEndpoints(base = 'https://idp.test') {
  return Object.fromEntries(Object.entries({ appHealth: '/api/v1/health', idpConfig: '/.well-known/openid-configuration',
    idpJwks: '/.well-known/jwks.json', s6Authorize: '/api/v1/auth/oauth/authorize', appMe: '/api/v1/me',
    idpMe: '/api/v1/auth/me', emailApp: '/api/v1/auth/email/verify-request', emailIdp: '/api/v1/auth/email/verify-request' })
    .map(([name, path]) => [name, `${base}${path}?probe=${name}`]));
}
// Restricted routes behave as Traefik basicAuth does: without the exact credential the proxy answers
// 401 with a Basic challenge and the request never reaches a workload. `open` is the state after the
// middleware is deleted (opening, or rollback), when the routes answer everyone again.
const restricted = url => /restricted[01]$/.test(url) || /[?&]probe=/.test(url);
export function probeReply(url, options = {}, open = false) {
  if (!open && restricted(url) && new Headers(options.headers).get('authorization') !== verificationHeader) {
    return new Response('401 Unauthorized\n', { status: 401, headers: { 'www-authenticate': 'Basic realm="traefik"' } });
  }
  if (/restricted[01]$/.test(url)) return new Response('application', { status: 200 });
  if (/email(App|Idp)$/.test(url)) {
    let body;
    try { body = JSON.parse(options.body); } catch { /* handler rejects invalid JSON */ }
    if (options.method !== 'POST' || new Headers(options.headers).get('content-type') !== 'application/json'
      || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body?.email ?? '')) return Response.json({ error: 'invalid_input' }, { status: 400 });
  }
  const issuer = new URL(url, 'https://idp.test').origin;
  const body = url.endsWith('appHealth') ? { status: 'ok' }
    : url.endsWith('idpConfig') ? { issuer, authorization_endpoint: `${issuer}/api/v1/auth/oauth/authorize`,
      token_endpoint: `${issuer}/api/v1/auth/oauth/token`, jwks_uri: `${issuer}/.well-known/jwks.json` }
    : url.endsWith('idpJwks') ? { keys: [{ kid: expectedSigningKid, kty: 'OKP', crv: 'Ed25519', x: 'a'.repeat(43) }] }
    : url.endsWith('Me') ? { error: { code: 'unauthorized', message: 'Authentication required.' } }
    : { success: true, delivery: 'email', expiresAt: '2099-01-01T00:00:00.000Z' };
  return new Response(JSON.stringify(body), { status: url.endsWith('s6Authorize') ? 302 : url.endsWith('Me') ? 401 : 200,
    headers: { 'content-type': 'application/json', location: '/auth/login?continue=qualified' } });
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const issued = new Map(); // Shared across app and IdP, as in PostgreSQL custody.
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    // Optional third argument: a marker file the kubectl double creates when it deletes the middleware.
    const reply = probeReply(new URL(req.url, `http://${req.headers.host}`).href, { method: req.method, headers: req.headers, body },
      Boolean(process.argv[3]) && existsSync(process.argv[3]));
    if (/email(App|Idp)$/.test(req.url) && reply.status === 200) {
      const email = JSON.parse(body).email.trim().toLowerCase();
      const recent = (issued.get(email) ?? []).filter(at => at > Date.now() - 600_000);
      if (recent.length >= 3) { res.writeHead(429); res.end(); return; }
      issued.set(email, [...recent, Date.now()]);
    }
    res.writeHead(reply.status, { ...Object.fromEntries(reply.headers), connection: 'close' });
    res.end(await reply.text());
  });
  server.listen(0, '127.0.0.1', () => writeFileSync(process.argv[2], String(server.address().port)));
}
