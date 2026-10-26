// Docker-only candidate registry: resolve the unpublished dependency without changing packed bytes.
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const [manifestPath, archivePath] = process.argv.slice(2);
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const archive = readFileSync(archivePath);
const integrity = `sha512-${createHash('sha512').update(archive).digest('base64')}`;
const server = createServer((request, response) => {
  const path = decodeURIComponent(request.url.split('?')[0]);
  if (path === '/candidate.tgz') {
    response.writeHead(200, { 'content-type': 'application/octet-stream' });
    response.end(archive);
  } else if (path === `/${manifest.name}`) {
    const tarball = `http://127.0.0.1:${server.address().port}/candidate.tgz`;
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ name: manifest.name,
      'dist-tags': { latest: manifest.version }, versions: {
        [manifest.version]: { ...manifest, dist: { tarball, integrity } },
      } }));
  } else {
    response.writeHead(307, { location: `https://registry.npmjs.org${request.url}` });
    response.end();
  }
});
server.listen(0, '127.0.0.1', () => console.log(`http://127.0.0.1:${server.address().port}`));
