// Synthetic HTTP endpoints for the process fault matrix; never cluster URLs.
import { createServer } from 'node:http';
import { writeFileSync } from 'node:fs';

export function probeEndpoints(base = 'https://idp.test') {
  return Object.fromEntries(['appHealth', 'idpConfig', 'idpJwks', 's6Authorize', 'appMe', 'idpMe', 'emailApp', 'emailIdp']
    .map(name => [name, `${base}/${name}`]));
}
export function probeReply(url) {
  return new Response(null, { status: url.endsWith('s6Authorize') ? 302 : url.endsWith('Me') ? 401 : 200,
    headers: { location: '/auth/login?continue=qualified' } });
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const server = createServer((req, res) => {
    const reply = probeReply(req.url);
    res.writeHead(reply.status, { ...Object.fromEntries(reply.headers), connection: 'close' });
    res.end();
  });
  server.listen(0, '127.0.0.1', () => writeFileSync(process.argv[2], String(server.address().port)));
}
