import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { digest } from './image-receipt.mjs';

export function validateCache(receipt, expected) {
  for (const [key, value] of Object.entries(expected)) {
    if (receipt[key] !== value) throw Error(`Toolbox cache mismatch: ${key}`);
  }
  for (const key of ['imageId', 'archiveDigest']) {
    if (!/^sha256:[a-f0-9]{64}$/.test(receipt[key])) throw Error(`Invalid cache ${key}`);
  }
  return receipt;
}

export async function verifyCache(dir, expected) {
  const receipt = validateCache(JSON.parse(readFileSync(`${dir}/cache.json`, 'utf8')), expected);
  if (await digest(`${dir}/image.tar.zst`) !== receipt.archiveDigest) throw Error('Toolbox cache archive digest mismatch');
  return receipt;
}

export async function main([mode, dir, ref]) {
  if (!['write', 'verify', 'loaded'].includes(mode) || !dir || !/:tool-[a-f0-9]{64}$/.test(ref ?? '')) {
    throw Error('Usage: api-tool-cache.mjs write|verify|loaded directory content-addressed-ref');
  }
  // Cache identity binds every embedded source/Dockerfile/tool/lock input via
  // API_TOOL_VERSION. Current-run transport receipts are always created anew.
  const expected = { schema: 1, ref, lockDigest: await digest('package-lock.json'),
    architecture: process.env.IMAGE_PLATFORM || 'linux/amd64' };
  const imageId = () => execFileSync('docker', ['image', 'inspect', ref, '--format', '{{.Id}}'], { encoding: 'utf8' }).trim();
  if (mode === 'write') {
    mkdirSync(dir, { recursive: true });
    copyFileSync('api-tool-image.tar.zst', `${dir}/image.tar.zst`);
    const receipt = { ...expected, imageId: imageId(), archiveDigest: await digest(`${dir}/image.tar.zst`) };
    validateCache(receipt, expected);
    writeFileSync(`${dir}/cache.json`, JSON.stringify(receipt) + '\n');
  } else if (mode === 'verify') {
    await verifyCache(dir, expected);
  } else {
    const receipt = validateCache(JSON.parse(readFileSync(`${dir}/cache.json`, 'utf8')), expected);
    if (imageId() !== receipt.imageId) throw Error('Loaded toolbox cache image mismatch');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main(process.argv.slice(2));
