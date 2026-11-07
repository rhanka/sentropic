import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { publish } from './publish-image.mjs';

const imageId = `sha256:${'f'.repeat(64)}`;
const configDigest = `sha256:${'a'.repeat(64)}`;
const manifest = JSON.stringify({ config: { digest: configDigest } });
const digest = text => `sha256:${createHash('sha256').update(text).digest('hex')}`;
const root = resolve('.');

async function fixture(run, { collision = false, aliasDrift = false, missing = false, kind = 'ui' } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ghcr-publisher-'));
  const cwd = process.cwd(), previousPath = process.env.PATH;
  const ref = `ghcr.io/rhanka/sentropic-${kind}:abcdef`;
  const receipt = { kind, ref, imageId, configDigest, sourceSha: 'source', runId: '123', producer: { job: 'build-ui', attempt: '1' } };
  try {
    writeFileSync(join(dir, `${kind}-image.json`), JSON.stringify(receipt));
    writeFileSync(join(dir, 'docker'), [
      `#!${process.execPath}`,
      'const fs = require("node:fs"); const a = process.argv.slice(2);',
      'fs.appendFileSync("calls.jsonl", JSON.stringify(a) + "\\n");',
      `if (a[0] === 'image') console.log(${JSON.stringify(imageId)});`,
      `else if (a[0] === 'manifest') { if (${missing} && !fs.existsSync('pushed')) { console.error('manifest unknown'); process.exit(1); } console.log(${JSON.stringify(collision ? JSON.stringify({ config: { digest: `sha256:${'b'.repeat(64)}` } }) : manifest)}); }`,
      `else if (a[0] === 'push') fs.writeFileSync('pushed', '1');`,
      `else if (a[0] === 'buildx') console.log('Digest: ${digest(manifest)}');`,
    ].join('\n'), { mode: 0o755 });
    process.chdir(dir); process.env.PATH = `${dir}:${previousPath}`;
    const env = { REGISTRY: 'ghcr.io/rhanka', [`${kind.toUpperCase()}_VERSION`]: 'abcdef', GITHUB_SHA: 'source', GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '1' };
    const publicFetch = async url => {
      if (url.includes('/token?')) return Response.json({ token: 'anonymous-fixture' });
      const bytes = aliasDrift && url.endsWith('/main') ? JSON.stringify({ config: { digest: configDigest }, annotations: { drift: '1' } }) : manifest;
      return new Response(bytes, { headers: { 'docker-content-digest': digest(bytes) } });
    };
    const calls = () => existsSync('calls.jsonl') ? readFileSync('calls.jsonl', 'utf8').trim().split('\n').map(line => JSON.parse(line)) : [];
    await run({ env, publicFetch, calls, receipt });
  } finally {
    process.chdir(cwd); process.env.PATH = previousPath; rmSync(dir, { recursive: true, force: true });
  }
}

test('should publish the loaded tested identity and record the exact public manifest digest', async () => fixture(async ({ env, publicFetch, calls }) => {
  const result = await publish('ui', env, publicFetch);
  assert.equal(result.digest, digest(manifest));
  assert.equal(result.imageId, imageId);
  assert.equal(result.configDigest, configDigest);
  assert.deepEqual(calls().filter(call => call[0] === 'tag'), [['tag', imageId, 'ghcr.io/rhanka/sentropic-ui:main']]);
  assert(!calls().some(call => call[0] === 'pull'));
  assert.deepEqual(calls().filter(call => call[0] === 'push'), [['push', 'ghcr.io/rhanka/sentropic-ui:main']]);
  assert.equal(JSON.parse(readFileSync('ui-image.published.json')).digest, digest(manifest));
}));

test('should refuse a remote tag collision before any tag promotion or push', async () => fixture(async ({ env, publicFetch, calls }) => {
  await assert.rejects(publish('ui', env, publicFetch), /differs from the tested image/);
  assert(!calls().some(call => ['tag', 'push'].includes(call[0])));
}, { collision: true }));

test('should refuse a main alias with the same config but different manifest bytes', async () => fixture(async ({ env, publicFetch }) => {
  await assert.rejects(publish('ui', env, publicFetch), /Main alias differs/);
}, { aliasDrift: true }));

test('should refuse a receipt from a different qualification run', async () => fixture(async ({ env, publicFetch }) => {
  await assert.rejects(publish('ui', { ...env, GITHUB_RUN_ID: '124' }, publicFetch), /Stale tested image/);
}));

for (const kind of ['api', 'ui', 'e2e']) {
  test(`should publish a missing ${kind} tag with a manifest image ID and the exact tested config`, async () => fixture(async ({ env, publicFetch, calls }) => {
    const result = await publish(kind, env, publicFetch);
    assert.equal(result.configDigest, configDigest);
    assert.deepEqual(calls().filter(call => call[0] === 'push'), [
      ['push', `ghcr.io/rhanka/sentropic-${kind}:abcdef`], ['push', `ghcr.io/rhanka/sentropic-${kind}:main`],
    ]);
  }, { kind, missing: true }));
  test(`should refuse an existing ${kind} tag with a different config before any write`, async () => fixture(async ({ env, publicFetch, calls }) => {
    await assert.rejects(publish(kind, env, publicFetch), /Immutable tag collision.*expected sha256:.*received sha256:/);
    assert(!calls().some(call => ['push', 'tag'].includes(call[0])));
  }, { kind, collision: true }));
}

test('should route CI API publication through the tested-config guard without a preliminary publisher', () => {
  const target = readFileSync(join(root, 'Makefile'), 'utf8').match(/^ci-publish-api-image:([^\n]*)\n((?:\t[^\n]*\n)+)/m);
  assert(target);
  assert.deepEqual(target[1].trim().split(/\s+/), ['docker-login', 'verify-api-image']);
  assert.match(target[2], /node scripts\/ci\/publish-image\.mjs api/);
  assert.doesNotMatch(target[2], /scripts\/publish-api-image\.sh|docker push/);
});

test('should refuse receipts without a tested config digest before any registry write', async () => fixture(async ({ env, receipt, publicFetch, calls }) => {
  delete receipt.configDigest;
  writeFileSync('ui-image.json', JSON.stringify(receipt));
  await assert.rejects(publish('ui', env, publicFetch), /Missing tested config digest/);
  assert(!calls().some(call => ['push', 'tag'].includes(call[0])));
}));
