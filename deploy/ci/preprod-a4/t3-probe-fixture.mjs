// Synthetic HTTP endpoints for the process fault matrix; never cluster URLs.
import { createServer } from 'node:http';
import { writeFileSync } from 'node:fs';

export const emailProbe = { email: 'cutover@example.test' };
export const expectedSigningKid = 'qualified-kid';
export const observerProbes = (base = 'https://idp.test') => ({
  restrictedProbes: ['S-1','S-2'].map((id,i) => ({ id,url: `${base}/restricted${i}`,expect: 403 })),
  externalProbes: ['external-app','external-idp'].map(id => ({ id,url: `${base}/${id}`,expect: 200 })),
});
export function probeEndpoints(base = 'https://idp.test') {
  return Object.fromEntries(['appHealth', 'idpConfig', 'idpJwks', 's6Authorize', 'appMe', 'idpMe', 'emailApp', 'emailIdp']
    .map(name => [name, `${base}/${name}`]));
}
export function probeReply(url, options = {}) {
  if (/restricted[01]$/.test(url)) return new Response('excluded',{ status: 403 });
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
    const reply = probeReply(new URL(req.url, `http://${req.headers.host}`).href, { method: req.method, headers: req.headers, body });
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
