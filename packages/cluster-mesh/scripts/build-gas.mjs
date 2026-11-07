// Deterministic single-file GAS bundle (IIFE, es2019, platform neutral). Pure function of the sources + (version, sha).
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const FORBIDDEN_INPUTS = [/^node:/, /(^|\/)node_modules\/(hono|pg|better-sqlite3|@sentropic\/mcp-platform)(\/|$)/];
export const SOFT_BUDGET_BYTES = 150 * 1024;
export const HARD_BUDGET_BYTES = 200 * 1024;

export async function buildGas({ gitSha = process.env.GAS_GIT_SHA ?? 'unknown' } = {}) {
  const version = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).version;
  const result = await build({
    absWorkingDir: root,
    entryPoints: ['src/gas/index.ts'],
    bundle: true,
    write: false,
    metafile: true,
    format: 'iife',
    globalName: 'SentropicClusterMesh',
    target: 'es2019',
    platform: 'neutral',
    minify: true,
    legalComments: 'none',
    sourcemap: false,
    charset: 'ascii',
    banner: { js: `/* cluster-mesh-gas ${version} ${gitSha} */` },
    logLevel: 'silent',
  });
  const code = result.outputFiles[0].text.replace(/\r\n/g, '\n');
  const inputs = Object.keys(result.metafile.inputs).sort();
  const bytes = Buffer.from(code, 'utf8');
  return {
    code,
    inputs,
    size: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}
