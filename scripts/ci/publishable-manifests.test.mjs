// D1 dependency rule and archive reader fixtures (make test-publishable-manifests).
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import zlib from 'node:zlib';
import { checkManifest, classifyDependencyValue, readPackedManifest, FORBIDDEN_SPEC } from './publishable-manifests.mjs';

const REJECTED = [
  'file:../oauth-verify', 'FILE:../x', 'link:../x', 'portal:../x', 'workspace:*', 'workspace:^0.1.0',
  'github:owner/repo', 'gitlab:o/r', 'bitbucket:o/r', 'git+https://github.com/o/r.git', 'git+ssh://git@x/r',
  'git://github.com/o/r', 'ssh://git@host/r', 'https://example.com/pkg', 'http://example.com/pkg.tgz',
  'HTTPS://EXAMPLE.COM/pkg', 'ftp://x/y.tgz', 'npm:other@^1.0.0', './local', '../sibling', '.', '..',
  '/abs/path', '\\\\server\\share', 'C:\\pkg', 'c:/pkg', '~/pkg', '~', 'latest', 'next', 'owner/repo',
  'pkg.tgz', 'unknown:thing', 'not a range!', '', '   ', '\t\n',
];
const ACCEPTED = ['1.2.3', '^0.1.0', '~1.2.0', '>=1.0.0 <2.0.0', '1.0.0 - 2.0.0', '^1.0.0 || ^2.0.0', '*', '1.x', '1.2.3-beta.1', ' ^1.0.0 ', 'x'];

test('rejects every forbidden scheme, path form, tag and empty-after-trim value', () => {
  for (const value of REJECTED) assert.equal(classifyDependencyValue(value).ok, false, `expected rejection: ${JSON.stringify(value)}`);
});

test('whitespace-only strings fail even though validRange("") is "*"', () => {
  assert.equal(classifyDependencyValue('  ').reason, 'empty range after trim');
});

test('accepts plain semver ranges, including surrounding whitespace', () => {
  for (const value of ACCEPTED) assert.equal(classifyDependencyValue(value).ok, true, `expected acceptance: ${JSON.stringify(value)}`);
});

test('rejects non-string values', () => {
  for (const value of [1, null, true, {}, []]) assert.equal(classifyDependencyValue(value).ok, false);
});

test('forbidden regex is the exact spec classifier', () => {
  assert.equal(FORBIDDEN_SPEC.flags, 'i');
  assert.ok(FORBIDDEN_SPEC.test('WORKSPACE:*'));
  assert.ok(!FORBIDDEN_SPEC.test('^1.0.0'));
});

test('checks all three maps independently, including duplicated names and optional peers', () => {
  const { violations, structural, isPublic } = checkManifest({
    name: '@x/a', version: '1.0.0',
    dependencies: { dup: 'file:../dup', ok: '^1.0.0' },
    peerDependencies: { dup: 'workspace:*', hono: '^4.10.7' },
    peerDependenciesMeta: { hono: { optional: true } },
    optionalDependencies: { opt: 'link:../opt' },
    devDependencies: { dev: 'file:../dev' },
    repository: { type: 'git', url: 'git+https://github.com/o/r.git' },
    main: './dist/index.js',
  });
  assert.equal(isPublic, true);
  assert.deepEqual(structural, []);
  assert.deepEqual(violations.map((v) => `${v.section}:${v.name}`), ['dependencies:dup', 'peerDependencies:dup', 'optionalDependencies:opt']);
});

test('private exclusion uses boolean true only; truthy strings are structural errors', () => {
  assert.equal(checkManifest({ name: 'a', version: '1.0.0', private: true }).isPublic, false);
  assert.equal(checkManifest({ name: 'a', version: '1.0.0' }).isPublic, true);
  assert.match(checkManifest({ name: 'a', version: '1.0.0', private: 'true' }).structural[0], /boolean/);
});

test('malformed dependency maps and missing identity are structural errors', () => {
  assert.ok(checkManifest({ name: 'a', version: '1.0.0', dependencies: ['x'] }).structural.some((s) => /malformed/.test(s)));
  assert.ok(checkManifest({ dependencies: {} }).structural.some((s) => /name/.test(s)));
  assert.deepEqual(checkManifest({ name: 'a', version: '1.0.0' }).violations, []);
});

test('publish-only lifecycle hooks are rejected', () => {
  const { violations } = checkManifest({ name: 'a', version: '1.0.0', scripts: { prepublishOnly: 'x', prepack: 'ok' } });
  assert.deepEqual(violations.map((v) => v.name), ['prepublishOnly']);
});

// ---- archive reader fixtures (hand-built tarballs; nothing extracted)
function header(name, size, type = '0') {
  const h = Buffer.alloc(512);
  h.write(name, 0, 100);
  h.write('0000644\0', 100);
  h.write('0000000\0', 108);
  h.write('0000000\0', 116);
  h.write(`${size.toString(8).padStart(11, '0')}\0`, 124);
  h.write('00000000000\0', 136);
  h.write(type, 156);
  h.write('ustar\0', 257);
  h.write('00', 263);
  h.fill(32, 148, 156);
  let sum = 0;
  for (const b of h) sum += b;
  h.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148);
  return h;
}
export function tarball(members) {
  const blocks = [];
  for (const { name, body = '', type = '0' } of members) {
    const data = Buffer.from(body);
    blocks.push(header(name, data.length, type), data, Buffer.alloc((512 - (data.length % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return zlib.gzipSync(Buffer.concat(blocks));
}
const manifest = JSON.stringify({ name: '@x/a', version: '1.0.0' });

test('reads the single regular package/package.json member', () => {
  const tgz = tarball([{ name: 'package/README.md', body: 'x' }, { name: 'package/package.json', body: manifest }]);
  assert.deepEqual(readPackedManifest(tgz), { name: '@x/a', version: '1.0.0' });
  assert.equal(createHash('sha256').update(tgz).digest('hex').length, 64);
});

test('rejects duplicate, missing, symlinked, traversal and invalid manifest members', () => {
  const cases = [
    [[{ name: 'package/package.json', body: manifest }, { name: 'package/package.json', body: manifest }], /exactly one/],
    [[{ name: 'package/index.js', body: '' }], /found 0/],
    [[{ name: 'package/package.json', type: '2' }], /link member/],
    [[{ name: 'package/../../etc/passwd', body: 'x' }, { name: 'package/package.json', body: manifest }], /unsafe/],
    [[{ name: 'package/package.json', body: '{not json' }], /not valid JSON/],
  ];
  for (const [members, pattern] of cases) assert.throws(() => readPackedManifest(tarball(members)), pattern);
});

test('rejects malformed archives and corrupted headers', () => {
  assert.throws(() => readPackedManifest(Buffer.from('not gzip')), /malformed archive/);
  const raw = zlib.gunzipSync(tarball([{ name: 'package/package.json', body: manifest }]));
  raw[10] ^= 0xff;
  assert.throws(() => readPackedManifest(zlib.gzipSync(raw)), /checksum/);
});
