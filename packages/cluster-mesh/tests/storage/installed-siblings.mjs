// Authorize the verified platform archive in the frozen installed-consumer registry.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { loadSiblings } from '../../../../scripts/ci/qualify-published-install.mjs';

const platform = loadSiblings(dirname(process.env.CM_COMMENTS_SIBLINGS), {
  headSha: process.env.CLUSTER_MESH_HEAD_SHA,
}).find((entry) => entry.name === '@sentropic/mcp-platform');
if (platform) {
  const manifest = new URL('../../../mcp-platform/package.json', import.meta.url);
  if (platform.version !== JSON.parse(readFileSync(manifest)).version) throw new Error('platform candidate version mismatch');
  const consumer = existsSync('package.json') ? JSON.parse(readFileSync('package.json')) : { private: true };
  consumer.overrides = { ...consumer.overrides, '@sentropic/mcp-platform': `file:${platform.file}` };
  writeFileSync('package.json', JSON.stringify(consumer, null, 2) + '\n');
}
