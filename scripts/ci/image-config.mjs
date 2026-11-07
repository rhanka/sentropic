import { execFileSync } from 'node:child_process';

// Docker's containerd store exposes a manifest ID in inspect.Id. Its archive
// records the content-addressed config path for the exact local image instead.
export function imageConfigDigest(ref, env = process.env) {
  const bytes = execFileSync('bash', ['-o', 'pipefail', '-c',
    'docker image save "$1" | tar -xOf - manifest.json', 'image-config', ref], { env });
  const manifests = JSON.parse(bytes.toString('utf8'));
  if (!Array.isArray(manifests) || manifests.length !== 1) throw Error('Expected one exported image config');
  const file = manifests[0].Config;
  const match = /^(?:blobs\/sha256\/([a-f0-9]{64})|([a-f0-9]{64})\.json)$/.exec(file ?? '');
  if (!match) throw Error('Invalid exported image config path');
  return `sha256:${match[1] ?? match[2]}`;
}
