import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { assertConfig } from './publish-image.mjs';
import { publicImage } from './public-image.mjs';

const config = `sha256:${'a'.repeat(64)}`;
const body = JSON.stringify({ config: { digest: config } });
const digest = `sha256:${createHash('sha256').update(body).digest('hex')}`;
const response = (text = body, header = digest) => new Response(text, { headers: { 'docker-content-digest': header } });
const anonymous = manifest => async url => url.includes('/token?')
  ? Response.json({ token: 'anonymous-test-token' }) : manifest();

test('should accept the tested config and refuse an immutable tag collision or index', () => {
  assert.doesNotThrow(() => assertConfig(JSON.parse(body), config));
  assert.throws(() => assertConfig(JSON.parse(body), `sha256:${'b'.repeat(64)}`), /tested image/);
  assert.throws(() => assertConfig({ manifests: [] }, config), /tested image/);
});

test('should verify public manifest bytes by digest without account credentials', async () => {
  const seen = [];
  const r = await publicImage(`ghcr.io/rhanka/sentropic-api@${digest}`, async (url, options) => {
    seen.push({ url, options });
    return anonymous(() => response())(url);
  });
  assert.equal(r.digest, digest);
  assert.equal(r.manifest.config.digest, config);
  assert.equal(seen[0].options, undefined);
  assert.equal(seen[1].options.headers.Authorization, 'Bearer anonymous-test-token');
});

test('should reject private packages, corrupt bytes and a changed pinned digest', async () => {
  await assert.rejects(publicImage('ghcr.io/rhanka/sentropic-e2e:abcdef', async () => new Response('', { status: 403 })), /Anonymous/);
  await assert.rejects(publicImage('ghcr.io/rhanka/sentropic-ui:abcdef', anonymous(() => new Response('', { status: 401 }))), /Anonymous/);
  await assert.rejects(publicImage('ghcr.io/rhanka/sentropic-ui:abcdef', anonymous(() => response('altered'))), /digest mismatch/);
  await assert.rejects(publicImage(`ghcr.io/rhanka/sentropic-api@sha256:${'b'.repeat(64)}`, anonymous(() => response())), /digest mismatch/);
});

test('should reject an external registry or a package outside the approved three', async () => {
  await assert.rejects(publicImage('registry.example/sentropic-api:abcdef'), /Expected a public/);
  await assert.rejects(publicImage('ghcr.io/rhanka/other:abcdef'), /Expected a public/);
});
