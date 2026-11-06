import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { assertConfig } from './publish-image.mjs';
import { publicImage } from './public-image.mjs';
import { deploymentImages } from './check-preprod-images.mjs';

const config = `sha256:${'a'.repeat(64)}`;
const body = JSON.stringify({ config: { digest: config } });
const digest = `sha256:${createHash('sha256').update(body).digest('hex')}`;
const response = (text = body, header = digest) => new Response(text, { headers: { 'docker-content-digest': header } });
const anonymous = manifest => async url => url.includes('/token?')
  ? Response.json({ token: 'anonymous-test-token' }) : manifest();

test('should inspect both Kustomize image layouts and refuse missing, tagged or foreign pins', () => {
  const yaml = `      containers:\n        - name: api\n          image: ghcr.io/rhanka/sentropic-api@${digest}\n      containers:\n      - image: ghcr.io/rhanka/sentropic-ui@${digest}\n        name: ui\n`;
  assert.equal(deploymentImages(yaml).length, 2);
  assert.throws(() => deploymentImages(yaml.replace(`sentropic-ui@${digest}`, 'sentropic-ui:abcdef')), /immutable GHCR/);
  assert.throws(() => deploymentImages(yaml.replace('ghcr.io/rhanka/sentropic-ui', 'registry.example/sentropic-ui')), /immutable GHCR/);
  assert.throws(() => deploymentImages(yaml.split('      - image:')[0]), /immutable GHCR/);
});

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

test('should reject a retired registry in hidden tracked files without printing file contents', () => {
  const dir = mkdtempSync(join(tmpdir(), 'registry-guard-'));
  const guard = resolve('scripts/ci/check-image-registry.mjs');
  try {
    mkdirSync(join(dir, 'bin')); mkdirSync(join(dir, '.github'));
    writeFileSync(join(dir, 'bin/git'), `#!${process.execPath}\nprocess.stdout.write('.github/fixture.yaml\\0');\n`, { mode: 0o755 });
    const file = join(dir, '.github/fixture.yaml');
    const run = () => spawnSync(process.execPath, [guard], { cwd: dir,
      env: { ...process.env, PATH: `${dir}/bin:${process.env.PATH}` }, encoding: 'utf8' });
    writeFileSync(file, 'image: ghcr.io/rhanka/sentropic-api:main\n');
    assert.equal(run().status, 0);
    const host = ['rg', 'fr-par', 'scw', 'cloud'].join('.');
    for (const reference of [host, host.replaceAll('.', '\\.'), host.replaceAll('.', '\\\\.')]) {
      writeFileSync(file, `private-content ${reference}/old\n`);
      const denied = run();
      assert.equal(denied.status, 1);
      assert.match(denied.stderr, /\.github\/fixture.yaml/);
      assert.doesNotMatch(denied.stderr, /private-content/);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
