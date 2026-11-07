import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { publish } from './publish-image.mjs';
import { resolveUiImage } from './resolve-ui-image.mjs';

const digest = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const canonicalConfig = '{"created":"canonical"}', rebuiltConfig = '{"created":"rebuilt"}';
const canonicalId = digest(canonicalConfig), rebuiltId = digest(rebuiltConfig);
const manifest = imageId => ({ config: { digest: imageId } });
const manifestId = digest(JSON.stringify(manifest(canonicalId)));

async function fixture(run, initial = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'canonical-ui-'));
  const cwd = process.cwd(), previousPath = process.env.PATH;
  try {
    writeFileSync(join(dir, 'state.json'), JSON.stringify({ remote: manifest(canonicalId), localId: rebuiltId, localConfig: rebuiltConfig, ...initial }));
    const script = [
      `#!${process.execPath}`,
      'const fs = require("node:fs"), crypto = require("node:crypto"), cp = require("node:child_process");',
      'const a = process.argv.slice(2), s = JSON.parse(fs.readFileSync("state.json"));',
      'const tool = process.argv[1].endsWith("/make") ? "make" : "docker";',
      'fs.appendFileSync("calls.jsonl", JSON.stringify([tool, ...a]) + "\\n");',
      'if (tool === "make") { s.localId = "' + rebuiltId + '"; s.localConfig = ' + JSON.stringify(rebuiltConfig) + '; }',
      'else if (a[0] === "manifest") {',
      '  if (s.lookupError || !s.remote) { console.error(s.lookupError || "manifest unknown"); process.exit(1); }',
      '  console.log(JSON.stringify(s.remote));',
      '} else if (a[0] === "pull") {',
      '  if (s.pullError) process.exit(1); if (!s.drift) { s.localId = s.containerd ? "' + manifestId + '" : s.remote.config.digest; s.localConfig = ' + JSON.stringify(canonicalConfig) + '; }',
      '} else if (a[0] === "image" && a[1] === "save") {',
      '  if (s.saveError) process.exit(1);',
      '  const hash = crypto.createHash("sha256").update(s.localConfig).digest("hex");',
      '  const file = s.classic ? hash + ".json" : "blobs/sha256/" + hash;',
      '  fs.mkdirSync("blobs/sha256", {recursive: true}); fs.writeFileSync(file, s.localConfig);',
      '  fs.writeFileSync("manifest.json", JSON.stringify(s.exportedManifest || [{Config: file}]));',
      '  process.stdout.write(cp.execFileSync("tar", ["-cf", "-", "manifest.json", file]));',
      '} else if (a[0] === "image") console.log(s.localId);',
      'else if (a[0] === "push") s.remote = {config: {digest: "sha256:" + crypto.createHash("sha256").update(s.localConfig).digest("hex")}};',
      'else if (a[0] === "buildx") console.log("Digest: sha256:" + crypto.createHash("sha256").update(JSON.stringify(s.remote)).digest("hex"));',
      'fs.writeFileSync("state.json", JSON.stringify(s));',
    ].join('\n');
    for (const tool of ['docker', 'make']) writeFileSync(join(dir, tool), script, { mode: 0o755 });
    process.chdir(dir); process.env.PATH = `${dir}:${previousPath}`;
    const env = { ...process.env, REGISTRY: 'ghcr.io/rhanka', UI_VERSION: 'abcdef', IMAGE_PLATFORM: 'linux/amd64',
      GITHUB_SHA: 'source', GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '1' };
    const state = () => JSON.parse(readFileSync('state.json'));
    const calls = () => readFileSync('calls.jsonl', 'utf8').trim().split('\n').map(JSON.parse);
    const qualify = () => writeFileSync('ui-image.json', JSON.stringify({ kind: 'ui',
      ref: 'ghcr.io/rhanka/sentropic-ui:abcdef', imageId: state().localId, configDigest: digest(state().localConfig),
      sourceSha: 'source', runId: '123', producer: { attempt: '1' } }));
    const publicFetch = async url => {
      if (url.includes('/token?')) return Response.json({ token: 'fixture' });
      const bytes = JSON.stringify(state().remote);
      return new Response(bytes, { headers: { 'docker-content-digest': digest(bytes) } });
    };
    await run({ env, state, calls, qualify, publicFetch });
  } finally { process.chdir(cwd); process.env.PATH = previousPath; rmSync(dir, { recursive: true, force: true }); }
}

test('should reproduce the migrated tag collision before any push when an existing UI version is rebuilt', async () => fixture(async ({ env, qualify, calls, publicFetch }) => {
  qualify();
  await assert.rejects(publish('ui', env, publicFetch), /Registry config digest differs/);
  assert(!calls().some(call => ['push', 'tag'].includes(call[1])));
}));

test('should qualify and publish the existing canonical UI config without rebuilding or overwriting its tag', async () => fixture(async ({ env, qualify, calls, publicFetch }) => {
  resolveUiImage('test-ghcr-ui-fix', env); qualify();
  const result = await publish('ui', env, publicFetch);
  assert.equal(result.imageId, canonicalId);
  assert.equal(result.digest, digest(JSON.stringify(manifest(canonicalId))));
  assert(!calls().some(call => call[0] === 'make'));
  assert.deepEqual(calls().filter(call => call[1] === 'pull'), [['docker', 'pull', '--platform', 'linux/amd64', 'ghcr.io/rhanka/sentropic-ui:abcdef']]);
  assert.deepEqual(calls().filter(call => call[1] === 'push'), [['docker', 'push', 'ghcr.io/rhanka/sentropic-ui:main']]);
}));

test('should build a missing UI tag once and publish exactly its qualified config', async () => fixture(async ({ env, qualify, calls, publicFetch }) => {
  resolveUiImage('test-ghcr-ui-fix', env); qualify();
  assert.equal((await publish('ui', env, publicFetch)).imageId, rebuiltId);
  assert.deepEqual(calls().filter(call => call[0] === 'make'), [['make', 'ci-build-ui-target', 'IMAGE_KIND=ui', 'ENV=test-ghcr-ui-fix']]);
  assert.equal(calls().filter(call => call[1] === 'push').length, 2);
}, { remote: null }));

for (const initial of [{ containerd: true }, { classic: true }]) {
  test(`should verify the actual config through qualification and publication (${JSON.stringify(initial)})`, async () => fixture(async ({ env, qualify, publicFetch }) => {
    resolveUiImage('test-ghcr-ui-fix', env); qualify();
    const result = await publish('ui', env, publicFetch);
    assert.equal(result.imageId, initial.containerd ? manifestId : canonicalId);
    assert.equal(result.digest, manifestId);
  }, initial));
}

for (const lookupError of ['unauthorized', 'denied', 'connection refused', '']) {
  test(`should refuse to build on an unproven registry absence (${lookupError || 'empty stderr'})`, async () => fixture(({ env, calls }) => {
    assert.throws(() => resolveUiImage('test-ghcr-ui-fix', env), /refusing to build/);
    assert.equal(calls().length, 1);
  }, { remote: null, lookupError: lookupError || ' ' }));
}

for (const initial of [{ remote: { manifests: [] } }, { pullError: true }, { drift: true },
  { saveError: true }, { exportedManifest: [] },
  { exportedManifest: [{ Config: `blobs/sha256/${'f'.repeat(64)}` }] },
  { exportedManifest: [{ Config: '../config.json' }] }]) {
  test(`should refuse index, failed pull or config drift without rebuilding (${JSON.stringify(initial)})`, async () => fixture(({ env, calls }) => {
    assert.throws(() => resolveUiImage('test-ghcr-ui-fix', env));
    assert(!calls().some(call => call[0] === 'make' || call[1] === 'push'));
  }, initial));
}
