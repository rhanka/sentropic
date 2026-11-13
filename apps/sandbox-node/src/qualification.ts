import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, chmodSync, chownSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mountQuotaVolume } from './disk-quota.js';
import { destroyBundle, type Bundle, type HostCommand } from './bundle.js';
import { isEdquot } from './filesystem-errors.js';

export function quotaWriter(): void {
  assert.equal(process.env.QUALIFICATION_ONLY, 'isolated');
  try {
    if (process.argv.includes('blocks')) writeFileSync('large', Buffer.alloc(2 * 1048576));
    else for (let i = 0; i < 64; i++) writeFileSync(`file-${i}`, '');
    throw new Error('quota failed to reject write');
  } catch (error) { if (!isEdquot(error)) throw error; }
}

export function qualifyDisk(): void {
  assert.equal(process.env.QUALIFICATION_ONLY, 'isolated', 'isolated qualification host required');
  assert.equal(process.getuid?.(), 0, 'root required');
  const run: HostCommand = (command, args, options) => { execFileSync(command, args, { stdio: 'pipe', timeout: 10000, ...options }); };
  for (const dimension of ['blocks', 'inodes']) {
    const path = mkdtempSync(join(tmpdir(), 'sandbox-quota-'));
    chmodSync(path, 0o755);
    const bundle: Bundle = { path, workspace: '', output: '', mounted: [] };
    try {
      const volume = mountQuotaVolume(bundle, 1, 32, run);
      chownSync(volume, 65534, 65534);
      execFileSync(process.execPath, ['--quota-writer', dimension], { cwd: volume, uid: 65534, gid: 65534, timeout: 5000 });
      console.log(`PASS per-sandbox ${dimension}: EDQUOT`);
    } finally { destroyBundle(bundle, run); }
  }
}
