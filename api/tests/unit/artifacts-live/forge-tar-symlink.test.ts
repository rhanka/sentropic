import { gunzipSync, gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { key } from './fixture';
import { failure, HEAD, REPO, setup, STAGED, tarball, TOP } from './forge-fixture';

/** P1 2026-11-09: rhanka/radar-immobilier@93116b8 ships two symlinks (entry 1563:
 * `deploy/k8s/40-immo-mcp-http-deploy.yaml -> immo-mcp/40-immo-mcp-http-deploy.yaml`).
 * GitHub archives are legitimate input: links are checksum/size/top-validated like every entry,
 * then skipped (never staged, link targets never resolved) instead of failing the whole tree. */
describe('forge tarball: link entries from GitHub archives', () => {
  it('should skip the preprod symlinks instead of failing the tree', async () => {
    const s = await setup();
    s.state.archive = tarball([...REPO,
      { path: 'deploy/k8s/40-immo-mcp-http-deploy.yaml', type: '2', link: 'immo-mcp/40-immo-mcp-http-deploy.yaml' },
      { path: 'deploy/k8s/41-immo-mcp-ingress.yaml', type: '2', link: 'immo-mcp/41-immo-mcp-ingress.yaml' }]);
    const snap = await s.reads.snapshot(key, HEAD);
    const files = await s.reads.source(snap.stagingRef);
    expect(files.map(f => f.path).sort()).toEqual(STAGED);
  });
  it('should skip hard links, even with an escaping target, without resolving it', async () => {
    const s = await setup();
    s.state.archive = tarball([...REPO,
      { path: 'src/link', type: '2', link: '../../etc/passwd' },
      { path: 'src/hard', type: '1', link: `${TOP}/package.json` }]);
    const snap = await s.reads.snapshot(key, HEAD);
    const files = await s.reads.source(snap.stagingRef);
    expect(files.map(f => f.path).sort()).toEqual(STAGED);
  });
  it('should still refuse special entries, with a named reason', async () => {
    const s = await setup();
    s.state.archive = tarball([...REPO, { path: 'src/fifo', type: '6' }]);
    expect(await failure(s.reads.snapshot(key, HEAD))).toMatchObject({ code: 'unstable_tree', reason: 'special_entry' });
  });
});

describe('forge tarball: every unstable_tree carries a named reason', () => {
  it('should name checksum, truncation and unsafe-path refusals', async () => {
    const valid = tarball(REPO);
    const tar = gunzipSync(valid);
    const bad = Buffer.from(tar);
    bad[1536] ^= 0x01;
    const cases = [
      { archive: gzipSync(bad), reason: 'bad_checksum' },
      { archive: gzipSync(tar.subarray(0, tar.length - 1536)), reason: 'truncated' },
      { archive: tarball([...REPO, { path: '../evil.sh', data: 'x' }]), reason: 'unsafe_path' },
      { archive: oversizedMeta(valid), reason: 'meta_too_large' },
      { archive: badSizeAttribute(valid), reason: 'bad_size' },
    ] as const;
    for (const { archive, reason } of cases) {
      const s = await setup(); s.state.archive = archive;
      expect(await failure(s.reads.snapshot(key, HEAD))).toMatchObject({ code: 'unstable_tree', reason });
    }
  });
});

/** Patch the leading pax-global header size past META_BYTES (1 MiB), with a valid checksum. */
function oversizedMeta(archive: Buffer): Buffer {
  const tar = Buffer.from(gunzipSync(archive));
  const header = tar.subarray(0, 512);
  header.write(`${(2 * 1024 * 1024).toString(8).padStart(11, '0')}\0`, 124, 'latin1');
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 32 : header[i]!;
  header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 'latin1');
  return gzipSync(tar);
}

/** Rewrite the long-name pax payload to a bare `size=abc` attribute (same block size, valid checksum). */
function badSizeAttribute(archive: Buffer): Buffer {
  const tar = Buffer.from(gunzipSync(archive));
  for (let off = 0; off + 512 <= tar.length; off += 512) {
    const header = tar.subarray(off, off + 512);
    if (header.subarray(0, 100).toString('latin1').startsWith('pax\0')
      && header[156] === 0x78 /* x */ && header.subarray(257, 262).toString('latin1') === 'ustar') {
      const data = tar.subarray(off + 512, off + 1024);
      data.fill(0);
      data.write('12 size=abc\n', 'latin1');
      header.write(`${(12).toString(8).padStart(11, '0')}\0`, 124, 'latin1');
      let sum = 0;
      for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 32 : header[i]!;
      header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 'latin1');
      return gzipSync(tar);
    }
  }
  throw new Error('no pax extended header found');
}
