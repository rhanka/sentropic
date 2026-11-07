import { execFileSync, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { imageConfigDigest } from './image-config.mjs';

// Resolve the canonical artifact BEFORE save-ui and every image consumer.
// Rebuilding an existing content tag can change timestamps and config bytes.
export function resolveUiImage(testEnv, env = process.env) {
  if (env.REGISTRY !== 'ghcr.io/rhanka' || !/^[a-f0-9]{6}$/.test(env.UI_VERSION)
    || !/^(test-|e2e-)/.test(testEnv ?? '')) throw Error('Invalid canonical UI image context');
  const ref = `${env.REGISTRY}/sentropic-ui:${env.UI_VERSION}`;
  const remote = spawnSync('docker', ['manifest', 'inspect', ref], { encoding: 'utf8', env });
  if (remote.status === 0) {
    const config = JSON.parse(remote.stdout).config?.digest;
    if (!/^sha256:[a-f0-9]{64}$/.test(config ?? '')) throw Error('Canonical UI tag must name a single image manifest');
    execFileSync('docker', ['pull', '--platform', env.IMAGE_PLATFORM || 'linux/amd64', ref], { stdio: 'inherit', env });
    const loaded = imageConfigDigest(ref, env);
    if (loaded !== config) throw Error('Pulled UI config differs from the canonical registry image');
    console.log(`Reusing canonical UI image ${ref} (${config})`);
    return;
  }
  if (remote.error || !/manifest unknown|no such manifest|manifest not found|NAME_UNKNOWN/i.test(remote.stderr ?? '')) {
    throw Error('Cannot establish canonical UI registry identity; refusing to build');
  }
  execFileSync('make', ['ci-build-ui-target', 'IMAGE_KIND=ui', `ENV=${testEnv}`], { stdio: 'inherit', env });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) resolveUiImage(process.argv[2]);
