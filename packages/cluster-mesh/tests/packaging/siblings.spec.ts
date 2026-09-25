import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';

// Resolver and lock-integrity scripts of the train qualification, exercised on fabricated archives. The
// resolver validates receipts with scripts/ci loadSiblings, which needs the pinned semver of the tool dir.
const HERE = dirname(fileURLToPath(import.meta.url));
const TOOL_DIR = dirname((process.env.NODE_PATH ?? '').split(':')[0] ?? '');
const run = (script: string, ...args: string[]) => runWith({}, script, ...args);
function runWith(env: Record<string, string | undefined>, script: string, ...args: string[]) {
  const result = spawnSync(process.execPath, [join(HERE, script), ...args], {
    encoding: 'utf8', env: { ...process.env, CLUSTER_MESH_HEAD_SHA: 'abc', MANIFEST_GUARD_TOOL_DIR: TOOL_DIR, ...env },
  });
  return { status: result.status, out: result.stdout + result.stderr };
}

function tgz(manifest: Record<string, unknown>): Buffer {
  const body = Buffer.from(JSON.stringify(manifest));
  const header = Buffer.alloc(512);
  header.write('package/package.json', 0);
  header.write('0000644\0', 100);
  header.write(`${body.length.toString(8).padStart(11, '0')}\0`, 124);
  header.write('        ', 148);
  header.write('0', 156);
  header.write('ustar\0', 257);
  const sum = header.reduce((total, byte) => total + byte, 0);
  header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148);
  const padded = Buffer.concat([body, Buffer.alloc((512 - (body.length % 512)) % 512)]);
  return gzipSync(Buffer.concat([header, padded, Buffer.alloc(1024)]));
}

let dir: string;
afterEach(() => rmSync(dir, { recursive: true, force: true }));

type Manifest = { name: string; version: string } & Record<string, unknown>;
const MESH: Manifest = { name: '@sentropic/llm-mesh', version: '0.22.0' };

/** Write `in/<file>` for each manifest and `in/receipts.json` (or raw text) listing them. */
function receipts(overrides: Record<string, unknown> = {}, manifests: [Manifest, string][] = [[MESH, 'llm-mesh/sentropic-llm-mesh-0.22.0.tgz']],
  raw?: string) {
  dir = mkdtempSync(join(tmpdir(), 'cluster-siblings-'));
  const list = manifests.map(([manifest, file], index) => {
    const bytes = tgz(manifest);
    mkdirSync(dirname(join(dir, 'in', file)), { recursive: true });
    writeFileSync(join(dir, 'in', file), bytes);
    return {
      name: manifest.name, version: manifest.version, file, sha256: createHash('sha256').update(bytes).digest('hex'), head_sha: 'abc',
      guard: 'pass', manifest_mode: 'block', evidence: 'release-candidate', ...(index === 0 ? overrides : {}),
    };
  });
  writeFileSync(join(dir, 'in/receipts.json'), raw ?? JSON.stringify(list));
  return { bytes: tgz(manifests[0]![0]), receiptsPath: join(dir, 'in/receipts.json'), out: join(dir, 'out') };
}

describe('train sibling resolver', () => {
  it('should resolve exactly the verified name@version to its archive and everything else to the registry', () => {
    const { bytes, receiptsPath, out } = receipts();
    expect(run('siblings.mjs', 'verify', receiptsPath, out).status).toBe(0);
    const archive = resolve(out, 'sentropic-llm-mesh-0.22.0.tgz');
    expect(readFileSync(archive)).toEqual(bytes);
    expect(run('siblings.mjs', 'spec', out, '@sentropic/llm-mesh', '0.22.0').out.trim()).toBe(`file:${archive}`);
    expect(run('siblings.mjs', 'spec', out, '@sentropic/llm-mesh', '0.21.2').out.trim()).toBe('0.21.2');
    expect(run('siblings.mjs', 'spec', out, '@sentropic/llm-gateway', '0.19.0').out.trim()).toBe('0.19.0');
  });

  it('should hand back a cluster-mesh receipt as the candidate and refuse another version', () => {
    const { receiptsPath, out } = receipts({}, [
      [MESH, 'llm-mesh/sentropic-llm-mesh-0.22.0.tgz'],
      [{ name: '@sentropic/cluster-mesh', version: '0.13.0' }, 'cluster-mesh/sentropic-cluster-mesh-0.13.0.tgz'],
    ]);
    expect(run('siblings.mjs', 'verify', receiptsPath, out).status).toBe(0);
    expect(run('siblings.mjs', 'candidate', out, '@sentropic/cluster-mesh', '0.13.0').out.trim())
      .toBe(resolve(out, 'sentropic-cluster-mesh-0.13.0.tgz'));
    expect(run('siblings.mjs', 'candidate', out, '@sentropic/llm-gateway', '0.19.0').out.trim()).toBe('');
    const other = run('siblings.mjs', 'candidate', out, '@sentropic/cluster-mesh', '0.13.1');
    expect(other.status).toBe(1);
    expect(other.out).toContain('receipt carries @sentropic/cluster-mesh@0.13.0, the candidate is 0.13.1');
  });

  it.each([
    ['a hash mismatch', { sha256: '0'.repeat(64) }, 'sibling archive hash mismatch'],
    ['a failed guard', { guard: 'fail' }, 'not a passing BLOCK release-candidate'],
    ['an escaping path', { file: '../x.tgz' }, 'invalid sibling archive path ../x.tgz'],
    ['an absolute path', { file: '/etc/passwd' }, 'invalid sibling archive path /etc/passwd'],
    ['an identity mismatch', { version: '0.22.1' }, 'sibling identity mismatch'],
    ['another head commit', { head_sha: 'def' }, 'was packed from def, not head abc'],
  ])('should refuse %s', (_label, overrides, message) => {
    const { receiptsPath, out } = receipts(overrides);
    const result = run('siblings.mjs', 'verify', receiptsPath, out);
    expect(result.status).toBe(1);
    expect(result.out).toContain(message);
  });

  it.each([
    ['a non-array receipts file', '{"name":"@sentropic/llm-mesh"}', 'sibling receipts must be a JSON array'],
    ['an unreadable receipts file', '[{', 'unreadable sibling receipts'],
  ])('should refuse %s', (_label, raw, message) => {
    const { receiptsPath, out } = receipts({}, undefined, raw);
    const result = run('siblings.mjs', 'verify', receiptsPath, out);
    expect(result.status).toBe(1);
    expect(result.out).toContain(message);
  });

  it('should refuse a packed manifest failing the guard, an unlisted archive, colliding basenames and no head sha', () => {
    const guard = receipts({}, [[{ ...MESH, dependencies: { x: 'file:../x' } }, 'llm-mesh/sentropic-llm-mesh-0.22.0.tgz']]);
    expect(run('siblings.mjs', 'verify', guard.receiptsPath, guard.out).out).toContain('fails the packed-manifest guard');
    rmSync(dir, { recursive: true, force: true });
    const unlisted = receipts();
    writeFileSync(join(dir, 'in/llm-mesh/extra.tgz'), 'x');
    expect(run('siblings.mjs', 'verify', unlisted.receiptsPath, unlisted.out).out).toContain('unlisted archive in sibling directory: llm-mesh/extra.tgz');
    rmSync(dir, { recursive: true, force: true });
    const collide = receipts({}, [[MESH, 'a/sentropic-llm-mesh-0.22.0.tgz'],
      [{ name: '@sentropic/llm-gateway', version: '0.19.0' }, 'b/sentropic-llm-mesh-0.22.0.tgz']]);
    expect(run('siblings.mjs', 'verify', collide.receiptsPath, collide.out).out).toContain('archive basename sentropic-llm-mesh-0.22.0.tgz collides');
    const noHead = runWith({ CLUSTER_MESH_HEAD_SHA: '' }, 'siblings.mjs', 'verify', collide.receiptsPath, collide.out);
    expect(noHead).toMatchObject({ status: 1 });
    expect(noHead.out).toContain('CLUSTER_MESH_HEAD_SHA is required');
  });
});
