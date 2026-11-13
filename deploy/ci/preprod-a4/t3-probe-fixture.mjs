// Synthetic HTTP endpoints for the process fault matrix; never cluster URLs.
import { createServer } from 'node:http';
import { writeFileSync } from 'node:fs';

export const emailProbe = { email: 'cutover@example.test' };
export function probeEndpoints(base = 'https://idp.test') {
  return Object.fromEntries(['appHealth', 'idpConfig', 'idpJwks', 's6Authorize', 'appMe', 'idpMe', 'emailApp', 'emailIdp']
    .map(name => [name, `${base}/${name}`]));
}
export function probeReply(url, options = {}) {
  if (/email(App|Idp)$/.test(url)) {
    let body;
    try { body = JSON.parse(options.body); } catch { /* handler rejects invalid JSON */ }
    if (options.method !== 'POST' || new Headers(options.headers).get('content-type') !== 'application/json'
      || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body?.email ?? '')) return Response.json({ error: 'invalid_input' }, { status: 400 });
  }
  return new Response(null, { status: url.endsWith('s6Authorize') ? 302 : url.endsWith('Me') ? 401 : 200,
    headers: { location: '/auth/login?continue=qualified' } });
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const reply = probeReply(req.url, { method: req.method, headers: req.headers, body });
    res.writeHead(reply.status, { ...Object.fromEntries(reply.headers), connection: 'close' });
    res.end();
  });
  server.listen(0, '127.0.0.1', () => writeFileSync(process.argv[2], String(server.address().port)));
}
