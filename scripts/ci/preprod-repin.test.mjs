import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadPublications, repin, resolvePins } from './preprod-repin.mjs';

const d = c => `sha256:${c.repeat(64)}`;
const env = { GITHUB_SHA: 'f'.repeat(40), GITHUB_RUN_ID: '42', API_VERSION: 'abc123', UI_VERSION: 'def456' };
const receipt = (kind, digest, over = {}) => ({ kind, sourceSha: env.GITHUB_SHA, runId: env.GITHUB_RUN_ID,
  ref: `ghcr.io/rhanka/sentropic-${kind}:${env[`${kind.toUpperCase()}_VERSION`]}`, digest,
  image: `ghcr.io/rhanka/sentropic-${kind}@${digest}`, ...over });
const registry = tags => async ref => {
  if (!(ref in tags)) throw Error('Anonymous GHCR pull refused');
  return { ref, digest: tags[ref] };
};
const tags = { 'ghcr.io/rhanka/sentropic-api:abc123': d('a'), 'ghcr.io/rhanka/sentropic-ui:def456': d('b') };
const overlay = `namespace: sentropic-preprod\n# kept comment\nimages:\n  - name: ghcr.io/rhanka/sentropic-api\n    digest: ${d('1')}\n  - name: ghcr.io/rhanka/sentropic-ui\n    digest: ${d('2')}\n`;

test('should pin both kinds to the digests this main run published', async () => {
  const pins = await resolvePins(env, { api: receipt('api', d('a')), ui: receipt('ui', d('b')) }, registry(tags));
  assert.deepEqual(pins, { api: d('a'), ui: d('b') });
});

test('should pin an unpublished kind to the digest of this commit content tag, never keep the committed pin', async () => {
  const pins = await resolvePins(env, { api: receipt('api', d('a')) }, registry(tags));
  assert.deepEqual(pins, { api: d('a'), ui: d('b') });
});

test('should refuse a publication from another run, commit, kind or tag', async () => {
  for (const over of [{ sourceSha: 'e'.repeat(40) }, { runId: '41' }, { kind: 'ui' },
    { ref: 'ghcr.io/rhanka/sentropic-api:000000' }, { image: `ghcr.io/rhanka/sentropic-api@${d('c')}` }, { digest: 'sha256:short' }]) {
    await assert.rejects(resolvePins(env, { api: receipt('api', d('a'), over) }, registry(tags)), /publication/);
  }
});

test('should refuse a publication whose content tag resolves to another digest', async () => {
  await assert.rejects(resolvePins(env, { api: receipt('api', d('c')) }, registry(tags)), /content tag/);
});

test('should fail closed when the content tag of an unpublished kind is absent or the tag is invalid', async () => {
  await assert.rejects(resolvePins(env, {}, registry({ 'ghcr.io/rhanka/sentropic-api:abc123': d('a') })), /refused/);
  await assert.rejects(resolvePins({ ...env, UI_VERSION: 'main' }, {}, registry(tags)), /content tag/);
});

test('should rewrite only the trailing images block', () => {
  const result = repin(overlay, { api: d('a'), ui: d('b') });
  assert.equal(result.hold, undefined);
  assert.equal(result.text, overlay.replace(d('1'), d('a')).replace(d('2'), d('b')));
});

test('should keep an explicit committed image hold unchanged', () => {
  const held = overlay.replace('# kept comment\n', '# preprod-image-hold: recovery while main api crashloops\n');
  assert.deepEqual(repin(held, { api: d('a'), ui: d('b') }), { text: held, hold: 'recovery while main api crashloops' });
});

test('should refuse an unexpected images layout', () => {
  for (const text of [overlay.replace(`digest: ${d('1')}`, 'newTag: "abc123"'), `${overlay}extra: true\n`,
    overlay.split('  - name: ghcr.io/rhanka/sentropic-ui')[0], overlay.replace('images:\n', 'images: []\n')]) {
    assert.throws(() => repin(text, { api: d('a'), ui: d('b') }), /layout/);
  }
});

test('should accept the committed preprod overlay layout', () => {
  const text = readFileSync('deploy/k8s/overlays/preprod/kustomization.yaml', 'utf8');
  assert.match(repin(text, { api: d('a'), ui: d('b') }).text ?? '', /sentropic-ui\n    digest: sha256:b{64}\n$/);
});

test('should require the receipt of every kind the run published and ignore the others', () => {
  const dir = mkdtempSync(join(tmpdir(), 'repin-'));
  try {
    writeFileSync(join(dir, 'api-image.published.json'), JSON.stringify(receipt('api', d('a'))));
    assert.deepEqual(Object.keys(loadPublications(dir, 'api')), ['api']);
    assert.deepEqual(loadPublications(dir, ''), {});
    assert.throws(() => loadPublications(dir, 'api,ui'), /ui publication/);
    assert.throws(() => loadPublications(dir, 'e2e'), /kind/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('should repin in the deploy job before the pull check and the apply, and drop the tag append', () => {
  const ci = readFileSync('.github/workflows/ci.yml', 'utf8');
  const job = ci.slice(ci.indexOf('\n  deploy-preprod:'), ci.indexOf('\n  ci-gate:'));
  const order = ['make preprod-repin', 'make check-preprod-images', 'make k8s-deploy-preprod'].map(step => job.indexOf(step));
  assert.ok(order.every(at => at > 0) && order[0] < order[1] && order[1] < order[2], 'deploy-preprod step order');
  for (const name of ['ghcr-api-e2e-publication', 'ghcr-ui-publication']) assert.ok(job.includes(`name: ${name}`), name);
  const make = readFileSync('Makefile', 'utf8');
  const recipe = make.slice(make.indexOf('\nk8s-deploy-preprod:'), make.indexOf('\nk8s-db-restore-preprod:'));
  assert.doesNotMatch(recipe, /newTag|overlays\/preprod\/kustomization\.yaml/);
});
