import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';

export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
export const integrity = (bytes) => `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
export const canonical = (value) => JSON.stringify(value, (_, v) => v && typeof v === 'object' && !Array.isArray(v)
  ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : v, 2) + '\n';
export const json = (bytes) => JSON.parse(bytes.toString());

export function bindings(root) {
  root = realpathSync(root);
  const files = {};
  function path(name) {
    assert.equal(typeof name, 'string');
    assert(!name.split('/').includes('..') && !name.startsWith('/'), `unsafe path: ${name}`);
    const full = realpathSync(resolve(root, name));
    assert(full.startsWith(root + sep), `outside evidence root: ${name}`);
    assert(statSync(full).isFile(), `not a file: ${name}`);
    return full;
  }
  function read(name, expected) {
    const bytes = readFileSync(path(name));
    const entry = { sha256: sha256(bytes), size: bytes.length };
    if (expected) assert.equal(entry.sha256, expected, `sha256 mismatch: ${name}`);
    files[name] = entry;
    return bytes;
  }
  function tree(name) {
    const walk = (dir) => readdirSync(resolve(root, dir), { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : 1)
      .flatMap((e) => e.isDirectory() ? walk(`${dir}/${e.name}`) : [`${dir}/${e.name}`]);
    return Object.fromEntries(walk(name).map((file) => {
      read(file);
      return [relative(resolve(root, name), resolve(root, file)), files[file].sha256];
    }));
  }
  function archive(name, expected) {
    const bytes = read(name, expected.sha256);
    const sri = integrity(bytes);
    assert.equal(sri, expected.integrity, `integrity mismatch: ${name}`);
    const members = execFileSync('tar', ['-tzf', path(name)], { maxBuffer: 16 * 1024 * 1024 }).toString().trim().split('\n');
    assert.equal(new Set(members).size, members.length, 'duplicate archive entries');
    assert(members.every((m) => m.startsWith('package/') && !m.split('/').includes('..')), 'unsafe archive entry');
    const memberHashes = {};
    function member(memberName) {
      assert(members.includes(`package/${memberName}`), `missing archive member: ${memberName}`);
      const value = execFileSync('tar', ['-xOzf', path(name), `package/${memberName}`], { maxBuffer: 32 * 1024 * 1024 });
      memberHashes[memberName] = sha256(value);
      return value;
    }
    const pkg = json(member('package.json'));
    assert.equal(pkg.name, expected.name);
    assert.equal(pkg.version, expected.version);
    return { file: name, sha256: sha256(bytes), integrity: sri, name: pkg.name, version: pkg.version,
      fileListSha256: sha256(members.sort().join('\n') + '\n'), memberHashes, member, members };
  }
  return { files, read, tree, archive };
}

export function verifyTuple(actual, expected, requireFinal = false) {
  assert.equal(canonical(actual), canonical(expected), 'tuple differs from recomputed evidence');
  assert.equal(actual.format, 'e2-host-tuple/v1');
  if (requireFinal) assert.equal(actual.status, 'FINAL', 'PENDING preparation cannot pass final acceptance');
  return sha256(canonical(actual));
}
