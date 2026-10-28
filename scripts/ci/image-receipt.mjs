import { createHash } from 'node:crypto';
import { createReadStream, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export async function digest(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return `sha256:${hash.digest('hex')}`;
}

export function validate(receipt, expected) {
  for (const [key, value] of Object.entries(expected)) {
    if (JSON.stringify(receipt[key]) !== JSON.stringify(value)) throw Error(`Image receipt mismatch: ${key}`);
  }
  if (!/^sha256:[a-f0-9]{64}$/.test(receipt.imageId)) throw Error('Invalid image ID');
  if (!/^sha256:[a-f0-9]{64}$/.test(receipt.archiveDigest)) throw Error('Invalid archive digest');
  if (!receipt.producer?.job || !receipt.producer?.attempt) throw Error('Missing producer identity');
  const producer = { api: 'build-api-image', 'api-tool': 'build-api-tool-image', ui: 'build-ui', e2e: 'build-e2e' }[expected.kind];
  if (expected.runId !== 'local' && receipt.producer.job !== producer) throw Error('Wrong producer job');
  return receipt;
}

function git(...args) { return execFileSync('git', args, { encoding: 'utf8' }).trim(); }
function imageId(ref) {
  return execFileSync('docker', ['image', 'inspect', ref, '--format', '{{.Id}}'], { encoding: 'utf8' }).trim();
}

export async function context(kind, ref, env = process.env) {
  const profiles = kind === 'ui' ? ['VITE_EXTENSION_PROFILE_BUILD', 'VITE_EXTENSION_API_BASE_URL_BUILD',
    'VITE_EXTENSION_APP_BASE_URL_BUILD', 'VITE_EXTENSION_WS_BASE_URL_BUILD'] : [];
  return {
    schema: 1, kind, ref, sourceSha: git('rev-parse', 'HEAD'),
    // The tree binds paths, locks, Dockerfiles, toolchain and all source bytes.
    inputTree: git('rev-parse', 'HEAD^{tree}'),
    workflowDigest: await digest('.github/workflows/ci.yml'),
    runId: env.GITHUB_RUN_ID || 'local', architecture: env.IMAGE_PLATFORM || 'linux/amd64',
    cacheScope: `br78-v1-${kind}-${env.IMAGE_PLATFORM || 'linux/amd64'}`,
    profile: Object.fromEntries(profiles.map(key => [key, env[key] ?? ''])),
  };
}

export async function main([mode, kind, ref, archive, file]) {
  if (!['write', 'verify', 'loaded'].includes(mode) || !['api', 'api-tool', 'ui', 'e2e'].includes(kind) || !file) {
    throw Error('Usage: image-receipt.mjs write|verify|loaded api|api-tool|ui|e2e ref archive receipt');
  }
  const expected = await context(kind, ref);
  if (mode === 'write') {
    const receipt = { ...expected, imageId: imageId(ref), archiveDigest: await digest(archive),
      producer: { job: process.env.GITHUB_JOB || 'local', attempt: process.env.GITHUB_RUN_ATTEMPT || 'local' } };
    validate(receipt, expected);
    writeFileSync(file, `${JSON.stringify(receipt, null, 2)}\n`);
  } else {
    const receipt = validate(JSON.parse(readFileSync(file, 'utf8')), expected);
    if (mode === 'verify' && await digest(archive) !== receipt.archiveDigest) throw Error('Archive digest mismatch');
    if (mode === 'loaded' && imageId(ref) !== receipt.imageId) throw Error('Loaded image identity mismatch');
    console.log(`Verified ${kind}: ${receipt.imageId} (${receipt.archiveDigest})`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main(process.argv.slice(2));
}
