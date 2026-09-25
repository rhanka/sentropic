import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';

// Resolver and lock-integrity scripts of the train qualification, exercised on fabricated archives.
const HERE = dirname(fileURLToPath(import.meta.url));
const run = (script: string, ...args: string[]) => {
  const result = spawnSync(process.execPath, [join(HERE, script), ...args], { encoding: 'utf8' });
  return { status: result.status, out: result.stdout + result.stderr };
};

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

function receipts(overrides: Record<string, unknown> = {}, manifest = { name: '@sentropic/llm-mesh', version: '0.22.0' }) {
  dir = mkdtempSync(join(tmpdir(), 'cluster-siblings-'));
  const bytes = tgz(manifest);
  mkdirSync(join(dir, 'in/llm-mesh'), { recursive: true });
  writeFileSync(join(dir, 'in/llm-mesh/sentropic-llm-mesh-0.22.0.tgz'), bytes);
  writeFileSync(join(dir, 'in/receipts.json'), JSON.stringify([{
    name: '@sentropic/llm-mesh', version: '0.22.0', file: 'llm-mesh/sentropic-llm-mesh-0.22.0.tgz',
    sha256: createHash('sha256').update(bytes).digest('hex'), head_sha: 'abc', guard: 'pass', manifest_mode: 'block',
    evidence: 'release-candidate', ...overrides,
  }]));
  return { bytes, receiptsPath: join(dir, 'in/receipts.json'), out: join(dir, 'out') };
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

  it.each([
    ['a hash mismatch', { sha256: '0'.repeat(64) }, 'archive hash mismatch'],
    ['a failed guard', { guard: 'fail' }, 'not a passing BLOCK release-candidate'],
    ['an escaping path', { file: '../x.tgz' }, 'invalid archive path'],
    ['an identity mismatch', { version: '0.22.1' }, 'identity mismatch'],
  ])('should refuse %s', (_label, overrides, message) => {
    const { receiptsPath, out } = receipts(overrides);
    const result = run('siblings.mjs', 'verify', receiptsPath, out);
    expect(result.status).toBe(1);
    expect(result.out).toContain(message);
  });

  it('should assert the committed lock integrity against the sibling bytes', () => {
    const { bytes, receiptsPath, out } = receipts();
    run('siblings.mjs', 'verify', receiptsPath, out);
    const integrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
    const lock = (value: string) => {
      const file = join(dir, 'lock.json');
      writeFileSync(file, JSON.stringify({ packages: { 'node_modules/@sentropic/llm-mesh': {
        version: '0.22.0', resolved: 'https://registry.npmjs.org/@sentropic/llm-mesh/-/llm-mesh-0.22.0.tgz', integrity: value,
      } } }));
      return run('check-lock-integrity.mjs', 'siblings', file, out);
    };
    expect(lock(integrity).status).toBe(0);
    const stale = lock('sha512-stale');
    expect(stale.status).toBe(1);
    expect(stale.out).toContain('::error title=Train lock integrity::@sentropic/llm-mesh@0.22.0: lock integrity sha512-stale');
  });
});
