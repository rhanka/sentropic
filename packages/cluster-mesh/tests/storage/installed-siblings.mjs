// Candidate-only registry for isolated storage consumers; packed receipts stay authoritative.
import { readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadSiblings } from '../../../../scripts/ci/qualify-published-install.mjs';

const platform = loadSiblings(dirname(process.env.CM_COMMENTS_SIBLINGS), {
  headSha: process.env.CLUSTER_MESH_HEAD_SHA,
}).find((entry) => entry.name === '@sentropic/mcp-platform');
if (!platform) {
  console.log('https://registry.npmjs.org');
} else {
  const manifest = new URL('../../../mcp-platform/package.json', import.meta.url);
  if (platform.version !== JSON.parse(readFileSync(manifest)).version) throw new Error('platform candidate version mismatch');
  const child = spawn(process.execPath, [
    fileURLToPath(new URL('../packaging/candidate-platform-registry.mjs', import.meta.url)),
    fileURLToPath(manifest), platform.file,
  ], { stdio: 'inherit' });
  process.on('SIGTERM', () => child.kill('SIGTERM'));
  child.on('exit', (code) => process.exit(code ?? 1));
}
