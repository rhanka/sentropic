import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { publish } from './publish-image.mjs';

const imageId = `sha256:${'a'.repeat(64)}`;
const manifest = JSON.stringify({ config: { digest: imageId } });
const digest = text => `sha256:${createHash('sha256').update(text).digest('hex')}`;

async function fixture(run, { collision = false, aliasDrift = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ghcr-publisher-'));
  const cwd = process.cwd(), previousPath = process.env.PATH;
  const ref = 'ghcr.io/rhanka/sentropic-ui:abcdef';
  const receipt = { kind: 'ui', ref, imageId, sourceSha: 'source', runId: '123', producer: { job: 'build-ui', attempt: '1' } };
  try {
    writeFileSync(join(dir, 'ui-image.json'), JSON.stringify(receipt));
    writeFileSync(join(dir, 'docker'), [
      `#!${process.execPath}`,
      'const fs = require("node:fs"); const a = process.argv.slice(2);',
      'fs.appendFileSync("calls.jsonl", JSON.stringify(a) + "\\n");',
      `if (a[0] === 'image') console.log(${JSON.stringify(imageId)});`,
      `else if (a[0] === 'manifest') console.log(${JSON.stringify(collision ? JSON.stringify({ config: { digest: `sha256:${'b'.repeat(64)}` } }) : manifest)});`,
      `else if (a[0] === 'buildx') console.log('Digest: ${digest(manifest)}');`,
    ].join('\n'), { mode: 0o755 });
    process.chdir(dir); process.env.PATH = `${dir}:${previousPath}`;
    const env = { REGISTRY: 'ghcr.io/rhanka', UI_VERSION: 'abcdef', GITHUB_SHA: 'source', GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '1' };
    const publicFetch = async url => {
      if (url.includes('/token?')) return Response.json({ token: 'anonymous-fixture' });
      const bytes = aliasDrift && url.endsWith('/main') ? JSON.stringify({ config: { digest: imageId }, annotations: { drift: '1' } }) : manifest;
      return new Response(bytes, { headers: { 'docker-content-digest': digest(bytes) } });
    };
    const calls = () => readFileSync('calls.jsonl', 'utf8').trim().split('\n').map(line => JSON.parse(line));
    await run({ env, publicFetch, calls, receipt });
  } finally {
    process.chdir(cwd); process.env.PATH = previousPath; rmSync(dir, { recursive: true, force: true });
  }
}

test('should publish the loaded tested identity and record the exact public manifest digest', async () => fixture(async ({ env, publicFetch, calls }) => {
  const result = await publish('ui', env, publicFetch);
  assert.equal(result.digest, digest(manifest));
  assert.equal(result.imageId, imageId);
  assert.deepEqual(calls().filter(call => call[0] === 'tag'), [['tag', imageId, 'ghcr.io/rhanka/sentropic-ui:main']]);
  assert(!calls().some(call => call[0] === 'pull'));
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
