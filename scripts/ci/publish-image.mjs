import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

export function assertConfig(manifest, testedId) {
  if (!/^sha256:[a-f0-9]{64}$/.test(testedId) || manifest.config?.digest !== testedId) {
    throw Error('Registry config digest differs from the tested image');
  }
}

function docker(...args) { return execFileSync('docker', args, { encoding: 'utf8' }).trim(); }

export function publish(kind, env = process.env) {
  if (!['api', 'ui', 'e2e'].includes(kind) || env.REGISTRY !== 'ghcr.io/rhanka') throw Error('Invalid public GHCR publication');
  const tag = env[`${kind.toUpperCase()}_VERSION`];
  if (!/^[a-f0-9]{6}$/.test(tag)) throw Error('Publication requires an immutable content tag');
  const ref = `${env.REGISTRY}/sentropic-${kind}:${tag}`;
  const receipt = JSON.parse(readFileSync(`${kind}-image.json`, 'utf8'));
  if (receipt.ref !== ref || receipt.sourceSha !== env.GITHUB_SHA || receipt.runId !== env.GITHUB_RUN_ID
    || receipt.kind !== kind || String(receipt.producer.attempt) !== env.GITHUB_RUN_ATTEMPT) throw Error('Stale tested image receipt');
  if (docker('image', 'inspect', ref, '--format', '{{.Id}}') !== receipt.imageId) throw Error('Loaded image differs from tested bytes');
  const remote = spawnSync('docker', ['manifest', 'inspect', ref], { encoding: 'utf8' });
  if (remote.status === 0) assertConfig(JSON.parse(remote.stdout), receipt.imageId);
  else {
    if (!/manifest unknown|no such manifest|manifest not found|NAME_UNKNOWN/i.test(remote.stderr)) throw Error('Cannot establish registry tag identity');
    docker('push', ref);
  }
  assertConfig(JSON.parse(docker('manifest', 'inspect', ref)), receipt.imageId);
  const digest = docker('buildx', 'imagetools', 'inspect', ref).match(/^Digest:\s+(sha256:[a-f0-9]{64})$/m)?.[1];
  if (!digest) throw Error('Missing published manifest digest');
  // Promote the very same local/tested artifact; never pull a mutable tag.
  docker('tag', receipt.imageId, `${env.REGISTRY}/sentropic-${kind}:main`);
  docker('push', `${env.REGISTRY}/sentropic-${kind}:main`);
  assertConfig(JSON.parse(docker('manifest', 'inspect', `${env.REGISTRY}/sentropic-${kind}:main`)), receipt.imageId);
  const published = { ...receipt, digest, image: `${env.REGISTRY}/sentropic-${kind}@${digest}` };
  writeFileSync(`${kind}-image.published.json`, `${JSON.stringify(published, null, 2)}\n`);
  console.log(`Published tested ${kind}: ${published.image} (config ${receipt.imageId})`);
  return published;
}

if (process.argv[1]?.endsWith('/publish-image.mjs')) publish(process.argv[2]);
