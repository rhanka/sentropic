import { execFileSync, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { imageConfigDigest } from './image-config.mjs';

// Resolve the canonical artifact BEFORE save-api and every image consumer.
// Rebuilding an existing content tag can change timestamps and config bytes.
// This is the CI buildx path; the local compose flow lives in
// scripts/resolve-api-image.sh.
export function resolveApiImage(testEnv, env = process.env) {
  if (env.REGISTRY !== 'ghcr.io/rhanka' || !/^[a-f0-9]{6}$/.test(env.API_VERSION)
    || !/^(test-|e2e-)/.test(testEnv ?? '')) throw Error('Invalid canonical API image context');
  const ref = `${env.REGISTRY}/sentropic-api:${env.API_VERSION}`;
  const remote = spawnSync('docker', ['manifest', 'inspect', ref], { encoding: 'utf8', env });
  if (remote.status === 0) {
    const config = JSON.parse(remote.stdout).config?.digest;
    if (!/^sha256:[a-f0-9]{64}$/.test(config ?? '')) throw Error('Canonical API tag must name a single image manifest');
    execFileSync('docker', ['pull', '--platform', env.IMAGE_PLATFORM || 'linux/amd64', ref], { stdio: 'inherit', env });
    const loaded = imageConfigDigest(ref, env);
    if (loaded !== config) throw Error('Pulled API config differs from the canonical registry image');
    console.log(`Reusing canonical API image ${ref} (${config})`);
    return;
  }
  if (remote.error || !/manifest unknown|no such manifest|manifest not found|NAME_UNKNOWN/i.test(remote.stderr ?? '')) {
    throw Error('Cannot establish canonical API registry identity; refusing to build');
  }
  execFileSync('make', ['ci-build-api-target', 'IMAGE_KIND=api', `ENV=${testEnv}`], { stdio: 'inherit', env });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) resolveApiImage(process.argv[2]);
