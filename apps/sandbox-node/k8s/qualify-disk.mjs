import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, chmodSync, chownSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

assert.equal(process.env.QUALIFICATION_ONLY, 'isolated', 'isolated qualification host required');
assert.ok(process.env.QUAL_RELEASE_DIR, 'QUAL_RELEASE_DIR required');
const release = process.env.QUAL_RELEASE_DIR;
const { mountQuotaVolume } = await import(pathToFileURL(join(release, 'dist/disk-quota.js')));
const { destroyBundle } = await import(pathToFileURL(join(release, 'dist/bundle.js')));
const run = (command, args) => execFileSync(command, args, { stdio: 'pipe', timeout: 10000 });
for (const dimension of ['blocks', 'inodes']) {
  const path = mkdtempSync(join(tmpdir(), 'sandbox-quota-'));
  chmodSync(path, 0o755);
  const bundle = { path, workspace: '', output: '', mounted: [] };
  try {
    const volume = mountQuotaVolume(bundle, 1, 32, run);
    chownSync(volume, 65534, 65534);
    // Drop root capabilities: a real filesystem operation must return EDQUOT.
    const program = dimension === 'blocks'
      ? "require('fs').writeFileSync('large', Buffer.alloc(2 * 1048576))"
      : "for(let i=0;i<64;i++) require('fs').writeFileSync('file-'+i, '')";
    const check = `try { ${program}; process.exit(1); } catch(e) { if(e.code !== 'EDQUOT') throw e; }`;
    execFileSync(process.execPath, ['-e', check], { cwd: volume, uid: 65534, gid: 65534, timeout: 5000 });
    console.log(`PASS per-sandbox ${dimension}: EDQUOT`);
  } finally { destroyBundle(bundle, run); }
}
