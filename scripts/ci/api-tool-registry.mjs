import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { digest } from './image-receipt.mjs';

// The registry tag is the complete toolbox content identity (API_TOOL_VERSION).
// A sibling "<tag>-manifest" scratch image records the identity and image ID;
// a pulled toolbox is accepted only when it matches that recorded manifest.
const SCHEMA = '1';
const LABEL = 'org.sentropic.toolbox.';
// `tool-` is the full toolbox identity; `tooldeps-` is the dependency-only base image.
export const TAG = /^tool(?:deps)?-[a-f0-9]{64}$/;

// Pin a verified pull to the exact manifest digest so a later consumer (a BuildKit
// builder resolving FROM) cannot receive different bytes from a moved tag.
export function pinnedRef(repo, repoDigests) {
  const match = repoDigests.find(ref => ref.startsWith(`${repo}@sha256:`));
  if (!match || !/@sha256:[a-f0-9]{64}$/.test(match)) throw Error('Pulled image has no digest for the registry repository');
  return match;
}

export function manifestLabels({ tag, imageId, lockDigest, architecture }) {
  return { schema: SCHEMA, tag, imageId, lockDigest, architecture };
}

export function validateManifest(labels, expected) {
  for (const [key, value] of Object.entries(expected)) {
    if (labels[key] !== value) throw Error(`Toolbox registry manifest mismatch: ${key}`);
  }
  if (!/^sha256:[a-f0-9]{64}$/.test(labels.imageId ?? '')) throw Error('Invalid registry manifest imageId');
  return labels;
}

const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim();

export async function main([mode, repo, tag, ref]) {
  if (!['pull', 'push', 'pin'].includes(mode) || !repo || !TAG.test(tag ?? '') || !ref) {
    throw Error('Usage: api-tool-registry.mjs pull|push|pin registry/repository tool[deps]-<sha256> local-ref');
  }
  const expected = { schema: SCHEMA, tag, lockDigest: await digest('package-lock.json'),
    architecture: process.env.IMAGE_PLATFORM || 'linux/amd64' };
  const manifestRef = `${repo}:${tag}-manifest`;
  if (mode === 'pin') {
    // Only valid after a successful verified pull: the local image must still be the recorded one.
    const raw = JSON.parse(docker('image', 'inspect', `${repo}:${tag}`, '--format', '{{json .RepoDigests}}'));
    console.log(pinnedRef(repo, raw));
    return;
  }
  if (mode === 'push') {
    const imageId = docker('image', 'inspect', ref, '--format', '{{.Id}}');
    const labels = manifestLabels({ ...expected, imageId });
    const lines = ['FROM scratch', `LABEL org.opencontainers.image.source="https://github.com/rhanka/sentropic"`,
      ...Object.entries(labels).map(([k, v]) => `LABEL ${LABEL}${k}="${v}"`)];
    execFileSync('docker', ['build', '-t', manifestRef, '-'], { input: lines.join('\n') + '\n', stdio: ['pipe', 'inherit', 'inherit'] });
    docker('tag', ref, `${repo}:${tag}`);
    // Manifest first: a toolbox tag without a manifest is never trusted by pull.
    docker('push', manifestRef);
    docker('push', `${repo}:${tag}`);
    return;
  }
  docker('pull', '--quiet', manifestRef);
  const raw = JSON.parse(docker('image', 'inspect', manifestRef, '--format', '{{json .Config.Labels}}'));
  const labels = Object.fromEntries(Object.entries(raw).filter(([k]) => k.startsWith(LABEL)).map(([k, v]) => [k.slice(LABEL.length), v]));
  validateManifest(labels, expected);
  docker('pull', '--quiet', `${repo}:${tag}`);
  if (docker('image', 'inspect', `${repo}:${tag}`, '--format', '{{.Id}}') !== labels.imageId) throw Error('Pulled toolbox image ID differs from recorded manifest');
  docker('tag', `${repo}:${tag}`, ref);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main(process.argv.slice(2));
